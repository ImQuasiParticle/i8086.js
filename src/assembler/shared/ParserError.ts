import {format} from '../utils/format';

import {ASTNodeLocation} from '../parser/ast/ASTNode';
import {TokenLocation} from '../parser/lexer/tokens';

export enum ParserErrorCode {
  UNKNOWN_TOKEN,
  SYNTAX_ERROR,
  INCORRECT_EXPRESSION,

  OPERAND_MUST_BE_NUMBER,
  OPERAND_SIZES_MISMATCH,

  MISSING_MEM_OPERAND_SIZE,
  INVALID_INSTRUCTION_OPERAND,
  UNKNOWN_OPERATION,
  REGISTER_IS_NOT_SEGMENT_REG,
  EXCEEDING_CASTED_NUMBER_SIZE,

  // mem
  INCORRECT_OPERAND,
  MISSING_MUL_SECOND_ARG,
  SCALE_IS_ALREADY_DEFINED,
  INCORRECT_SCALE_MEM_PARAMS,
  INCORRECT_SCALE,
  UNKNOWN_MEM_TOKEN,
  INCORRECT_MODRM,
  DISPLACEMENT_EXCEEDING_BYTE_SIZE,

  // segmented mem
  INCORRECT_SEGMENTED_MEM_FORMAT,
  INCORRECT_SEGMENTED_MEM_ARGS_COUNT,

  INCORRECT_SEGMENT_MEM_ARG_SIZE,
  INCORRECT_OFFSET_MEM_ARG_SIZE,
  OFFSET_MEM_ARG_SIZE_EXCEEDING_SIZE,

  // prefixes
  INCORRECT_SREG_OVERRIDE,

  // labels
  MISSING_PARENT_LABEL,
  UNKNOWN_LABEL,

  // compiler
  UNKNOWN_COMPILER_INSTRUCTION,
  UNSUPPORTED_COMPILER_MODE,
  UNKNOWN_BINARY_SCHEMA_DEF,
  MISSING_RM_BYTE_DEF,
  MISSING_MEM_ARG_DEF,
  MISSING_IMM_ARG_DEF,
  INVALID_ADDRESSING_MODE,
  UNMATCHED_SCHEMA_POSTPROCESS,
  UNABLE_TO_COMPILE_FILE,

  // define data
  DEFINED_DATA_EXCEEDES_BOUNDS,
  UNSUPPORTED_DEFINE_TOKEN,
}

/* eslint-disable max-len */
export const ERROR_TRANSLATIONS: {[key in ParserErrorCode]: string} = {
  [ParserErrorCode.UNKNOWN_TOKEN]: 'Unknown token "%{token}"!',
  [ParserErrorCode.SYNTAX_ERROR]: 'Syntax error!',
  [ParserErrorCode.INCORRECT_EXPRESSION]: 'Incorrect expression!',

  [ParserErrorCode.OPERAND_MUST_BE_NUMBER]: 'Operand must be number!',
  [ParserErrorCode.OPERAND_SIZES_MISMATCH]: 'Operand sizes mismatch!',

  [ParserErrorCode.MISSING_MEM_OPERAND_SIZE]: 'Missing mem operand size!',
  [ParserErrorCode.INVALID_INSTRUCTION_OPERAND]: 'Invalid operand "%{operand}"!',
  [ParserErrorCode.UNKNOWN_OPERATION]: 'Unknown operation!',
  [ParserErrorCode.REGISTER_IS_NOT_SEGMENT_REG]: 'Provided register "%{reg}" is not segment register!',

  [ParserErrorCode.EXCEEDING_CASTED_NUMBER_SIZE]: 'Provided value "%{value}" is exceeding casted arg size (provided %{size} bytes but max is %{maxSize} bytes)!',

  // mem
  [ParserErrorCode.UNKNOWN_MEM_TOKEN]: 'Unknown mem definition token %{token}!',
  [ParserErrorCode.INCORRECT_OPERAND]: 'Incorrect operand!',
  [ParserErrorCode.MISSING_MUL_SECOND_ARG]: 'Missing mul second arg!',
  [ParserErrorCode.SCALE_IS_ALREADY_DEFINED]: 'Scale is already defined!',
  [ParserErrorCode.INCORRECT_SCALE_MEM_PARAMS]: 'Incorrect scale mem params!',
  [ParserErrorCode.INCORRECT_SCALE]: 'Incorrect scale! It must be 1, 2, 4 or 8 instead of "%{scale}"!',
  [ParserErrorCode.INCORRECT_MODRM]: 'Error during "%{phrase}" ModRM instruction byte parsing!',
  [ParserErrorCode.DISPLACEMENT_EXCEEDING_BYTE_SIZE]: 'Displacement of "%{address}" exceedes arg byte size (%{byteSize} bytes)!',

  // segmented mem
  [ParserErrorCode.INCORRECT_SEGMENTED_MEM_FORMAT]: 'Incorrect segmented memory format "%{address}"!',
  [ParserErrorCode.INCORRECT_SEGMENTED_MEM_ARGS_COUNT]: 'Incorrect segmented memory address args count %{count}!',

  [ParserErrorCode.INCORRECT_SEGMENT_MEM_ARG_SIZE]: 'Incorrect address segment size, provided %{size} bytes but required is 2 bytes!',
  [ParserErrorCode.INCORRECT_OFFSET_MEM_ARG_SIZE]: 'Incorrect address offset size, provided %{size} bytes but required is <= 4 bytes!',
  [ParserErrorCode.OFFSET_MEM_ARG_SIZE_EXCEEDING_SIZE]: 'Incorrect address offset size, provided %{size} bytes but should be <= %{maxSize} bytes!',

  // prefixes
  [ParserErrorCode.INCORRECT_SREG_OVERRIDE]: 'Incorrect segment register override "%{sreg}"!',

  // labels
  [ParserErrorCode.MISSING_PARENT_LABEL]: 'Unable to resolve local label "%{label}", missing parent label!',
  [ParserErrorCode.UNKNOWN_LABEL]: 'Unknown label "%{label}"!',

  // compiler
  [ParserErrorCode.UNKNOWN_COMPILER_INSTRUCTION]: 'Unknown compile token "%{instruction}"!',
  [ParserErrorCode.UNSUPPORTED_COMPILER_MODE]: 'Unsupported compiler mode!',
  [ParserErrorCode.MISSING_RM_BYTE_DEF]: 'Missing RM byte arg definition but in binary schema is present!',
  [ParserErrorCode.MISSING_MEM_ARG_DEF]: 'Missing mem arg definition but in binary schema is present!',
  [ParserErrorCode.MISSING_IMM_ARG_DEF]: 'Missing imm arg definition but in binary schema is present!',
  [ParserErrorCode.UNKNOWN_BINARY_SCHEMA_DEF]: 'Unknown binary schema token %{schema}',
  [ParserErrorCode.INVALID_ADDRESSING_MODE]: 'Invalid addressing mode!',
  [ParserErrorCode.UNMATCHED_SCHEMA_POSTPROCESS]: 'Cannot find instruction "%{instruction}"!',
  [ParserErrorCode.UNABLE_TO_COMPILE_FILE]: 'Unable to compile file!',

  // defined data
  [ParserErrorCode.DEFINED_DATA_EXCEEDES_BOUNDS]: 'Defined data "%{data}" excedees bounds (%{maxSize} bytes)!',
  [ParserErrorCode.UNSUPPORTED_DEFINE_TOKEN]: 'Invalid "%{token}" define token value!',
};
/* eslint-enable max-len */

/**
 * Errors thrown during compiling
 *
 * @export
 * @class ParserError
 */
export class ParserError extends Error {
  public readonly loc: ASTNodeLocation;

  constructor(
    public readonly code: ParserErrorCode,
    loc?: TokenLocation|ASTNodeLocation,
    public readonly meta?: object,
  ) {
    super();

    this.loc = (
      loc instanceof TokenLocation
        ? ASTNodeLocation.fromTokenLoc(loc)
        : loc
    );

    this.name = 'ParserError';
    this.message = format(ERROR_TRANSLATIONS[code], meta || {});

    if (this.loc)
      this.message = `${this.loc.start.toString()}: ${this.message}`;
  }

  static throw(
    code: ParserErrorCode,
    loc?: TokenLocation|ASTNodeLocation,
    meta?: object,
  ) {
    throw new ParserError(code, loc, meta);
  }
}
