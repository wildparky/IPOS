import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function api() {
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/projectMerge.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, structuredClone };
  vm.runInNewContext(source, context);
  return context.exports;
}
const { cleanGraph, graphPatch, mergeProject } = api();
const g = (nodes, edges = [], name = 'x') => ({ id: 'p', name, nodes, edges, revision: 9 });

test('cleans transient state but preserves dimensions and style', () => {
  const out = cleanGraph(g([{ id: 'a', selected: true, dragging: false, measured: { width: 1 }, width: 20, height: 30, style: { color: 'red' } }], [{ id: 'e', selected: true }]));
  assert.deepEqual(JSON.parse(JSON.stringify(out.nodes[0])), { id: 'a', width: 20, height: 30, style: { color: 'red' } });
  assert.deepEqual(JSON.parse(JSON.stringify(out.edges[0])), { id: 'e' });
});
test('merges distinct edits, additions, deletion conflicts, and names', () => {
  const base = g([{ id: 'a', v: 1 }, { id: 'b', v: 1 }]);
  const merged = mergeProject(base, g([{ id: 'a', v: 2 }, { id: 'b', v: 1 }, { id: 'l' }]), g([{ id: 'a', v: 1 }, { id: 'b', v: 3 }, { id: 'r' }]));
  assert.deepEqual(JSON.parse(JSON.stringify(merged.nodes.map(x => x.id))), ['a', 'b', 'r', 'l']);
  assert.throws(() => mergeProject(base, g([{ id: 'a', v: 2 }]), g([{ id: 'a', v: 3 }])), /Conflict/);
  assert.equal(mergeProject(base, g(base.nodes, [], 'local'), g(base.nodes, [], 'x')).name, 'local');
});
test('diff is deterministic and ignores transient differences', () => {
  const before = g([{ id: 'a', v: 1, selected: true }]);
  const after = g([{ id: 'a', v: 1, selected: false }, { id: 'b', v: 2 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(graphPatch(cleanGraph(before), cleanGraph(after)))), { nodes: [{ id: 'b', before: null, after: { id: 'b', v: 2 } }], edges: [] });
});
