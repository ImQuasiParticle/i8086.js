import {
  roundToPowerOfTwo,
  numberByteSize,
  roundedSignedNumberByteSize,
} from '../../../../utils/numberByteSize';

import {X86AbstractCPU} from '../../../../../emulator/types';
import {InstructionArgType} from '../../../../types';
import {ASTInstructionArg} from './ASTInstructionArg';

/**
 * Instruction arg that contains number
 *
 * @export
 * @class ASTInstructionNumberArg
 * @extends {ASTInstructionArg}
 */
export class ASTInstructionNumberArg extends ASTInstructionArg<number> {
  public signedByteSize: number;
  public signedNumber: number;

  constructor(
    number: number,
    byteSize?: number,
    signedByteSize?: number,
    type: InstructionArgType = InstructionArgType.NUMBER,
  ) {
    super(
      type,
      number,
      byteSize ?? roundToPowerOfTwo(numberByteSize(number)),
    );

    this.signedByteSize = signedByteSize ?? roundedSignedNumberByteSize(number);
    this.signedNumber = X86AbstractCPU.toUnsignedNumber(
      number,
      <any> this.signedByteSize,
    );
  }

  /**
   * Used for upper cast for some instructions
   *
   * @param {number} byteSize
   * @memberof ASTInstructionNumberArg
   */
  upperCastByteSize(byteSize: number): void {
    this.byteSize = Math.max(this.byteSize, byteSize);

    this.signedByteSize = roundToPowerOfTwo(numberByteSize(0xFF << (this.byteSize * 0x8 + 1)));
    this.signedNumber = X86AbstractCPU.toUnsignedNumber(
      this.value,
      <any> byteSize,
    );
  }
}
