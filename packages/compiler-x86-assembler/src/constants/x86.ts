import * as R from 'ramda';

import {X86BitsMode, ExtendedX86RegName} from '@emulator/x86-cpu/types';
import {InstructionArgSize} from '../types';

/**
 * X86 register schema info
 *
 * @export
 * @class RegisterSchema
 */
export class RegisterSchema {
  /**
   * Creates an instance of RegisterSchema
   *
   * @param {ExtendedX86RegName} mnemonic
   * @param {number} index
   * @param {X86BitsMode} byteSize
   * @param {boolean} [segment=false]
   * @param {boolean} [x87=false]
   * @memberof RegisterSchema
   */
  constructor(
    public readonly mnemonic: ExtendedX86RegName,
    public readonly index: number,
    public readonly byteSize: X86BitsMode,
    public readonly segment: boolean = false,
    public readonly x87: boolean = false,
  ) {}

  toString() {
    return this.mnemonic;
  }
}

export enum InstructionPrefix {
  LOCK = 0xF0,

  // REP
  REP = 0xF3,
  REPE = 0xF3,
  REPZ = 0xF3,

  REPNE = 0xF2,
  REPNZ = 0xF2,

  // SEGMENT OVERRIDE
  CS = 0x2E,
  SS = 0x36,
  DS = 0x3E,
  ES = 0x26,
  FS = 0x64,
  GS = 0x65,

  // OPERAND OVERRIDE
  OPERAND_OVERRIDE = 0x66,
  ADDRESS_OVERRIDE = 0x67,
}

export type RegSchemaStore = {[name: string]: RegisterSchema};

/**
 * Converts array of registers into object with keys of mnemonics
 *
 * @export
 * @param {Reg[]} regs
 * @returns {RegSchemaStore}
 */
export function reduceRegSchemaStore<T>(regs: T[]): {[name: string]: T} {
  return R.reduce(
    (acc, register) => {
      acc[(<any> register).mnemonic] = Object.freeze(register);
      return acc;
    },
    {},
    regs,
  );
}

/**
 * Reduce registers to object with [regName]: Register
 */
const Reg = RegisterSchema;
export const COMPILER_REGISTERS_SET: RegSchemaStore = reduceRegSchemaStore(
  [
    // X86
    new Reg('al', 0x0, 0x1), new Reg('ah', 0x4, 0x1), new Reg('ax', 0x0, 0x2),
    new Reg('bl', 0x3, 0x1), new Reg('bh', 0x7, 0x1), new Reg('bx', 0x3, 0x2),
    new Reg('cl', 0x1, 0x1), new Reg('ch', 0x5, 0x1), new Reg('cx', 0x1, 0x2),
    new Reg('dl', 0x2, 0x1), new Reg('dh', 0x6, 0x1), new Reg('dx', 0x2, 0x2),

    new Reg('sp', 0x4, 0x2),
    new Reg('bp', 0x5, 0x2),
    new Reg('si', 0x6, 0x2),
    new Reg('di', 0x7, 0x2),

    new Reg('es', 0x0, 0x2, true),
    new Reg('cs', 0x1, 0x2, true),
    new Reg('ss', 0x2, 0x2, true),
    new Reg('ds', 0x3, 0x2, true),
    new Reg('fs', 0x4, 0x2, true),
    new Reg('gs', 0x5, 0x2, true),

    // X87
    new Reg('st0', 0x0, 0xA, false, true),
    new Reg('st1', 0x1, 0XA, false, true),
    new Reg('st2', 0x2, 0XA, false, true),
    new Reg('st3', 0x3, 0XA, false, true),
    new Reg('st4', 0x4, 0XA, false, true),
    new Reg('st5', 0x5, 0XA, false, true),
    new Reg('st6', 0x6, 0XA, false, true),
    new Reg('st7', 0x7, 0XA, false, true),
  ],
);

export const MIN_COMPILER_REG_LENGTH = InstructionArgSize.WORD;

export const MAX_COMPILER_REG_LENGTH = R.reduce(
  (acc, {byteSize}) => Math.max(acc, byteSize),
  0,
  R.values(<any> COMPILER_REGISTERS_SET),
);
