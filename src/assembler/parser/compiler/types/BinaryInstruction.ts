import * as R from 'ramda';

import {
  RMByte,
  RMAddressingMode,
  X86AbstractCPU,
} from '../../../../emulator/types';

import {ASTInstruction} from '../../ast/instruction/ASTInstruction';
import {
  ASTInstructionArg,
  ASTInstructionMemPtrArg,
} from '../../ast/instruction/args';

import {RegisterSchema} from '../../../shared/RegisterSchema';
import {InstructionArgSize} from '../../../types';

import {
  ParserError,
  ParserErrorCode,
} from '../../../shared/ParserError';

import {X86Compiler} from '../compile';
import {BinaryBlob} from '../BinaryBlob';

import {roundToPowerOfTwo} from '../../../utils/numberByteSize';
import {
  extractNthByte,
  findMatchingMemAddressingRMByte,
  findMatchingSregPrefix,
} from '../utils';

/**
 * Compiles single instruction into:
 *
 * @export
 * @class BinaryInstruction
 */
export class BinaryInstruction extends BinaryBlob<ASTInstruction> {
  private _rmByte: RMByte;

  get rmByte() { return this._rmByte; }

  /**
   * Transforms provided AST instruction into binary
   *
   * @param {X86Compiler} compiler
   * @param {number} absoluteAddress
   * @returns {BinaryInstruction}
   * @memberof BinaryInstruction
   */
  compile(compiler: X86Compiler, absoluteAddress: number): BinaryInstruction {
    const {ast} = this;
    const [primarySchema] = ast.schemas;

    const [memArg, rmArg, immArg, segMemArg] = [ast.memArgs[0], ast.findRMArg(), ast.numArgs[0], ast.segMemArgs[0]];
    const sibByte = ast.getScale();
    let rmByte = rmArg && BinaryInstruction.encodeRMByte(
      compiler.mode,
      R.find(
        (arg) => arg !== <ASTInstructionArg> rmArg,
        ast.regArgs,
      ),
      rmArg,
    );

    // sibByte is supported in modes > 16bits
    if (sibByte && compiler.mode > InstructionArgSize.WORD)
      throw new ParserError(ParserErrorCode.SCALE_INDEX_IS_UNSUPPORTED_IN_MODE);

    // output
    const binary: number[] = [];
    const binaryPrefixes: number[] = [...ast.prefixes];
    const binaryOutputSize = primarySchema.byteSize + binaryPrefixes.length + +!!sibByte;

    // todo: check if it is only available in addressing mode
    if (memArg?.addressDescription) {
      const {addressDescription} = memArg;
      const {sreg} = addressDescription;

      // check if excedding, only if RM byte present, moffset can be bigger
      if (!memArg.schema?.moffset && addressDescription.dispByteSize > compiler.mode) {
        throw new ParserError(
          ParserErrorCode.DISPLACEMENT_EXCEEDING_BYTE_SIZE,
          null,
          {
            address: memArg.phrase,
            byteSize: addressDescription.dispByteSize,
            maxSize: memArg.byteSize,
          },
        );
      }

      // sreg override
      if (sreg) {
        const sregPrefix = findMatchingSregPrefix(sreg);
        if (R.isNil(sregPrefix)) {
          throw new ParserError(
            ParserErrorCode.INCORRECT_SREG_OVERRIDE,
            null,
            {
              sreg: sreg.mnemonic,
            },
          );
        } else
          binaryPrefixes.push(sregPrefix);
      }
    }

    // full instruction code
    primarySchema.binarySchema.forEach(
      (schema) => {
        switch (schema) {
          // segment
          case 's0': case 's1': {
            const segOffset = segMemArg.val?.segment;

            if (segOffset) {
              binary.push(
                extractNthByte(+schema[1], segOffset.number),
              );
            } else
              binary.push(0x0); // pessimistic stage
          } break;

          // offset
          case 'o0': case 'o1': case 'o2': case 'o3': {
            const immOffset = segMemArg.val?.offset;

            if (segMemArg.val) {
              binary.push(
                extractNthByte(+schema[1], immOffset.number),
              );
            } else
              binary.push(0x0); // pessimistic stage
          } break;

          // relative jump
          case 'r0': case 'r1':
            if (immArg) {
              const relAddress = immArg.val - absoluteAddress - binaryOutputSize;

              binary.push(
                X86AbstractCPU.toUnsignedNumber(
                  extractNthByte(+schema[1], relAddress),
                  <any> immArg.byteSize,
                ),
              );
            } else
              binary.push(0x0); // pessimistic stage
            break;

          // immediate
          case 'i0': case 'i1': case 'i2': case 'i3':
            if (immArg) {
              binary.push(
                extractNthByte(+schema[1], <number> immArg.val),
              );
            } else
              binary.push(0x0); // pessimistic stage
            break;

          // displacement
          case 'd0': case 'd1': case 'd2': case 'd3': {
            // it can be also moffs arg, so do not use rmArg
            if (!memArg) {
              // register addressing, mov ax, bx
              if (rmByte)
                return;

              throw new ParserError(ParserErrorCode.MISSING_MEM_ARG_DEF);
            }

            const {addressDescription} = memArg;
            if (addressDescription && addressDescription.disp !== null) {
              // rm byte has several mode, if mode = 0x0 we are not able to detect
              // displacement size, it is instruction various, so limit it by schema
              // check nasm binary output anyway
              const byteOffset = +schema[1];
              const rmMaxByteSize = R.defaultTo(Infinity, rmByte.getDisplacementByteSize());

              // destination without mod rm byte always produces exactly
              // equal number of bytes of displacement, see nasm
              if (!memArg.schema.rm
                  || byteOffset < Math.max(rmMaxByteSize, addressDescription.dispByteSize)) {
                binary.push(
                  extractNthByte(byteOffset, addressDescription.disp),
                );
              }
            }
          } break;

          // RM byte
          case 'mr':
          case '/0': case '/1': case '/2': case '/3':
          case '/4': case '/5': case '/6': case '/7': {
            const regByteOverride = schema[0] === '/';

            if (!rmByte) {
              // see CALL instruction, FF /2 d0 d1
              if (regByteOverride)
                rmByte = new RMByte(RMAddressingMode.REG_ADDRESSING, 0, 0);
              else
                throw new ParserError(ParserErrorCode.MISSING_RM_BYTE_DEF);
            }

            // reg byte override
            if (regByteOverride)
              rmByte.reg = +schema[1];

            binary.push(rmByte.byte);
            this._rmByte = rmByte;
          } break;

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

    this._binary = [...binaryPrefixes, ...binary];
    return this;
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
  static encodeRMByte(
    mode: InstructionArgSize,
    regArg: ASTInstructionArg,
    rmArg: ASTInstructionArg,
  ): RMByte {
    const rmByte = new RMByte(0, 0, 0);

    // memory
    if (rmArg instanceof ASTInstructionMemPtrArg) {
      const {addressDescription} = <ASTInstructionMemPtrArg> rmArg;
      if (!addressDescription)
        return rmByte;

      const signedDispByteSize = (
        R.isNil(addressDescription.disp)
          ? null
          : roundToPowerOfTwo(addressDescription.signedByteSize)
      );

      const [mod, rm] = findMatchingMemAddressingRMByte(
        mode,
        addressDescription.reg?.mnemonic,
        addressDescription.scale?.reg.mnemonic,
        signedDispByteSize,
      ) || [];

      if (R.isNil(mod) && R.isNil(rm))
        throw new ParserError(ParserErrorCode.INVALID_ADDRESSING_MODE);

      rmByte.mod = mod;
      rmByte.rm = rm;
    } else {
      rmByte.mod = RMAddressingMode.REG_ADDRESSING;
      rmByte.rm = (<RegisterSchema> rmArg.val).index;
    }

    if (regArg) {
      // register mov ax, bx
      if (!rmArg)
        rmByte.mod = RMAddressingMode.REG_ADDRESSING;

      rmByte.reg = (<RegisterSchema> regArg.val).index;
    }

    return rmByte;
  }
}
