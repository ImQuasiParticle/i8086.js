import {Token} from '@compiler/lexer/tokens';
import {NodeLocation} from '@compiler/grammar/tree/NodeLocation';
import {ASTAsmParser, ASTAsmTree} from './ASTAsmParser';
import {ASTNodeKind} from './types';

/**
 * Set of multiple tokens that crates tree
 *
 * @export
 * @class ASTNode
 */
export class ASTAsmNode {
  constructor(
    public readonly kind: ASTNodeKind,
    public readonly loc: NodeLocation,
    public readonly children: ASTAsmNode[] = null,
  ) {}

  /* eslint-disable @typescript-eslint/no-unused-vars */
  static parse(token: Token, parser: ASTAsmParser, tree: ASTAsmTree): ASTAsmNode {
    return null;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  /* eslint-disable class-methods-use-this */
  clone(): ASTAsmNode {
    throw new Error('Unimplemented clone in ASTNode!');
  }

  toString(): string {
    return null;
  }
  /* eslint-enable class-methods-use-this */
}

export const KindASTNode = (kind: ASTNodeKind) => class extends ASTAsmNode {
  constructor(loc: NodeLocation, children: ASTAsmNode[] = null) {
    super(kind, loc, children);
  }
};
