import {TreeNode, ValueNode} from '@compiler/grammar/tree/TreeNode';
import {Grammar} from '@compiler/grammar/Grammar';
import {
  Interpretable,
  InterpreterResult,
  PreprocessorInterpreter,
} from './interpreter/Interpreter';

export enum PreprocessorIdentifier {
  DEFINE,
  MACRO,
  ENDMACRO,
  IF,
  ENDIF,
}

export enum ASTPreprocessorKind {
  Stmt = 'Stmt',
  DefineStmt = 'DefineStmt',
  IfStmt = 'IfStmt',
  MacroStmt = 'MacroStmt',
  SyntaxStmt = 'SyntaxStmt',

  // Expresisons
  LogicExpression = 'LogicExpression',

  // Math operators
  Value = 'Value',
  BinaryOperator = 'BinaryOperator',
}

export class PreprocessorGrammar extends Grammar<PreprocessorIdentifier, ASTPreprocessorKind> {}

export class ASTPreprocessorNode extends TreeNode<ASTPreprocessorKind> implements Interpretable {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  exec(interpreter: PreprocessorInterpreter): InterpreterResult {
    return null;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}

export class ASTPreprocessorValueNode<T> extends ValueNode<T, ASTPreprocessorKind> implements Interpretable {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  exec(interpreter: PreprocessorInterpreter): InterpreterResult {
    return null;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
