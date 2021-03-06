import {CompilerTimings} from '@compiler/core/utils/compiler/createCompilerTiming';

import {Result, ok} from '@compiler/core/monads/Result';
import {CompilerError} from '@compiler/core/shared/CompilerError';

import {X86Compiler} from './X86Compiler';
import {ASTAsmTree} from '../ast/ASTAsmParser';
import {SecondPassResult} from './BinaryPassResults';

export type CompilerOutput = {
  compiler: X86Compiler,
  output: SecondPassResult,
  timings?: CompilerTimings,
};

export type CompilerFinalResult = Result<CompilerOutput, CompilerError[]>;

/**
 * Transform array of nodes into binary
 *
 * @export
 * @param {ASTAsmTree} tree
 * @returns {CompilerFinalResult}
 */
export function compile(tree: ASTAsmTree): CompilerFinalResult {
  const compiler = new X86Compiler(tree);

  return (
    compiler
      .compile()
      .andThen(
        (output) => ok({
          compiler,
          output,
        }))
  );
}
