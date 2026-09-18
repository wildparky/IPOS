import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditMedia } from '../media-audit.mjs';
import { createProjectStorage } from '../project-storage.mjs';

test('summary omits graph and inline image while detail retains full graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-summary-'));
  const p = { id: 'p', name: 'Test', nodes: [{ id: 'n', type: 'upload', data: { imageUrl: 'data:image/png;base64,YQ==' } }], edges: [], updatedAt: 1 };
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify(p));
  const store = createProjectStorage(dir);
  const s = store.summaries()[0];
  assert.equal(s.nodes, undefined); assert.equal(s.edges, undefined); assert.equal(s.coverUrl, undefined);
  assert.equal(s.counts.image, 1); assert.equal(s.nodeCount, 1);
  assert.deepEqual(store.get('p').nodes, p.nodes);
  assert.throws(() => store.get('../p'));
  assert.throws(() => store.get('missing'), e => e.status === 404);
});

test('read-only audit protects nested references, backups, browser refs and recent files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-audit-'));
  const projectsDir = path.join(dir, 'projects'), jobsDir = path.join(dir, 'jobs');
  fs.mkdirSync(path.join(projectsDir, '.backups'), { recursive: true }); fs.mkdirSync(jobsDir);
  for (const name of ['active', 'backup', 'collection', 'old', 'recent']) {
    const f = path.join(jobsDir, name + '.mp4'); fs.writeFileSync(f, name);
    if (name !== 'recent') fs.utimesSync(f, new Date(0), new Date(0));
  }
  fs.writeFileSync(path.join(projectsDir, 'p.json'), JSON.stringify({ nodes: [{ data: { timeline: [{ url: '/api/generated/active.mp4' }] } }] }));
  fs.writeFileSync(path.join(projectsDir, '.backups', 'p.json'), JSON.stringify({ url: '/api/generated/backup.mp4' }));
  const before = fs.readdirSync(jobsDir);
  const args = { projectsDir, jobsDir, extraReferences: ['/api/generated/collection.mp4'] };
  const r = auditMedia(args);
  assert.equal(r.totals.candidateFiles, 1);
  assert.equal(r.files.find(f => f.state === 'candidate').url, '/api/generated/old.mp4');
  assert.deepEqual(fs.readdirSync(jobsDir), before);
  fs.writeFileSync(path.join(projectsDir, 'corrupt.json'), '{');
  const failed = auditMedia(args);
  assert.equal(failed.totals.candidateFiles, 0); assert.ok(failed.warnings.length);
});
