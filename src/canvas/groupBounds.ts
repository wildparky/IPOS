import type { Node } from '@xyflow/react';

/** A member must fit inside its frame (allow subpixel layout rounding). */
export function isInsideGroup(node: Node, group: Node): boolean {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  const groupWidth = group.measured?.width ?? group.width ?? 0;
  const groupHeight = group.measured?.height ?? group.height ?? 0;
  return node.position.x >= group.position.x - 1 && node.position.y >= group.position.y - 1
    && node.position.x + width <= group.position.x + groupWidth + 1
    && node.position.y + height <= group.position.y + groupHeight + 1;
}
