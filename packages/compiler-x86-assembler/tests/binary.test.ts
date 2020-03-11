/// <reference path="./utils/types.d.ts" />

import * as R from 'ramda';

import {asm} from '../src/asm';
import {arrayToHexString} from '../src/parser/compiler/BinaryBlob';

import EQU_BIN_TESTS_LIST from './asm/equ.asm';
import DB_BIN_TESTS_LIST from './asm/db.asm';
import VARIOUS_BIN_TESTS_LIST from './asm/various.asm';

import {parseBinaryTestList} from './utils/parseBinaryTestList';

import './utils/asmMatcher';

const tests = parseBinaryTestList(
  [
    EQU_BIN_TESTS_LIST,
    DB_BIN_TESTS_LIST,
    VARIOUS_BIN_TESTS_LIST,
  ].join('\n'),
);

describe('binary output compare', () => {
  R.forEach(
    ({test, bin, code}) => it(test, () => {
      const result = asm(code);

      expect(
        arrayToHexString(result.unwrap().output.getBinary(), ''),
      ).toBe(bin);
    }),
    tests,
  );
});
