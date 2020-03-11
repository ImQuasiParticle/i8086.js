import {Token, TokenType} from '@compiler/lexer/tokens';
import {NodeLocation} from '@compiler/grammar/tree/NodeLocation';
import {ParserError, ParserErrorCode} from '@compiler/x86-assembler/shared/ParserError';

import {ASTAsmParser} from '../ASTAsmParser';
import {ASTNodeKind} from '../types';
import {KindASTNode} from '../ASTAsmNode';

import {fetchInstructionTokensArgsList} from '../../utils';

export const EQU_TOKEN_NAME = 'equ';

/**
 * Similar to %define but define label with value
 *
 * @export
 * @class ASTEqu
 * @extends {KindASTNode(ASTNodeKind.EQU)}
 */
export class ASTEqu extends KindASTNode(ASTNodeKind.EQU) {
  constructor(
    public readonly name: string,
    public readonly expression: string,
    loc: NodeLocation,
  ) {
    super(loc);
  }

  toString(): string {
    const {name, expression} = this;
    return `${name} equ ${expression}`;
  }

  static parse(token: Token, parser: ASTAsmParser): ASTEqu {
    if (token.type !== TokenType.KEYWORD)
      return null;

    const nextToken = parser.fetchRelativeToken(1, false);
    if (nextToken.lowerText !== EQU_TOKEN_NAME)
      return null;

    parser.consume();
    const args = fetchInstructionTokensArgsList(parser, false);

    if (args.length !== 1) {
      throw new ParserError(
        ParserErrorCode.INCORRECT_EQU_ARGS_COUNT,
        token.loc,
        {
          count: args.length,
        },
      );
    }

    return new ASTEqu(
      token.lowerText,
      args[0].lowerText,
      NodeLocation.fromTokenLoc(token.loc),
    );
  }
}
