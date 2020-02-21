import * as R from 'ramda';

import {RMByte, ExtendedX86RegName} from '../../../../emulator/types';
import {RegisterSchema} from '../../../shared/RegisterSchema';

import {ASTInstruction} from '../../ast/Instruction/ASTInstruction';
import {ASTInstructionArg} from '../../ast/Instruction/ASTInstructionArg';
import {ASTInstructionMemArg} from '../../ast/Instruction/ASTInstructionMemArg';

import {
  RMAddressingMode,
  InstructionArgSize,
} from '../../../types';

import {
  ParserError,
  ParserErrorCode,
} from '../../../shared/ParserError';

import {X86Compiler} from '../compile';
import {roundToPowerOfTwo} from '../../../utils/numberByteSize';

const extractNthByte = (nth: number, num: number): number => (num >> (nth * 0x8)) & 0xFF;

/**
 * Matches addressing mode
 *
 * @todo
 *  Reduce if, maybe there is a way to calculate RM byte instead using table?
 *
 * @see
 *  Table 2-1. 16-Bit Addressing Forms with the ModR/M Byte
 *
 * @param {InstructionArgSize} mode
 * @param {ExtendedX86RegName} baseReg
 * @param {ExtendedX86RegName} scaleReg
 * @param {number} dispRoundedSize
 * @returns {[number, number]}
 */
function findMatchingMemAddressingRMByte(
  mode: InstructionArgSize,
  baseReg: ExtendedX86RegName,
  scaleReg: ExtendedX86RegName,
  dispRoundedSize: number,
  swapped: boolean = false,
): [number, number] {
  let rm = null;

  if (mode === InstructionArgSize.WORD) {
    // MOD = 00
    if (dispRoundedSize === null) {
      if (baseReg === 'bx' && scaleReg === 'si') rm = 0b000;
      else if (baseReg === 'bx' && scaleReg === 'di') rm = 0b001;
      else if (baseReg === 'bp' && scaleReg === 'si') rm = 0b010;
      else if (baseReg === 'bp' && scaleReg === 'di') rm = 0b011;
      else if (!scaleReg) {
        if (baseReg === 'si') rm = 0b100;
        else if (baseReg === 'di') rm = 0b101;
        else if (baseReg === 'bx') rm = 0b111;
      }

      if (rm !== null)
        return [RMAddressingMode.INDIRECT_ADDRESSING, rm];
    } else if (!baseReg && !scaleReg && dispRoundedSize <= InstructionArgSize.WORD)
      return [RMAddressingMode.INDIRECT_ADDRESSING, 0b110];

    // MOD = 01 / MOD = 10
    if (dispRoundedSize === 0x1 || dispRoundedSize === 0x2) {
      if (baseReg === 'bx' && scaleReg === 'si') rm = 0b000;
      else if (baseReg === 'bx' && scaleReg === 'di') rm = 0b001;
      else if (baseReg === 'bp' && scaleReg === 'si') rm = 0b010;
      else if (baseReg === 'bp' && scaleReg === 'di') rm = 0b011;
      else if (!scaleReg) {
        if (baseReg === 'si') rm = 0b100;
        else if (baseReg === 'di') rm = 0b101;
        else if (baseReg === 'bp') rm = 0b110;
        else if (baseReg === 'bx') rm = 0b111;
      }

      if (rm !== null)
        return [dispRoundedSize, rm];
    }
  }

  // it might be mov ax, [si + bx] or mov [ax, bx + si]
  if (!swapped)
    return findMatchingMemAddressingRMByte(mode, scaleReg, baseReg, dispRoundedSize, true);

  return null;
}

/**
 * Compiles single instruction into:
 *
 * @export
 * @class BinaryInstruction
 */
export class BinaryInstruction {
  private _binary: Uint8Array;
  private _rmByte: RMByte;

  constructor(
    public readonly ast: ASTInstruction,
  ) {}

  get binary() { return this._binary; }
  get rmByte() { return this._rmByte; }

  /**
   * Transforms provided AST instruction into binary
   *
   * @private
   * @param {X86Compiler} compiler
   * @returns {BinaryInstruction}
   * @memberof BinaryInstruction
   */
  compile(compiler: X86Compiler): Uint8Array {
    const {ast} = this;
    const binary = [];

    const [rmArg, immArg] = [ast.findRMArg(), ast.numArgs[0]];
    const rmByte = rmArg && BinaryInstruction.encodeRMByte(compiler.mode, ast.regArgs[0], rmArg);

    // full instruction code
    ast.schema.binarySchema.forEach(
      (schema) => {
        switch (schema) {
          // immediate
          case 'i0': case 'i1': case 'i2': case 'i3':
            if (R.isNil(immArg))
              throw new ParserError(ParserErrorCode.MISSING_IMM_ARG_DEF);

            binary.push(
              extractNthByte(+schema[1], <number> immArg.value),
            );
            break;

          // displacement
          case 'd0': case 'd1': case 'd2': case 'd3': {
            if (!rmByte)
              throw new ParserError(ParserErrorCode.MISSING_RM_BYTE_DEF);

            if (!rmArg)
              throw new ParserError(ParserErrorCode.MISSING_MEM_ARG_DEF);

            const {addressDescription} = (<ASTInstructionMemArg> rmArg);
            if (addressDescription.disp !== null) {
              const offset = +schema[1];

              if (offset < addressDescription.dispByteSize) {
                binary.push(
                  extractNthByte(offset, addressDescription.disp),
                );
              }
            }
          } break;

          // RM byte
          case 'mr':
            if (!rmByte)
              throw new ParserError(ParserErrorCode.MISSING_RM_BYTE_DEF);

            binary.push(rmByte.byte);
            this._rmByte = rmByte;
            break;

          // emit binary number
          default: {
            const binNumber = Number.parseInt(schema, 16);
            if (Number.isNaN(binNumber))
              throw new ParserError(ParserErrorCode.UNKNOWN_BINARY_SCHEMA_DEF, null, {schema});

            binary.push(binNumber);
          }
        }
      },
    );

    this._binary = new Uint8Array(binary);
    return this._binary;
  }

  /**
   * Gets information about SIB, Displacement and other stuff from mem arg
   * Intel docs:
   * Table 2-1. 16-Bit Addressing Forms with the ModR/M Byte
   *
   * @see {@link http://www.c-jump.com/CIS77/CPU/x86/lecture.html}
   * @see {@link https://board.flatassembler.net/topic.php?t=6823}
   *
   * @static
   * @param {InstructionArgSize} mode
   * @param {ASTInstructionArg} regArg
   * @param {ASTInstructionArg} rmArg
   * @returns {RMByte}
   * @memberof BinaryInstruction
   */
  static encodeRMByte(mode: InstructionArgSize, regArg: ASTInstructionArg, rmArg: ASTInstructionArg): RMByte {
    const rmByte = new RMByte(0, 0, 0);

    // memory
    if (rmArg instanceof ASTInstructionMemArg) {
      const {addressDescription} = <ASTInstructionMemArg> rmArg;
      const dispByteSize = (
        R.isNil(addressDescription.disp)
          ? null
          : roundToPowerOfTwo(addressDescription.dispByteSize)
      );

      const [mod, rm] = findMatchingMemAddressingRMByte(
        mode,
        addressDescription.reg.mnemonic,
        addressDescription.scale?.reg.mnemonic,
        dispByteSize,
      ) || [];

      if (R.isNil(mod) && R.isNil(rm))
        throw new ParserError(ParserErrorCode.INVALID_ADDRESSING_MODE);

      rmByte.mod = mod;
      rmByte.rm = rm;

    // register mov ax, bx
    } else {
      rmByte.mod = RMAddressingMode.REG_ADDRESSING;
      rmByte.rm = (<RegisterSchema> rmArg.value).index;
    }

    // register (source / destination)
    if (regArg)
      rmByte.reg = (<RegisterSchema> regArg.value).index;

    return rmByte;
  }
}
