import * as R from 'ramda';

import {COMPILER_INSTRUCTIONS_SET} from '../../../constants/instructionSetSchema';

import {InstructionPrefix, MAX_COMPILER_REG_LENGTH} from '../../../constants';
import {
  BRANCH_ADDRESSING_SIZE_MAPPING,
  InstructionArgType,
  BranchAddressingType,
  InstructionArgSize,
} from '../../../types';

import {ParserError, ParserErrorCode} from '../../../shared/ParserError';

import {ASTParser, ASTTokensIterator} from '../ASTParser';
import {ASTNodeKind} from '../types';

import {ASTLabelAddrResolver} from './ASTResolvableArg';
import {ASTInstructionSchema} from './ASTInstructionSchema';
import {
  ASTInstructionNumberArg,
  ASTInstructionMemPtrArg,
  ASTInstructionMemSegmentedArg,
  ASTInstructionRegisterArg,
  ASTInstructionArg,
} from './args';

import {
  KindASTNode,
  ASTNodeLocation,
} from '../ASTNode';

import {
  TokenType,
  Token,
  NumberToken,
  RegisterToken,
  TokenKind,
  SizeOverrideToken,
  BranchAddressingTypeToken,
} from '../../lexer/tokens';

import {findMatchingInstructionSchemas} from './args/ASTInstructionArgMatchers';
import {reduceTextToBitset} from '../../compiler/utils';

import {
  isJumpInstruction,
  toStringArgsList,
  fetchInstructionTokensArgsList,
  assignLabelsToTokens,
  isAnyLabelInTokensList,
} from '../../utils';

/**
 * Parser for:
 * [opcode] [arg1] [arg2] [argX]
 *
 * @todo
 *  Maybe remove originalArgs and check if instruction
 *  has LABEL etc stuff in better way?
 *
 * @export
 * @class ASTInstruction
 * @extends {KindASTNode('Instruction')}
 */
export class ASTInstruction extends KindASTNode(ASTNodeKind.INSTRUCTION) {
  // used for optimistic instruction size predictions
  public readonly originalArgsTokens: Token<any>[];

  public typedArgs: {[type in InstructionArgType]: (ASTInstructionArg|ASTInstructionMemPtrArg)[]};
  public schemas: ASTInstructionSchema[];

  // jump/branch related args
  public branchAddressingType: BranchAddressingType = null;

  public readonly jumpInstruction: boolean;
  public readonly labeledInstruction: boolean;

  // initial args is constant, it is
  // toggled on first pass, during AST tree analyze
  // args might change in second phase
  public args: ASTInstructionArg[];

  constructor(
    public readonly opcode: string,
    public argsTokens: Token<any>[],
    public readonly prefixes: InstructionPrefix[] = [],
    loc: ASTNodeLocation,
  ) {
    super(loc);

    // decode FAR/NEAR JMP addressing type prefixes
    if (argsTokens.length && argsTokens[0].kind === TokenKind.BRANCH_ADDRESSING_TYPE) {
      this.branchAddressingType = (<BranchAddressingTypeToken> argsTokens[0]).value;
      this.argsTokens = R.tail(argsTokens);
    } else
      this.argsTokens = argsTokens;

    // check if instruction is branch instruction
    this.jumpInstruction = isJumpInstruction(opcode);
    this.labeledInstruction = isAnyLabelInTokensList(this.argsTokens);
    this.originalArgsTokens = [...argsTokens];
  }

  get memArgs() {
    return <ASTInstructionMemPtrArg[]> this.typedArgs[InstructionArgType.MEMORY];
  }

  get numArgs() {
    return <ASTInstructionNumberArg[]> this.typedArgs[InstructionArgType.NUMBER];
  }

  get segMemArgs() {
    return <ASTInstructionMemSegmentedArg[]> this.typedArgs[InstructionArgType.SEGMENTED_MEMORY];
  }

  get regArgs() {
    return <ASTInstructionRegisterArg[]> this.typedArgs[InstructionArgType.REGISTER];
  }

  get labelArgs() { return this.typedArgs[InstructionArgType.LABEL]; }

  /**
   * Groups args into types
   *
   * @todo
   *  Find better solution, it is not memory friendly
   *
   * @private
   * @memberof ASTInstruction
   */
  private refreshTypedArgs(): void {
    this.typedArgs = <any> R.reduce(
      (acc, item) => {
        acc[<any> item.type].push(item);
        return acc;
      },
      // todo: optimize
      {
        [InstructionArgType.MEMORY]: [],
        [InstructionArgType.SEGMENTED_MEMORY]: [],
        [InstructionArgType.NUMBER]: [],
        [InstructionArgType.REGISTER]: [],
        [InstructionArgType.LABEL]: [],
      },
      this.args,
    );
  }

  /**
   * @todo
   * Add prefixes
   *
   * @returns {string}
   * @memberof ASTInstruction
   */
  toString(): string {
    const {schemas, args, branchAddressingType} = this;
    if (schemas.length === 1) {
      let {mnemonic} = schemas[0];
      if (branchAddressingType)
        mnemonic = `${mnemonic} ${branchAddressingType}`;

      return toStringArgsList(mnemonic, args);
    }

    return `[?] ${toStringArgsList(this.opcode, this.argsTokens)}`;
  }

  /**
   * Search for ModRM byte parameter, it might be register or memory,
   * it is flagged using schema.rm boolean
   *
   * @returns {ASTInstructionArg}
   * @memberof ASTInstruction
   */
  findRMArg(): ASTInstructionMemPtrArg {
    return <ASTInstructionMemPtrArg> R.find<ASTInstructionArg>(
      (arg) => arg.schema?.rm,
      this.args,
    );
  }

  /**
   * Search if all labels are present
   *
   * @param {ASTLabelAddrResolver} labelResolver
   * @returns {ASTInstruction}
   * @memberof ASTInstruction
   */
  tryResolveSchema(labelResolver?: ASTLabelAddrResolver): ASTInstruction {
    this.argsTokens = assignLabelsToTokens(labelResolver, this.originalArgsTokens);

    // regenerate schema args
    const {branchAddressingType, jumpInstruction, argsTokens} = this;
    const [overridenBranchAddressingType, newArgs] = ASTInstruction.parseInstructionArgsTokens(
      branchAddressingType,
      argsTokens,
      jumpInstruction
        ? InstructionArgSize.WORD
        : null,
    );

    // assign labels resolver into not fully resolved args
    this.branchAddressingType = overridenBranchAddressingType ?? branchAddressingType;
    this.args = R.map(
      (arg) => {
        if (arg.isResolved())
          return arg;

        arg.tryResolve(labelResolver);
        return arg;
      },
      newArgs,
    );

    // group into arrays
    this.refreshTypedArgs();

    // list all of schemas
    this.schemas = findMatchingInstructionSchemas(COMPILER_INSTRUCTIONS_SET, this);

    // assign matching schema
    const {schemas, args} = this;
    for (let i = 0; i < args.length; ++i)
      args[i].schema = schemas.length > 0 ? schemas[0].argsSchema[i] : null;

    // if not found any matching schema - resolving failed
    return schemas.length ? this : null;
  }

  /**
   * Transforms list of tokens into arguments
   *
   * @see
   *  BranchAddressingType might be overriden so return both values!
   *
   * @static
   * @param {BranchAddressingType} branchAddressingType
   * @param {Token[]} tokens
   * @param {number} [defaultMemArgByteSize=null]
   * @returns {ASTInstructionArg<any>[]}
   * @memberof ASTInstruction
   */
  static parseInstructionArgsTokens(
    branchAddressingType: BranchAddressingType,
    tokens: Token[],
    defaultMemArgByteSize: number = null,
  ): [BranchAddressingType, ASTInstructionArg<any>[]] {
    let byteSizeOverride: number = null;
    let branchSizeOverride: number = (
      branchAddressingType
        ? BRANCH_ADDRESSING_SIZE_MAPPING[branchAddressingType] * 2
        : null
    );

    /**
     * Checks size of number, applies override and throw if error
     *
     * @param {Token} token
     * @param {number} number
     * @param {number} byteSize
     * @returns {ASTInstructionNumberArg}
     */
    function parseNumberArg(token: Token, number: number, byteSize: number): ASTInstructionNumberArg {
      // if no - number
      if (!R.isNil(byteSizeOverride) && byteSizeOverride < byteSize) {
        throw new ParserError(
          ParserErrorCode.EXCEEDING_CASTED_NUMBER_SIZE,
          null,
          {
            value: token.text,
            size: byteSize,
            maxSize: byteSizeOverride,
          },
        );
      }

      return new ASTInstructionNumberArg(number, byteSizeOverride ?? byteSize);
    }

    /**
     * Consumes token and product instruction arg
     *
     * @param {ASTInstructionArg} prevArgs
     * @param {Token} token
     * @param {ASTTokensIterator} iterator
     * @returns {ASTInstructionArg<any>}
     */
    function parseToken(
      prevArgs: ASTInstructionArg[],
      token: Token,
      iterator: ASTTokensIterator,
    ): ASTInstructionArg<any> {
      const nextToken = iterator.fetchRelativeToken(1, false);
      const destinationArg = !prevArgs.length;

      // check if next token is colon, if so - it is segmented arg
      // do not pass it directly as SegmentedAddress into AST argument
      // it can contain label, just ignore type of precceding token
      // and throw error if not pass inside arg parser
      if (nextToken?.type === TokenType.COLON) {
        // sometimes instruction might be not prefixed with far or near prefix
        // for example jmp 0x7C00:0x123, force detect addressing type
        if (R.isNil(branchAddressingType)) {
          branchAddressingType = BranchAddressingType.FAR;
          branchSizeOverride = BRANCH_ADDRESSING_SIZE_MAPPING[branchAddressingType] * 2;
        }

        // eat colon
        iterator.consume();

        return new ASTInstructionMemSegmentedArg(
          `${token.text}:${iterator.consume()?.text}`,
          byteSizeOverride ?? branchSizeOverride ?? token.value.byteSize,
        );
      }

      // watch for other instruction arg types
      switch (token.type) {
        // Quotes are converted into digits
        case TokenType.QUOTE: {
          const {text} = token;

          if (text.length > MAX_COMPILER_REG_LENGTH) {
            throw new ParserError(
              ParserErrorCode.INCORRECT_ARG_QUOTE_TEXT_LENGTH,
              null,
              {
                maxSize: MAX_COMPILER_REG_LENGTH,
                text,
              },
            );
          }

          return parseNumberArg(token, reduceTextToBitset(text), text.length);
        }

        // Registers
        case TokenType.KEYWORD:
          if (token.kind === TokenKind.REGISTER) {
            const {schema, byteSize} = (<RegisterToken> token).value;

            return new ASTInstructionRegisterArg(schema, byteSize);
          }

          if (token.kind === TokenKind.BYTE_SIZE_OVERRIDE) {
            let newByteSize = (<SizeOverrideToken> token).value.byteSize;

            // not sure if it is ok but in nasm byte size in branch mode
            // is as twice as big as override so multiply by 2
            if (branchSizeOverride) {
              if (newByteSize * 2 < branchSizeOverride)
                throw new ParserError(ParserErrorCode.OPERAND_SIZES_MISMATCH);
              else
                newByteSize *= 2;
            }

            byteSizeOverride = newByteSize;
            return null;
          }

          // used for mem matching, in first phase
          return new ASTInstructionArg(
            InstructionArgType.LABEL,
            token.text,
            byteSizeOverride ?? branchSizeOverride,
          );

        // Numeric or address segmented address
        case TokenType.NUMBER: {
          const {number, byteSize} = (<NumberToken> token).value;

          return parseNumberArg(token, number, byteSize);
        }

        // Mem address ptr
        case TokenType.BRACKET:
          if (token.kind === TokenKind.SQUARE_BRACKET) {
            let memSize = byteSizeOverride ?? branchSizeOverride ?? defaultMemArgByteSize;

            // when read from memory size must be known
            // try to deduce from previous args size of
            // memory argument
            if (R.isNil(memSize)) {
              if (destinationArg) {
                // if destination - next register should contain size
                if (nextToken?.kind === TokenKind.REGISTER)
                  memSize = (<RegisterToken> nextToken).value.byteSize;
              } else {
                // if not destination - there should be some registers before
                // try to find matching
                const prevRegArg = R.find(
                  (arg) => arg.type === InstructionArgType.REGISTER,
                  prevArgs,
                );

                if (prevRegArg?.byteSize)
                  memSize = prevRegArg.byteSize;
                else
                  throw new ParserError(ParserErrorCode.MISSING_MEM_OPERAND_SIZE);
              }
            }

            return new ASTInstructionMemPtrArg(<string> token.text, memSize);
          }
          break;

        default:
      }

      // force throw error if not known format
      throw new ParserError(
        ParserErrorCode.INVALID_INSTRUCTION_OPERAND,
        null,
        {
          operand: token.text,
        },
      );
    }

    // a bit faster than transduce
    const argsTokensIterator = new ASTTokensIterator(tokens);
    const acc: ASTInstructionArg[] = [];

    argsTokensIterator.iterate(
      (token: Token) => {
        const result = parseToken(acc, token, argsTokensIterator);
        if (!result)
          return;

        const sizeMismatch = (
          acc.length
            && result.type !== InstructionArgType.LABEL
            && acc[acc.length - 1].type !== InstructionArgType.LABEL
            && result.byteSize !== acc[acc.length - 1].byteSize
        );

        if (sizeMismatch) {
          // handle something like this: mov ax, 2
          // second argument has byteSize equal to 1, but ax is 2
          // try to cast
          const prevByteSize = acc[acc.length - 1].byteSize;
          if (result.type === InstructionArgType.NUMBER && result.byteSize < prevByteSize)
            (<ASTInstructionNumberArg> result).upperCastByteSize(prevByteSize);

          // otherwise if it is mem arg, throw error
          else
            throw new ParserError(ParserErrorCode.OPERAND_SIZES_MISMATCH);
        }

        acc.push(result);
      },
    );

    return [branchAddressingType, acc];
  }

  /**
   * Returns instruction
   *
   * @static
   * @param {Token} token
   * @param {Object} recursiveParseParams
   *
   * @returns ASTInstruction
   * @memberof ASTInstruction
   */
  static parse(token: Token, parser: ASTParser): ASTInstruction {
    // if not opcode, ignore
    const opcode = R.toLower(<string> token.text);
    if (token.type !== TokenType.KEYWORD || !COMPILER_INSTRUCTIONS_SET[opcode])
      return null;

    // match prefixes
    /* eslint-disable no-constant-condition */
    const prefixes: InstructionPrefix[] = [];
    do {
      const prefix = InstructionPrefix[R.toUpper(<string> token.text)];
      if (!prefix)
        break;

      prefixes.push(prefix);
      token = parser.fetchRelativeToken();
    } while (true);
    /* eslint-enable no-constant-condition */

    // parse arguments
    const argsTokens = fetchInstructionTokensArgsList(parser);
    const instruction = new ASTInstruction(
      opcode,
      argsTokens,
      prefixes,
      ASTNodeLocation.fromTokenLoc(token.loc),
    );

    return instruction.tryResolveSchema();
  }
}
