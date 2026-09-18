import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectStorage, ProjectStorageError } from '../project-storage.mjs';
import { resolveProjectMediaUrl } from '../project-media.mjs';

function fixture() { return { id: 'p1', name: 'One', nodes: [], edges: [] }; }
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fc-project-')); }

test('creates, revisions, rejects stale writes, and lists storage version data', () => {
  const dir = temp(); const store = createProjectStorage(dir);
  const first = store.save(fixture(), null);
  assert.equal(first.revision, 1);
  assert.throws(() => store.save({ ...fixture(), name: 'stale' }, 0), (e) => e.code === 'CONFLICT');
  const second = store.save({ ...first, name: 'Two' }, 1);
  assert.equal(second.revision, 2);
  assert.equal(store.list()[0].revision, 2);
});

test('legacy projects default to revision zero and writes are atomic/backed up', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'p1.json'), JSON.stringify({ ...fixture(), name: 'legacy' }));
  const store = createProjectStorage(dir);
  assert.equal(store.list()[0].revision, 0);
  const saved = store.save({ ...fixture(), name: 'new' }, 0);
  assert.equal(saved.revision, 1);
  assert.equal(fs.readdirSync(path.join(dir, '.backups')).length, 1);
});

test('delete requires revision and tombstone prevents resurrection', () => {
  const dir = temp(); const store = createProjectStorage(dir);
  const saved = store.save(fixture(), null);
  assert.throws(() => store.delete('p1', 0), (e) => e.code === 'CONFLICT');
  store.delete('p1', saved.revision);
  assert.throws(() => store.save(fixture(), null), (e) => e.code === 'CONFLICT');
  assert.equal(fs.readdirSync(path.join(dir, '.backups')).length, 1);
});

test('validates ids and graph arrays', () => {
  const store = createProjectStorage(temp());
  assert.throws(() => store.save({ ...fixture(), id: '../x' }, null), ProjectStorageError);
  assert.throws(() => store.save({ ...fixture(), nodes: {} }, null), ProjectStorageError);
});

test('externalizes nested data and generated media with hash deduplication', () => {
  const dir = temp(); const jobs = temp(); const store = createProjectStorage(dir, { jobsDir: jobs });
  const generated = path.join(jobs, 'job.png'); const bytes = Buffer.from('same-bytes'); fs.writeFileSync(generated, bytes);
  const data = `data:image/png;base64,${Buffer.from('upload').toString('base64')}`;
  const saved = store.save({ ...fixture(), nodes: [{ data: { imageUrl: data, timeline: [{ referenceUrl: data }, { resultUrl: '/api/generated/job.png' }] } }], edges: [] }, null);
  assert.match(saved.nodes[0].data.imageUrl, /^\/api\/project-media\/p1\/uploads\/[a-f0-9]{64}\.png$/);
  assert.equal(saved.nodes[0].data.timeline[0].referenceUrl, saved.nodes[0].data.imageUrl);
  assert.match(saved.nodes[0].data.timeline[1].resultUrl, /\/generated\/[a-f0-9]{64}\.png$/);
  assert.deepEqual(fs.readFileSync(resolveProjectMediaUrl(saved.nodes[0].data.imageUrl, dir)), Buffer.from('upload'));
  assert.deepEqual(fs.readFileSync(generated), bytes);
  assert.equal(fs.readdirSync(path.join(dir, 'p1', 'media', 'uploads')).length, 1);
});

test('rejects traversal and symlink escapes for project media', (t) => {
  const dir = temp(); const outside = temp(); fs.writeFileSync(path.join(outside, 'x.png'), 'x');
  assert.throws(() => resolveProjectMediaUrl('/api/project-media/../x/uploads/' + 'a'.repeat(64) + '.png', dir));
  fs.mkdirSync(path.join(dir, 'p1', 'media', 'uploads'), { recursive: true });
  try { fs.symlinkSync(path.join(outside, 'x.png'), path.join(dir, 'p1', 'media', 'uploads', 'a'.repeat(64) + '.png')); }
  catch (error) { if (error.code === 'EPERM') return t.skip('symlinks unavailable on this Windows host'); throw error; }
  assert.throws(() => resolveProjectMediaUrl('/api/project-media/p1/uploads/' + 'a'.repeat(64) + '.png', dir));
});

test('explicit migration backs up and increments only changed projects', () => {
  const dir = temp(); const jobs = temp();
  fs.writeFileSync(path.join(jobs, 'g.mp4'), 'video');
  fs.writeFileSync(path.join(dir, 'p1.json'), JSON.stringify({ ...fixture(), revision: 4, resultUrl: '/api/generated/g.mp4' }));
  const store = createProjectStorage(dir, { jobsDir: jobs });
  assert.equal(store.migrateMedia(jobs), 1);
  assert.equal(store.list()[0].revision, 5);
  assert.equal(fs.readdirSync(path.join(dir, '.backups')).length, 1);
});
