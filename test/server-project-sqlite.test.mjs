import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('HTTP project storage migrates, preserves media, supports CAS and isolated entity patches', async t => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-sqlite-http-'));
  const dir = path.join(temporaryHome, '.franklin', 'projects');
  fs.mkdirSync(dir, { recursive: true });
  const original = { id: 'legacy', name: 'Legacy', revision: 7, createdAt: 1, updatedAt: 2,
    nodes: [{ id: 'old', type: 'upload', position: { x: 0, y: 0 }, data: {} }], edges: [] };
  const legacyFile = path.join(dir, 'legacy.json');
  fs.writeFileSync(legacyFile, JSON.stringify(original));
  const port = 34200 + Math.floor(Math.random() * 700);
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, HOME: temporaryHome, USERPROFILE: temporaryHome, PORT: String(port), BLOCKRUN_API_KEY: 'brk_test_storage' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    // Only this test's explicit mkdtemp directory is removed, after the DB handle closes.
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.ok(ready, output);
  const get = async suffix => (await fetch(base + suffix)).json();
  const post = async (suffix, body) => {
    const res = await fetch(base + suffix, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const summary = await get('/api/projects?summary=1');
  assert.equal(summary.storageEngine, 'sqlite');
  assert.equal(summary.projects[0].revision, 7);
  assert.equal(summary.projects[0].nodes, undefined);
  assert.equal(summary.projects[0].createdAt, 1);
  assert.ok(fs.existsSync(path.join(dir, 'projects.sqlite')));
  const bytes = Buffer.from('original-image-bytes');
  const photo = { id: 'photo', type: 'upload', position: { x: 30, y: 20 }, data: { imageUrl: 'data:image/png;base64,' + bytes.toString('base64') } };
  const saved = await post('/api/projects/save', { project: { ...original, nodes: [...original.nodes, photo] }, baseRevision: 7 });
  assert.equal(saved.status, 200);
  const url = saved.data.project.nodes[1].data.imageUrl;
  assert.match(url, /^\/api\/project-media\/legacy\/uploads\//);
  assert.deepEqual(Buffer.from(await (await fetch(base + url)).arrayBuffer()), bytes);
  assert.equal((await post('/api/projects/save', { project: original, baseRevision: 7 })).status, 409);
  const baseline = saved.data.project.nodes;
  for (const [index, x] of [[0, 100], [1, 200]]) {
    const before = baseline[index], after = { ...before, position: { x, y: 0 } };
    assert.equal((await post('/api/projects/patch', { id: 'legacy', patch: { nodes: [{ id: before.id, before, after }] } })).status, 200);
  }
  const read = (await get('/api/projects/legacy')).project;
  assert.deepEqual(read.nodes.map(n => n.position.x), [100, 200]);
  assert.equal((await post('/api/projects/patch', { id: 'legacy', patch: { nodes: [{ id: baseline[0].id, before: baseline[0], after: baseline[0] }] } })).status, 409);
  assert.equal((await post('/api/projects/patch', { id: 'legacy', patch: { nodes: 'bad' } })).status, 400);
  const audit = await post('/api/media/audit', { references: [] });
  assert.equal(audit.data.files.find(f => f.url === url).state, 'referenced');
  assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile)), original);
  assert.equal((await post('/api/projects/delete', { id: 'legacy', baseRevision: read.revision })).status, 200);
  assert.equal((await post('/api/projects/save', { project: original, baseRevision: null })).status, 409);
});
