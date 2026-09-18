import type { Node, Edge } from '@xyflow/react';

/** Left-to-right dependency columns, vertically stacked within each column. */
export function arrangeNodes(nodes: Node[], edges: Edge[], origin: { x: number; y: number }) {
  const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
  const ids = new Set(ordered.map(n => n.id));
  const links = edges.filter(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const remaining = new Set(ids);
  const rank = new Map<string, number>();
  // When a cycle exists, break its ordering tie deterministically; every node
  // is still placed once, without an unbounded dependency traversal.
  while (remaining.size) {
    const ready = ordered.filter(n => remaining.has(n.id) && !links.some(e => e.target === n.id && remaining.has(e.source)));
    const batch = ready.length ? ready : [ordered.find(n => remaining.has(n.id))!];
    for (const n of batch) {
      const parents = links.filter(e => e.target === n.id && rank.has(e.source));
      rank.set(n.id, parents.length ? Math.max(...parents.map(e => rank.get(e.source)! + 1)) : 0);
      remaining.delete(n.id);
    }
  }
  const positions = new Map<string, { x: number; y: number }>();
  let x = origin.x, height = 0;
  const ranks = [...new Set(rank.values())].sort((a,b) => a-b);
  for (const column of ranks) {
    const members = ordered.filter(n => rank.get(n.id) === column);
    let y = origin.y;
    for (const n of members) {
      positions.set(n.id, { x, y });
      y += (n.measured?.height ?? n.height ?? 280) + 48;
    }
    height = Math.max(height, y - origin.y - 48);
    x += Math.max(...members.map(n => n.measured?.width ?? n.width ?? 280)) + 80;
  }
  return { positions, width: nodes.length ? x - origin.x - 80 : 0, height };
}
