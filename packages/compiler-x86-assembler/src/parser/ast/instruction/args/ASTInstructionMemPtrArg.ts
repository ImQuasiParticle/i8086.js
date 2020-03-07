import * as R from 'ramda';

import {RegisterToken} from '@compiler/x86-assembler/parser/lexer/tokens';
import {TokenType, TokenKind, Token} from '@compiler/lexer/tokens';
import {Result} from '@compiler/core/monads/Result';

import {MathErrorCode} from '@compiler/rpn/utils';
import {rpnTokens} from '@compiler/x86-assembler/parser/compiler/utils';

import {
  numberByteSize,
  roundToPowerOfTwo,
  signedNumberByteSize,
} from '@compiler/core/utils/numberByteSize';

import {assignLabelsToTokens} from '../../../utils';
import {asmLexer} from '../../../lexer/asmLexer';

import {ASTLabelAddrResolver} from '../ASTResolvableArg';
import {
  ASTExpressionParserResult,
  ok,
  err,
  ASTExpressionParserError,
} from '../../critical/ASTExpression';

import {ParserError, ParserErrorCode} from '../../../../shared/ParserError';
import {
  InstructionArgType,
  MemAddressDescription,
  isValidScale,
  MemSIBScale,
  InstructionArgSize,
} from '../../../../types';

import {ASTInstructionArg} from './ASTInstructionArg';

/**
 * Throws error that is used to jump prediction
 *
 * @param {ASTLabelAddrResolver} labelResolver
 * @param {Token[]} tokens
 * @returns {Result<number, ASTExpressionParserError>}
 */
function safeMemRPN(labelResolver: ASTLabelAddrResolver, tokens: Token[]): Result<number, ASTExpressionParserError> {
  try {
    return ok(
      rpnTokens(
        tokens,
        {
          keywordResolver: labelResolver,
        },
      ),
    );
  } catch (e) {
    if (labelResolver || ('code' in e && e.code !== MathErrorCode.UNKNOWN_KEYWORD))
      throw e;

    return err(ASTExpressionParserError.UNRESOLVED_LABEL);
  }
}

/**
 * Transforms [ax:bx+si*4] into descriptor object
 *
 * @param {string} expression
 * @returns {ASTExpressionParserResult<MemAddressDescription>}
 */
function parseMemExpression(
  labelResolver: ASTLabelAddrResolver,
  expression: string,
): ASTExpressionParserResult<MemAddressDescription> {
  let tokens = Array.from(
    asmLexer(expression, false, true),
  );

  const addressDescription: MemAddressDescription = {
    disp: null,
    dispByteSize: null,
    signedByteSize: null,
  };

  // assign labels if labelResolver is present
  if (labelResolver)
    tokens = assignLabelsToTokens(labelResolver, tokens);

  // eat all register tokens
  for (let i = 0; i < tokens.length;) {
    const [arg1, operator, arg2] = [tokens[i], tokens[i + 1], tokens[i + 2]];
    const currentReg = arg1.kind === TokenKind.REGISTER && (<RegisterToken> arg1).value.schema;

    // sreg:...
    if (!i && currentReg && operator?.type === TokenType.COLON) {
      addressDescription.sreg = currentReg;

      if (!addressDescription?.sreg)
        throw new ParserError(ParserErrorCode.REGISTER_IS_NOT_SEGMENT_REG, null, {reg: arg1.text});

      tokens.splice(i, 2);

    // scale, reg*num or num*reg
    } else if (operator?.type === TokenType.MUL && (currentReg || arg2?.kind === TokenKind.REGISTER)) {
      if (addressDescription.scale)
        throw new ParserError(ParserErrorCode.SCALE_IS_ALREADY_DEFINED);

      // handle errors
      const [reg, expr] = currentReg ? [arg1, arg2] : [arg2, arg1];
      const scaleResult = safeMemRPN(labelResolver, [expr]);
      if (scaleResult.isErr())
        return err(scaleResult.unwrapErr());

      // calc scale
      const scale = scaleResult.unwrap();
      if (!isValidScale(scale))
        throw new ParserError(ParserErrorCode.INCORRECT_SCALE, null, {scale});

      addressDescription.scale = {
        reg: (<RegisterToken> reg).value.schema,
        value: <MemSIBScale> scale,
      };

      tokens.splice(i, 3);
    } else if (currentReg) {
      // standalone offset register
      if (!addressDescription.reg) {
        addressDescription.reg = currentReg;
        tokens.splice(i, 1);

      // standalone scale register
      } else if (!addressDescription.scale) {
        addressDescription.scale = {
          reg: currentReg,
          value: 1,
        };
        tokens.splice(i, 1);
      } else
        throw new ParserError(ParserErrorCode.INCORRECT_MEM_EXPRESSION, null, {expression});
    } else
      ++i;
  }

  // calc displacement
  if (tokens.length) {
    const dispResult = safeMemRPN(labelResolver, tokens);
    if (dispResult.isErr())
      return err(dispResult.unwrapErr());

    addressDescription.disp = dispResult.unwrap();
  }

  if (addressDescription.disp !== null) {
    addressDescription.dispByteSize = numberByteSize(addressDescription.disp);
    addressDescription.signedByteSize = signedNumberByteSize(addressDescription.disp);
  }

  return ok(addressDescription);
}

/**
 * Resolves instrction from text schema like this:
 * [ds:cx+4*si+disp]
 *
 * @class ASTInstructionMemPtrArg
 * @extends {ASTInstructionArg}
 */
export class ASTInstructionMemPtrArg extends ASTInstructionArg<MemAddressDescription> {
  constructor(
    public readonly phrase: string,
    byteSize: number,
  ) {
    super(InstructionArgType.MEMORY, null, byteSize, null, false);

    this.phrase = phrase;
    this.tryResolve();
  }

  get addressDescription(): MemAddressDescription {
    return <MemAddressDescription> this.value;
  }

  isDisplacementOnly(): boolean {
    const {value} = this;

    return !!(value && R.isNil(value.reg) && R.isNil(value.scale) && R.is(Number, value.disp));
  }

  isScaled() {
    const {value} = this;

    return !R.isNil(value.scale);
  }

  /**
   * Used in diassembler
   *
   * @returns {string}
   * @memberof ASTInstructionMemPtrArg
   */
  toString(): string {
    const {phrase, byteSize, schema} = this;
    const sizePrefix = InstructionArgSize[roundToPowerOfTwo(byteSize)];

    if (!schema)
      return `[${phrase}]`;

    if (schema.moffset)
      return phrase;

    return `${sizePrefix} ptr [${phrase}]`;
  }

  /**
   * See format example:
   * @see {@link https://stackoverflow.com/a/34058400}
   *
   * @param {ASTLabelAddrResolver} [labelResolver]
   * @returns {boolean}
   * @memberof ASTInstructionMemPtrArg
   */
  tryResolve(labelResolver?: ASTLabelAddrResolver): boolean {
    const {phrase, resolved, byteSize} = this;
    if (resolved)
      return resolved;

    const parsedMemResult = parseMemExpression(labelResolver, phrase);
    if (parsedMemResult.isOk()) {
      const parsedMem = parsedMemResult.unwrap();

      if (R.isNil(byteSize))
        this.byteSize = R.defaultTo(0, parsedMem.dispByteSize);

      this.value = parsedMem;
      this.resolved = true;
    }

    return this.resolved;
  }
}
