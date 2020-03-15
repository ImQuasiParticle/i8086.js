/* eslint-disable no-use-before-define, @typescript-eslint/no-use-before-define */
import {isLineTerminatorToken} from '@compiler/lexer/utils';

import {TokenType, NumberToken, Token, TokenKind} from '@compiler/lexer/tokens';
import {Grammar, GrammarInitializer, SyntaxError} from '@compiler/grammar/Grammar';
import {TreePrintVisitor} from '@compiler/grammar/tree/TreeVisitor';
import {NodeLocation} from '@compiler/grammar/tree/NodeLocation';

import {empty} from '@compiler/grammar/matchers';
import {fetchTokensUntilEOL} from '@compiler/grammar/utils/fetchTokensUntilEOL';
import {mathExpression} from './matchers';

import {
  ASTPreprocessorSyntaxLine,
  ASTPreprocessorMacro,
  ASTPreprocessorDefine,
  ASTPreprocessorDefineArgSchema,
  ASTPreprocessorIF,
} from './nodes';

import {
  PreprocessorIdentifier,
  ASTPreprocessorKind,
  ASTPreprocessorNode,
} from './constants';

const preprocessorMatcher: GrammarInitializer<PreprocessorIdentifier, ASTPreprocessorKind> = ({g}) => {
  /**
   * Consumes all EOL characters from line begin
   *
   * @returns {TreeNode}
   */
  function startLine(): ASTPreprocessorNode {
    do {
      const token = g.fetchRelativeToken(0, false);
      if (token.type === TokenType.EOL)
        g.consume();
      else
        break;
    } while (true);

    return null;
  }

  /**
   * Matches identifier that must be in single line, without others
   *
   * @param {PreprocessorIdentifier} identifier
   * @returns {Token}
   */
  function singleLineIdentifier(identifier: PreprocessorIdentifier): Token {
    startLine();
    return g.identifier(identifier);
  }

  /**
   * Matches %ifdef
   *
   * @returns {TreeNode}
   */
  function ifStmt(): ASTPreprocessorNode {
    const startToken = singleLineIdentifier(PreprocessorIdentifier.IF);

    const expression = mathExpression(g);
    body();
    g.identifier(PreprocessorIdentifier.ENDIF);

    return new ASTPreprocessorIF(
      NodeLocation.fromTokenLoc(startToken.loc),
      expression,
      null,
    );
  }

  /**
   * matches %macro
   *
   * @returns {TreeNode}
   */
  function macroStmt(): ASTPreprocessorNode {
    const startToken = singleLineIdentifier(PreprocessorIdentifier.MACRO);
    const [name, argsCount, children] = [
      g.match(
        {
          type: TokenType.KEYWORD,
        },
      ).text,

      (<NumberToken> g.match(
        {
          type: TokenType.NUMBER,
          optional: true,
        },
      ))?.value?.number ?? 0,

      body(),
    ];

    startLine();
    g.identifier(PreprocessorIdentifier.ENDMACRO);

    return new ASTPreprocessorMacro(
      NodeLocation.fromTokenLoc(startToken.loc),
      name,
      argsCount,
      children,
    );
  }

  /**
   * matches %define
   *
   * @returns {TreeNode}
   */
  function defineStmt(): ASTPreprocessorNode {
    const startToken = singleLineIdentifier(PreprocessorIdentifier.DEFINE);
    const nameToken = g.match(
      {
        type: TokenType.KEYWORD,
      },
    );

    // args list match name(adef, b, c)
    const args: ASTPreprocessorDefineArgSchema[] = [];
    if (nameToken.kind === TokenKind.BRACKET_PREFIX) {
      g.match(
        {
          type: TokenType.BRACKET,
          terminal: '(',
        },
      );

      do {
        const token = g.consume();
        if (token.type === TokenType.COMMA)
          continue;

        if (token.kind === TokenKind.PARENTHES_BRACKET && token.text === ')')
          break;

        if (token.type !== TokenType.KEYWORD)
          throw new SyntaxError;

        args.push(
          new ASTPreprocessorDefineArgSchema(token.text),
        );
      } while (true);
    }

    // definition content
    const expression = fetchTokensUntilEOL(g);
    if (!expression.length)
      throw new SyntaxError;

    // eslint-disable-next-line
    return new ASTPreprocessorDefine(
      NodeLocation.fromTokenLoc(startToken.loc),
      nameToken.text,
      args,
      expression,
    );
  }

  /**
   * Match res of line
   *
   * @returns {TreeNode}
   */
  function syntaxLine(): ASTPreprocessorNode {
    startLine();

    const loc = g.fetchRelativeToken(0, false)?.loc;
    const tokens: Token[] = [];

    do {
      const token = g.consume();
      if (!token || isLineTerminatorToken(token))
        break;
      else {
        if (token.kind === TokenKind.IDENTIFIER)
          throw new SyntaxError;

        tokens.push(token);
      }
    } while (true);

    return new ASTPreprocessorSyntaxLine(
      NodeLocation.fromTokenLoc(loc),
      tokens,
    );
  }

  /**
   * Matches body of define and main documen
   *
   * @returns {TreeNode[]}
   */
  function body(): ASTPreprocessorNode[] {
    return g.matchList(
      {
        ifStmt,
        defineStmt,
        macroStmt,
        syntaxLine,
        empty,
      },
    );
  }

  return body;
};

export const preprocessor = Grammar.build(
  {
    identifiers: {
      '%if': PreprocessorIdentifier.IF,
      '%endif': PreprocessorIdentifier.ENDIF,
      '%define': PreprocessorIdentifier.DEFINE,
      '%macro': PreprocessorIdentifier.MACRO,
      '%endmacro': PreprocessorIdentifier.ENDMACRO,
    },
  },
  preprocessorMatcher,
);

const ast = preprocessor.process(`
  %if 3+2*5
    xor bx, cx
  %endif

  %define test_define(arg1,brg2,c) abc
  %define test_define2 abce
  %macro dupa 3
    %macro test_abc 4
      xor ax, bx
      mov bx, [bx:cx+5]
    %endmacro

    %define test_define(arg1,brg2,c) abc
    %define test_define2 abce
  %endmacro
`);

console.info((new TreePrintVisitor).visit(ast).reduced);
