import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteProjectStorage } from '../sqlite-project-storage.mjs';
import { DatabaseSync } from 'node:sqlite';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fc-sqlite-'));
const project = (id = 'p1') => ({ id, name: 'One', nodes: [{ id: 'a', type: 'upload' }, { id: 'b', type: 'text' }], edges: [{ id: 'e', source: 'a', target: 'b' }] });

test('imports legacy JSON once and preserves files', () => {
  const dir = temp(); const file = path.join(dir, 'p1.json'); fs.writeFileSync(file, JSON.stringify(project()));
  const s = createSqliteProjectStorage(dir); assert.equal(s.get('p1').nodes.length, 2); assert.equal(s.summaries()[0].nodeCount, 2); assert.ok(fs.existsSync(file));
  s.delete('p1', 0); s.close(); const again = createSqliteProjectStorage(dir); assert.equal(again.list().length, 0); assert.throws(() => again.save(project(), null), e => e.status === 409); again.close();
});

test('CAS, independent partial merges, conflicts, and cascade are atomic', () => {
  const s = createSqliteProjectStorage(temp()); const p = s.save(project(), null);
  assert.throws(() => s.save({ ...p, name: 'stale' }, 0), e => e.status === 409);
  const a = s.patch('p1', { nodes: [{ id: 'a', before: p.nodes[0], after: { ...p.nodes[0], label: 'x' } }] });
  const b = s.patch('p1', { nodes: [{ id: 'b', before: p.nodes[1], after: { ...p.nodes[1], label: 'y' } }] });
  assert.equal(b.revision, 3); assert.throws(() => s.patch('p1', { nodes: [{ id: 'a', before: p.nodes[0], after: { id: 'a' } }] }), e => e.status === 409);
  const deleted = s.patch('p1', { nodes: [{ id: 'a', before: a.nodes[0], after: null }] }); assert.equal(deleted.edges.length, 0);
  assert.throws(() => s.patch('p1', { nope: true }), e => e.status === 400); s.close();
});

test('summaries use cached metadata and saves/deletes create backups', () => {
  const dir = temp(); const s = createSqliteProjectStorage(dir); const p = s.save(project(), null);
  assert.deepEqual(s.summaries()[0].counts, { image: 1, video: 0, music: 0 });
  s.patch('p1', { name: { before: p.name, after: 'Changed' } }); s.delete('p1', 2);
  assert.equal(fs.readdirSync(path.join(dir, '.backups')).length, 2); s.close();
});

test('migration failure rolls back all imported rows and can be retried without losing originals', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(project('a')));
  fs.writeFileSync(path.join(dir, 'z.json'), '{bad');
  assert.throws(() => createSqliteProjectStorage(dir), e => e.code === 'BAD_JSON');
  const check = new DatabaseSync(path.join(dir, 'projects.sqlite'));
  assert.equal(check.prepare('SELECT count(*) AS n FROM projects').get().n, 0);
  assert.equal(check.prepare("SELECT count(*) AS n FROM meta WHERE key='legacy-import-v1'").get().n, 0);
  check.close();
  fs.writeFileSync(path.join(dir, 'z.json'), JSON.stringify(project('z')));
  const s = createSqliteProjectStorage(dir);
  assert.equal(s.list().length, 2); s.close();
});

test('two DB connections merge distinct entities and stale edits roll back an entire batch', () => {
  const dir = temp(), left = createSqliteProjectStorage(dir), right = createSqliteProjectStorage(dir);
  const p = left.save(project(), null);
  left.patch(p.id, { nodes: [{ id: 'a', before: p.nodes[0], after: { ...p.nodes[0], data: { text: 'left' } } }] });
  right.patch(p.id, { nodes: [{ id: 'b', before: p.nodes[1], after: { ...p.nodes[1], data: { text: 'right' } } }] });
  const current = left.get(p.id);
  assert.equal(current.nodes[0].data.text, 'left'); assert.equal(current.nodes[1].data.text, 'right');
  assert.throws(() => right.patch(p.id, { nodes: [
    { id: 'new', before: null, after: { id: 'new' } },
    { id: 'a', before: p.nodes[0], after: { id: 'a' } },
  ] }), e => e.status === 409);
  assert.deepEqual(left.get(p.id), current); left.close(); right.close();
});

test('delete cascades and stale create cannot resurrect a removed node or edge', () => {
  const s = createSqliteProjectStorage(temp()), p = s.save(project(), null);
  s.patch(p.id, { nodes: [{ id: 'a', before: p.nodes[0], after: null }], edges: [{ id: 'e', before: p.edges[0], after: null }] });
  assert.deepEqual(s.get(p.id).edges, []);
  assert.throws(() => s.patch(p.id, { nodes: [{ id: 'a', before: null, after: p.nodes[0] }] }), e => e.status === 409);
  assert.throws(() => s.patch(p.id, { edges: [{ id: 'e', before: null, after: p.edges[0] }] }), e => e.status === 409);
  s.close();
});

test('full save deletions also prevent stale partial creates', () => {
  const s = createSqliteProjectStorage(temp()), p = s.save(project(), null);
  s.save({ ...p, nodes: [], edges: [] }, p.revision);
  assert.throws(() => s.patch(p.id, { nodes: [{ id: 'a', before: null, after: p.nodes[0] }] }), e => e.status === 409);
  s.close();
});

test('acknowledged undo may restore deleted entities but stale undo cannot', () => {
  const s = createSqliteProjectStorage(temp()), p = s.save(project(), null);
  const deleted = s.patch(p.id, { baseRevision: p.revision, nodes: [{ id: 'a', before: p.nodes[0], after: null }], edges: [{ id: 'e', before: p.edges[0], after: null }] });
  assert.throws(() => s.patch(p.id, { baseRevision: p.revision, nodes: [{ id: 'a', before: null, after: p.nodes[0] }] }), e => e.status === 409);
  const restored = s.patch(p.id, { baseRevision: deleted.revision, nodes: [{ id: 'a', before: null, after: p.nodes[0] }], edges: [{ id: 'e', before: null, after: p.edges[0] }] });
  assert.equal(restored.nodes.length, 2); assert.equal(restored.edges.length, 1); s.close();
});

test('selection changes do not conflict; stale deletion cannot erase new connections', () => {
  const s = createSqliteProjectStorage(temp());
  const p = s.save({ ...project(), nodes: project().nodes.map(n => ({ ...n, selected: true })), edges: [] }, null);
  const before = { ...p.nodes[0] }; delete before.selected;
  const changed = s.patch(p.id, { baseRevision: p.revision, nodes: [{ id: 'a', before, after: { ...before, data: { text: 'new' } } }] });
  s.patch(p.id, { baseRevision: changed.revision, edges: [{ id: 'new-edge', before: null, after: { id: 'new-edge', source: 'a', target: 'b' } }] });
  assert.throws(() => s.patch(p.id, { baseRevision: changed.revision, nodes: [{ id: 'a', before: changed.nodes[0], after: null }] }), e => e.status === 409);
  assert.equal(s.get(p.id).edges.length, 1); s.close();
});

test('patch externalizes original bytes and refreshes cached summary', () => {
  const dir = temp(), s = createSqliteProjectStorage(dir), p = s.save({ ...project(), nodes: [], edges: [] }, null);
  const data = Buffer.from('unchanged original bytes');
  const n = { id: 'photo', type: 'upload', data: { imageUrl: 'data:image/png;base64,' + data.toString('base64') } };
  const result = s.patch(p.id, { nodes: [{ id: n.id, before: null, after: n }] });
  const url = result.nodes[0].data.imageUrl;
  assert.match(url, /^\/api\/project-media\//);
  const file = path.join(dir, p.id, 'media', 'uploads', url.split('/').at(-1));
  assert.deepEqual(fs.readFileSync(file), data);
  const summary = s.summaries()[0];
  assert.equal(summary.nodeCount, 1); assert.equal(summary.counts.image, 1); assert.equal(summary.coverUrl, url);
  assert.equal(typeof summary.updatedAt, 'number');
  // Corrupt graph JSON only: summaries must not deserialize full graphs.
  s.db.prepare('UPDATE nodes SET json=? WHERE project_id=?').run('not-json', p.id);
  assert.equal(s.summaries()[0].nodeCount, 1); s.close();
});

test('malformed and invalid-edge patches do not change project or revision', () => {
  const s = createSqliteProjectStorage(temp()), p = s.save(project(), null);
  for (const patch of [
    { nodes: [{ id: 'a', before: p.nodes[0], after: { id: 'different' } }] },
    { nodes: [{ id: 'x', before: null, after: 'invalid' }] },
    { nodes: [{ id: 'x', before: null, after: { id: 'x' } }, { id: 'x', before: null, after: { id: 'x' } }] },
    { edges: [{ id: 'invalid', before: null, after: { id: 'invalid', source: 'missing', target: 'a' } }] },
  ]) {
    assert.throws(() => s.patch(p.id, patch), e => e.status === 400);
    assert.equal(s.get(p.id).revision, p.revision);
    assert.equal(s.get(p.id).nodes.length, p.nodes.length);
  }
  s.close();
});
