export enum ASTNodeKind {
  INSTRUCTION,
  LABEL,
  DEFINE,
  COMPILER_OPTION,
  TIMES,
}

/**
 * User for resolve labels in AST
 */
export type BinaryLabelsOffsets = Map<string, number>;