import * as R from 'ramda';

import {
  isComment,
  isQuote,
  isNewline,
  matchQuote,
  matchBracket,
  flipBracket,
} from './utils/matchCharacter';

import {LexerError, LexerErrorCode} from './shared/LexerError';
import {
  Token,
  TokenType,
  TokenLocation,
  TokenKind,
  IdentifierToken,
} from './tokens';

export type IdentifiersMap = {
  [key: string]: number, // identifier ID => text
};

export type TokenTerminalCharactersMap = {
  [operator: string]: TokenType,
};

export type TokenParsersMap = {
  [parser: string]: (token?: string, loc?: TokenLocation) => boolean | Token,
};

export const TERMINAL_CHARACTERS: TokenTerminalCharactersMap = {
  // single
  ',': TokenType.COMMA,
  ':': TokenType.COLON,
  '+': TokenType.PLUS,
  '-': TokenType.MINUS,
  '*': TokenType.MUL,
  '/': TokenType.DIV,
  '!': TokenType.NOT,
  '&': TokenType.BIT_AND,
  '|': TokenType.BIT_OR,
  '^': TokenType.POW,

  // binary
  '<<': TokenType.BIT_SHIFT_LEFT,
  '>>': TokenType.BIT_SHIFT_RIGHT,
  '==': TokenType.EQUAL,
  '!=': TokenType.DIFFERS,
  '>': TokenType.GREATER_THAN,
  '>=': TokenType.GREATER_EQ_THAN,
  '<': TokenType.LESS_THAN,
  '<=': TokenType.LESS_EQ_THAN,
  '&&': TokenType.AND,
  '||': TokenType.OR,
  '++': TokenType.INCREMENT,
  '--': TokenType.DECREMENT,
};

/**
 * Analyze single token
 *
 * @param {IdentifiersMap} identifiers
 * @param {TokenParsersMap} tokensParsers
 * @param {TokenLocation} location
 * @param {string} token
 * @returns {Token}
 */
function parseToken(
  identifiers: IdentifiersMap,
  tokensParsers: TokenParsersMap,
  location: TokenLocation,
  token: string,
): Token {
  if (!token || !token.length)
    return null;

  const identifier = identifiers && identifiers[R.toLower(token)];
  if (!R.isNil(identifier))
    return new IdentifierToken(identifier, token, location.clone());

  for (const tokenType in tokensParsers) {
    const result = tokensParsers[tokenType](token, location);
    if (!result)
      continue;

    // result might return boolean return from has() function
    if (result === true)
      return new Token(<any> tokenType, null, token, location.clone());

    // it might be also object without type
    if (!result?.type)
      return new Token(<any> tokenType, null, token, location.clone(), result);

    return result;
  }

  throw new LexerError(LexerErrorCode.UNKNOWN_TOKEN, null, {token});
}

/**
 * Flags used for parsing flow control
 */
export type LexerConfig = {
  tokensParsers?: TokenParsersMap,
  appendEOF?: boolean,
  signOperatorsAsSeparateTokens?: boolean,
  terminalCharacters?: TokenTerminalCharactersMap,
  identifiers?: IdentifiersMap,
  allowBracketPrefixKeyword?: boolean, // dupa[xD]
  consumeBracketContent?: boolean,
};

/**
 * Split code into tokens
 *
 * @see
 *  It contains also lexer logic!
 *
 * @export
 * @param {LexerConfig} config
 * @param {string} code
 * @returns {IterableIterator<Token>}
 */
export function* lexer(config: LexerConfig, code: string): IterableIterator<Token> {
  const {
    identifiers,
    tokensParsers,
    allowBracketPrefixKeyword,
    terminalCharacters = TERMINAL_CHARACTERS,
    appendEOF = true,
    signOperatorsAsSeparateTokens = false,
    consumeBracketContent = true,
  } = config;

  const {length} = code;
  const location = new TokenLocation;

  let tokenBuffer = '';
  let offset = 0;

  function* appendToken(token: Token): Iterable<Token> {
    if (!token)
      return;

    tokenBuffer = '';
    yield token;
  }

  function* appendCharToken(type: TokenType, character: string): IterableIterator<Token> {
    if (R.trim(tokenBuffer).length) {
      yield* appendToken(
        parseToken(identifiers, tokensParsers, location, tokenBuffer),
      );
    }

    yield* appendToken(
      new Token(
        type,
        null,
        character,
        location.clone(),
      ),
    );
  }

  function* appendTokenWithSpaces(
    type: TokenType,
    kind: TokenKind,
    fetchUntil: (str: string) => boolean,
  ): Iterable<Token> {
    tokenBuffer = '';
    for (;; ++offset) {
      if (fetchUntil(code[offset]))
        break;

      if (offset >= length)
        throw new LexerError(LexerErrorCode.UNTERMINATED_STRING);

      tokenBuffer += code[offset];
    }

    yield* appendToken(
      new Token(type, kind, tokenBuffer, location.clone()),
    );

    tokenBuffer = '';
  }

  for (; offset < length; ++offset) {
    const character = code[offset];
    const newLine = isNewline(character);

    // used for logger
    if (newLine) {
      location.column = 0;
      location.row++;
    } else
      location.column++;

    // ignore line, it is comment
    if (isComment(character)) {
      for (; offset < length - 1; ++offset) {
        if (isNewline(code[offset + 1]))
          break;
      }
      continue;
    }

    // special tokens that might contain spaces inside them
    const quote = matchQuote(character);
    if (quote) {
      if (tokenBuffer)
        throw new LexerError(LexerErrorCode.UNKNOWN_TOKEN, null, {token: tokenBuffer});

      offset++;
      yield* appendTokenWithSpaces(TokenType.QUOTE, quote, isQuote);
      continue;
    }

    const bracket = matchBracket(character);
    if (bracket) {
      if (tokenBuffer) {
        // handle case test[123]
        if (allowBracketPrefixKeyword) {
          // if empty character
          if (character === '(') {
            yield* appendToken(
              new Token(
                TokenType.KEYWORD,
                TokenKind.BRACKET_PREFIX,
                tokenBuffer,
                location.clone(),
              ),
            );
          } else {
            yield* appendToken(
              parseToken(identifiers, tokensParsers, location, tokenBuffer),
            );
          }
        } else
          throw new LexerError(LexerErrorCode.UNKNOWN_TOKEN, null, {token: tokenBuffer});
      }

      if (consumeBracketContent) {
        const flippedBracket = flipBracket(character);
        let nesting = 1;

        offset++;
        yield* appendTokenWithSpaces(
          TokenType.BRACKET,
          bracket,
          (c) => {
            if (c === character)
              nesting++;
            else if (c === flippedBracket)
              nesting--;

            return nesting <= 0;
          },
        );
      } else {
        yield* appendToken(
          new Token(
            TokenType.BRACKET,
            bracket,
            character,
            location.clone(),
          ),
        );
      }

      continue;
    }

    // end of line
    if (newLine)
      yield* appendCharToken(TokenType.EOL, character);
    else {
      // handle ++, && etc. two byte terminals
      const binarySeparator = character + code[offset + 1];
      if (terminalCharacters[binarySeparator]) {
        offset++;
        yield* appendCharToken(
          terminalCharacters[binarySeparator],
          binarySeparator,
        );
      } else {
        // handle single character terminals
        const separator = terminalCharacters[character];
        if (separator) {
          // numbers - +1, -2
          if (!signOperatorsAsSeparateTokens
              && (separator === TokenType.PLUS || separator === TokenType.MINUS)
              && Number.isInteger(+code[offset + 1]))
            tokenBuffer += character;
          else
            yield* appendCharToken(separator, character);
        } else if (character !== ' ') {
          // append character and find matching token
          tokenBuffer += character;
        } else {
          // if empty character
          yield* appendToken(
            parseToken(identifiers, tokensParsers, location, tokenBuffer),
          );
        }
      }
    }
  }

  if (tokenBuffer) {
    yield* appendToken(
      parseToken(identifiers, tokensParsers, location, tokenBuffer),
    );
  }

  // end of file
  if (appendEOF)
    yield* appendCharToken(TokenType.EOF, null);
}
