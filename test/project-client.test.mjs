import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function client() {
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/projects.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let project = { id: 'p', name: 'P', nodes: [], edges: [], revision: 3, updatedAt: 1 };
  const saves = [], calls = [], errors = [], store = new Map();
  const context = { exports: {}, window: { addEventListener() {}, dispatchEvent() {} }, Event, AbortSignal, crypto: { randomUUID: () => 'new-id' }, alert: e => errors.push(e), localStorage: { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k) }, fetch: async (url, opts) => {
    calls.push(url);
    let data;
    if(url.endsWith('?summary=1')) data={ok:true, storageVersion:2, projects:[{id:project.id,name:project.name,revision:project.revision,updatedAt:1,counts:{image:0,video:0,music:0}}]};
    else if(url.endsWith('/save')) {
      const body=JSON.parse(opts.body); saves.push(body);
      project={...body.project,revision:body.baseRevision===null?1:body.baseRevision+1}; data={ok:true,project};
    } else data={ok:true,project};
    return { ok:true,status:200,json:async()=>structuredClone(data) };
  }};
  context.require = () => ({ randomUUID: () => 'new-id' });
  vm.runInNewContext(source, context);
  return { api:context.exports, saves, calls, errors, store, remoteRevision:r=>{project.revision=r;} };
}
test('summary polling does not fetch graphs or replace loaded revision tokens', async()=>{
  const c=client();await c.api.hydrateFromFiles();assert.equal(c.calls.length,1);
  await c.api.loadCurrentProject();c.remoteRevision(99);await c.api.hydrateFromFiles();
  c.api.saveProjectCanvas('p',[{id:'n'}],[]);await c.api.hydrateFromFiles();
  assert.equal(c.saves[0].baseRevision,3);
});
test('create uses null revision; serialized subsequent saves use acknowledged revision',async()=>{
  const c=client();await c.api.hydrateFromFiles();const p=c.api.createProject('New');
  c.api.saveProjectCanvas(p.id,[{id:'a'}],[]);c.api.saveProjectCanvas(p.id,[{id:'b'}],[]);
  await c.api.hydrateFromFiles();
  assert.deepEqual(c.saves.map(s=>s.baseRevision),[null,1,2]);
  assert.equal(c.api.getProject(p.id).nodes[0].id,'b');assert.equal(c.errors.length,0);
});
test('stale selected project falls back to an existing project at startup',async()=>{
  const c=client();c.store.set('franklin-canvas:current-project','deleted');await c.api.hydrateFromFiles();await c.api.loadCurrentProject();
  assert.equal(c.api.getOrCreateCurrent().id,'p');
});
