import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createSqliteProjectStorage } from '../sqlite-project-storage.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fc-client-'));
const project = () => ({ id: 'p1', name: 'One', createdAt: 1, updatedAt: 1, revision: 0, nodes: [{ id: 'a', type: 'text', data: { text: 'a' } }, { id: 'b', type: 'text', data: { text: 'b' } }], edges: [] });
const compile = file => ts.transpileModule(fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function server({ legacy = false } = {}) {
  const storage = createSqliteProjectStorage(temp()), calls = [], pending = [], deferred = [];
  storage.save(project(), null);
  async function fetcher(url, opts = {}) {
    calls.push({ url, opts }); const u = new URL(url, 'http://fc'), body = opts.body && JSON.parse(opts.body);
    const run = () => { try {
      let value;
      if (u.pathname === '/api/projects' && u.search) value = { ok: true, storageVersion: 2, projects: storage.summaries(), ...(legacy ? {} : { capabilities: ['entity-patch'] }) };
      else if (u.pathname === '/api/projects/save') value = { ok: true, project: storage.save(body.project, body.baseRevision) };
      else if (u.pathname === '/api/projects/patch') value = { ok: true, project: storage.patch(body.id, body.patch) };
      else if (u.pathname === '/api/projects/delete') { storage.delete(body.id, body.baseRevision); value = { ok: true }; }
      else { const id = decodeURIComponent(u.pathname.split('/').at(-1)); const p = storage.get(id); if (!p) throw Object.assign(new Error('missing'), { status: 404 }); value = { ok: true, project: p }; }
      return { ok: true, status: 200, json: async () => value };
    } catch (e) { return { ok: false, status: e.status ?? (e.code === 'NOT_FOUND' ? 404 : 400), json: async () => ({ ok: false, error: e.message }) }; } };
    const match = deferred.findIndex(x => x.test(u.pathname, opts));
    if (match < 0) return run();
    deferred.splice(match, 1);
    return new Promise(resolve => pending.push({ resolve, run, url, opts }));
  }
  return { storage, calls, pending, fetcher, deferNext: (test = () => true) => deferred.push({ test }), close: () => storage.close() };
}

function client(s) {
  const source = { projects: compile('projects.ts'), uuid: compile('uuid.ts'), projectMerge: compile('projectMerge.ts') }, loaded = {}, values = new Map(), listeners = new Map(), events = [], alerts = [];
  class E { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  const window = { addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(f); }, dispatchEvent(e) { events.push(e); for (const f of listeners.get(e.type) ?? []) f(e); } };
  const base = { exports: {}, module: { exports: {} }, Event: E, CustomEvent: E, structuredClone, setTimeout, clearTimeout, AbortSignal, fetch: s.fetcher, window, alert: x => alerts.push(x), URL, Blob, crypto: { randomUUID: () => 'uuid' }, localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k), get length() { return values.size; }, key: i => [...values.keys()][i] }, document: { createElement: () => ({ click() {} }) } };
  function load(name) { if (loaded[name]) return loaded[name]; const mod = { exports: {} }; loaded[name] = mod.exports; const req = x => x === './uuid' ? load('uuid') : x === './projectMerge' ? load('projectMerge') : require(x); vm.runInNewContext(`(function(require,exports,module){${source[name]}\n})(require,exports,module)`, { ...base, require: req, exports: mod.exports, module: mod }); return mod.exports; }
  return { api: load('projects'), values, events, alerts };
}
async function ready(s, ...cs) { for (const c of cs) { await c.api.hydrateFromFiles(); await c.api.loadProject('p1'); } }
function edit(c, id, text) { const p = c.api.getProject('p1'); c.api.saveProjectCanvas('p1', p.nodes.map(n => n.id === id ? { ...n, data: { text } } : n), p.edges); }

test('two clients converge on disjoint node saves', async () => { const s = server(), a = client(s), b = client(s); try { await ready(s, a, b); edit(a, 'a', 'left'); await a.api.flushProjects(); edit(b, 'b', 'right'); await b.api.flushProjects(); await a.api.pollProject('p1'); assert.equal(a.api.getProject('p1').nodes.find(n => n.id === 'a').data.text, 'left'); assert.equal(a.api.getProject('p1').nodes.find(n => n.id === 'b').data.text, 'right'); } finally { s.close(); } });

test('same-node 409 blocks and keeps recovery', async () => { const s = server(), a = client(s), b = client(s); try { await ready(s, a, b); edit(a, 'a', 'left'); await a.api.flushProjects(); edit(b, 'a', 'right'); await b.api.flushProjects(); assert.match(b.api.projectSyncMessage('p1'), /Save paused/); assert.ok(b.values.has('franklin-recovery:p1')); assert.equal(b.api.getProject('p1').nodes.find(n => n.id === 'a').data.text, 'right'); } finally { s.close(); } });

test('delayed response retains latest edit and coalesces new project create', async () => { const s = server(), c = client(s); try { await c.api.hydrateFromFiles(); await c.api.loadProject('p1'); s.deferNext(path => path.endsWith('/patch') || path.endsWith('/save')); edit(c, 'a', 'first'); const inflight = c.api.flushProjects(); const wait = async () => { while (!s.pending.length) await new Promise(queueMicrotask); return s.pending.shift(); }; const req = await wait(); edit(c, 'a', 'latest'); req.resolve(req.run()); await inflight; await c.api.flushProjects(); assert.equal(s.storage.get('p1').nodes.find(n => n.id === 'a').data.text, 'latest'); const p = c.api.createProject('New'); await c.api.flushProjects(); assert.equal(s.calls.filter(x => x.url.endsWith('/save') && x.opts.body.includes(p.id)).length, 1); } finally { s.close(); } });

test('name plus node changes, selection-only changes, and media remain canonical', async () => { const s = server(), c = client(s); try { await c.api.hydrateFromFiles(); await c.api.loadProject('p1'); const n = c.api.getProject('p1').nodes.map(x => ({ ...x, selected: !x.selected })), count = s.calls.length; c.api.saveProjectCanvas('p1', n, []); await c.api.flushProjects(); assert.equal(s.calls.length, count); await c.api.renameProject('p1', 'Renamed'); await c.api.flushProjects(); assert.equal(s.storage.get('p1').name, 'Renamed'); c.api.saveProjectCanvas('p1', [...c.api.getProject('p1').nodes, { id: 'm', type: 'upload', data: { imageUrl: 'data:image/png;base64,eA==' } }], []); await c.api.flushProjects(); assert.match(s.storage.get('p1').nodes.find(x => x.id === 'm').data.imageUrl, /^\/api\/project-media\//); } finally { s.close(); } });

test('correlates reordered remote media additions by entity id', async () => { const s = server(), local = client(s), remote = client(s); try { await ready(s, local, remote); const remoteUrl = 'data:image/png;base64,cmVtb3Rl'; remote.api.saveProjectCanvas('p1', [...remote.api.getProject('p1').nodes, { id: 'remote-image', type: 'upload', data: { imageUrl: remoteUrl } }], []); await remote.api.flushProjects(); const localUrl = 'data:image/png;base64,bG9jYWw='; local.api.saveProjectCanvas('p1', [...local.api.getProject('p1').nodes, { id: 'local-image', type: 'upload', data: { imageUrl: localUrl } }], []); await local.api.flushProjects(); const result = local.api.getProject('p1').nodes, own = result.find(n => n.id === 'local-image').data.imageUrl, other = result.find(n => n.id === 'remote-image').data.imageUrl; assert.match(own, /^\/api\/project-media\//); assert.match(other, /^\/api\/project-media\//); assert.notEqual(own, other); assert.equal(s.storage.get('p1').nodes.find(n => n.id === 'local-image').data.imageUrl, own); } finally { s.close(); } });

test('remote deletion blocks and legacy mode uses full save CAS', async () => { const s = server(), c = client(s); try { await c.api.hydrateFromFiles(); await c.api.loadProject('p1'); s.storage.delete('p1', 1); await c.api.pollProject('p1'); assert.match(c.api.projectSyncMessage('p1'), /Save paused/); } finally { s.close(); } const old = server({ legacy: true }), legacy = client(old); try { await legacy.api.hydrateFromFiles(); await legacy.api.loadProject('p1'); edit(legacy, 'a', 'legacy'); await legacy.api.flushProjects(); assert.equal(old.calls.some(x => x.url.endsWith('/patch')), false); } finally { old.close(); } });

test('in-flight poll cannot replace a local edit', async () => { const s = server(), c = client(s); try { await c.api.hydrateFromFiles(); await c.api.loadProject('p1'); s.deferNext(path => path.endsWith('/p1')); const poll = c.api.pollProject('p1'); while (!s.pending.length) await new Promise(queueMicrotask); edit(c, 'a', 'local'); const req = s.pending.shift(); req.resolve(req.run()); await poll; assert.equal(c.api.getProject('p1').nodes.find(n => n.id === 'a').data.text, 'local'); } finally { s.close(); } });
