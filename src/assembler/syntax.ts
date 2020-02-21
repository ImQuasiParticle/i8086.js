import {tagFunction} from './utils/tagFunction';
import {
  compile,
  ast,
  lexer,
} from './parser';

/**
 * Root of evil
 *
 * @param {String} code
 */
const make = tagFunction(
  (code: string) => compile(ast(lexer(code))),
);

/* eslint-disable no-console,@typescript-eslint/no-unused-expressions */
make`
  int 3
  mov al, byte [si + 0x5]
`;
/* eslint-enable no-console,@typescript-eslint/no-unused-expressions */
