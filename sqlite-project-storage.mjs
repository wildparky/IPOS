import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { externalizeProject } from './project-media.mjs';
import { ProjectStorageError, validateProjectId } from './project-storage.mjs';

const json = value => JSON.stringify(value);
const sortJson = value => {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortJson(value[k])]));
  return value;
};
const same = (a, b) => json(sortJson(a)) === json(sortJson(b));
const rev = p => Number.isInteger(p?.revision) && p.revision >= 0 ? p.revision : 0;
const fail = (code, message, status = 400) => { throw new ProjectStorageError(code, message, status); };
function patchShape(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) fail('BAD_PATCH', 'patch object required');
  if (Object.keys(change).some(k => !['nodes', 'edges', 'name', 'baseRevision'].includes(k))) fail('BAD_PATCH', 'unknown patch field');
  if (change.baseRevision !== undefined && (!Number.isInteger(change.baseRevision) || change.baseRevision < 0)) fail('BAD_PATCH', 'invalid baseRevision');
  for (const kind of ['nodes', 'edges']) if (change[kind] !== undefined) {
    if (!Array.isArray(change[kind])) fail('BAD_PATCH', `${kind} must be an array`);
    for (const x of change[kind]) if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !Object.prototype.hasOwnProperty.call(x, 'before') || !Object.prototype.hasOwnProperty.call(x, 'after')) fail('BAD_PATCH', `malformed ${kind} patch`);
    for (const x of change[kind]) {
      if (!x.id || x.id.length > 512) fail('BAD_PATCH', 'invalid entity id');
      for (const side of ['before', 'after']) if (x[side] !== null &&
        (!x[side] || typeof x[side] !== 'object' || Array.isArray(x[side]) || x[side].id !== x.id)) {
        fail('BAD_PATCH', `invalid ${kind} ${side}`);
      }
    }
  }
  if (change.name !== undefined && (!change.name || typeof change.name !== 'object' || typeof change.name.after !== 'string' || !Object.prototype.hasOwnProperty.call(change.name, 'before'))) fail('BAD_PATCH', 'malformed name patch');
}

function checkedProject(p) {
  if (!p || typeof p !== 'object') fail('BAD_PROJECT', 'project required');
  const id = validateProjectId(p.id);
  if (!Array.isArray(p.nodes) || !Array.isArray(p.edges)) fail('BAD_GRAPH', 'project.nodes and project.edges must be arrays');
  const ids = (items, label) => { const s = new Set(); for (const x of items) { if (!x || typeof x.id !== 'string' || s.has(x.id)) fail('BAD_GRAPH', `duplicate or missing ${label} id`); s.add(x.id); } };
  ids(p.nodes, 'node'); ids(p.edges, 'edge');
  return { ...p, id };
}
function countNodes(nodes) {
  const counts = { image: 0, video: 0, music: 0 }; let coverUrl;
  for (const n of nodes) {
    if (['upload', 'imagegen'].includes(n.type)) { counts.image++; const u = n.data?.resultUrl || n.data?.imageUrl; if (!coverUrl && typeof u === 'string' && !u.startsWith('data:')) coverUrl = u; }
    else if (n.type === 'videogen') counts.video++;
    else if (n.type === 'musicgen') counts.music++;
  }
  return { counts, coverUrl };
}

export class SqliteProjectStorage {
  constructor(dir, { jobsDir } = {}) {
    this.dir = path.resolve(dir); this.jobsDir = path.resolve(jobsDir || path.join(this.dir, '..', 'web-jobs'));
    fs.mkdirSync(this.dir, { recursive: true }); this.db = new DatabaseSync(path.join(this.dir, 'projects.sqlite'));
    try {
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, metadata TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER, node_count INTEGER NOT NULL, edge_count INTEGER NOT NULL, image_count INTEGER NOT NULL, video_count INTEGER NOT NULL, music_count INTEGER NOT NULL, cover_url TEXT);
      CREATE TABLE IF NOT EXISTS nodes (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, id TEXT NOT NULL, json TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(project_id,id));
      CREATE TABLE IF NOT EXISTS edges (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, id TEXT NOT NULL, json TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(project_id,id));
      CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, deleted_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS entity_tombstones (project_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(project_id,kind,id));
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.#importLegacy();
    } catch (error) { this.db.close(); throw error; }
  }
  #tx(fn, mode = 'IMMEDIATE') { this.db.exec(`BEGIN ${mode}`); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; } }
  #backup(p) { fs.mkdirSync(path.join(this.dir, '.backups'), { recursive: true }); const file = path.join(this.dir, '.backups', `${p.id}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(file, json(p)); }
  #importLegacy() {
    this.#tx(() => {
      if (this.db.prepare("SELECT 1 FROM meta WHERE key='legacy-import-v1'").get()) return;
      const tomb = path.join(this.dir, '.tombstones.json'); let oldTomb = {};
      if (fs.existsSync(tomb)) { try { oldTomb = JSON.parse(fs.readFileSync(tomb, 'utf8')); } catch { fail('BAD_JSON', 'corrupt tombstones file'); } }
      if (!oldTomb || typeof oldTomb !== 'object' || Array.isArray(oldTomb)) fail('BAD_JSON', 'invalid tombstones file');
      for (const [id, v] of Object.entries(oldTomb)) {
        validateProjectId(id);
        if (!v || typeof v !== 'object') fail('BAD_JSON', 'invalid tombstone');
        this.db.prepare('INSERT OR IGNORE INTO tombstones VALUES (?,?,?)').run(id, rev(v), v.deletedAt || Date.now());
      }
      for (const name of fs.readdirSync(this.dir)) {
        if (!/^[A-Za-z0-9_-]{1,128}\.json$/.test(name)) continue;
        const id = name.slice(0, -5); let p; try { p = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')); } catch { fail('BAD_JSON', `corrupt project JSON: ${name}`); }
        if (!p || typeof p !== 'object') continue;
        if (!Array.isArray(p.nodes) || !Array.isArray(p.edges)) { if ('nodes' in p || 'edges' in p) fail('BAD_GRAPH', `invalid project JSON: ${name}`); continue; }
        if (this.db.prepare('SELECT 1 FROM tombstones WHERE id=?').get(id)) continue;
        if (p.id !== id) fail('BAD_ID', `project id does not match filename: ${name}`);
        this.#insert(checkedProject(p));
      }
      this.db.prepare("INSERT INTO meta VALUES ('legacy-import-v1','1')").run();
    });
  }
  #insert(p) {
    const c = countNodes(p.nodes); const r = rev(p); const metadata = { ...p }; delete metadata.nodes; delete metadata.edges; delete metadata.revision;
    metadata.nodeCount = p.nodes.length; metadata.edgeCount = p.edges.length;
    metadata.counts = c.counts; metadata.coverUrl = c.coverUrl;
    this.db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(p.id, p.name ?? null, json(metadata), r, p.createdAt == null ? null : Number(p.createdAt), p.updatedAt == null ? null : Number(p.updatedAt), p.nodes.length, p.edges.length, c.counts.image, c.counts.video, c.counts.music, c.coverUrl ?? null);
    const ns = this.db.prepare('INSERT INTO nodes VALUES (?,?,?,?)'); p.nodes.forEach((n, i) => ns.run(p.id, n.id, json(n), i));
    const es = this.db.prepare('INSERT INTO edges VALUES (?,?,?,?)'); p.edges.forEach((e, i) => es.run(p.id, e.id, json(e), i));
  }
  #read(id, withGraph = true) {
    const p = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id); if (!p) fail('NOT_FOUND', 'project not found', 404);
    const out = { ...JSON.parse(p.metadata), id, name: p.name, revision: p.revision, createdAt: p.created_at, updatedAt: p.updated_at };
    if (withGraph) { out.nodes = this.db.prepare('SELECT json FROM nodes WHERE project_id=? ORDER BY ordinal').all(id).map(x => JSON.parse(x.json)); out.edges = this.db.prepare('SELECT json FROM edges WHERE project_id=? ORDER BY ordinal').all(id).map(x => JSON.parse(x.json)); }
    return out;
  }
  get(id) { validateProjectId(id); return this.#tx(() => this.#read(id), 'DEFERRED'); }
  list() { return this.#tx(() => this.db.prepare('SELECT id FROM projects ORDER BY rowid').all().map(x => this.#read(x.id)), 'DEFERRED'); }
  summaries() { return this.db.prepare('SELECT id,name,created_at AS createdAt,updated_at AS updatedAt,revision,node_count AS nodeCount,edge_count AS edgeCount,image_count,video_count,music_count,cover_url AS coverUrl FROM projects ORDER BY rowid').all().map(p => ({ id:p.id,name:p.name,createdAt:p.createdAt,updatedAt:p.updatedAt,revision:p.revision,nodeCount:p.nodeCount,edgeCount:p.edgeCount,counts:{image:p.image_count,video:p.video_count,music:p.music_count},coverUrl:p.coverUrl ?? undefined })); }
  // Called only inside a write transaction. Files already externalized are retained
  // on rollback; audit's grace period protects these unreferenced artifacts.
  #replace(previous, next) {
    if (previous) {
      this.#backup(previous);
      for (const kind of ['nodes', 'edges']) {
        const remaining = new Set(next[kind].map(item => item.id));
        for (const item of previous[kind]) if (!remaining.has(item.id)) {
          this.db.prepare('INSERT OR IGNORE INTO entity_tombstones VALUES (?,?,?)').run(next.id, kind, item.id);
        }
      }
      this.db.prepare('DELETE FROM projects WHERE id=?').run(next.id);
    }
    this.#insert(next);
    return this.#read(next.id);
  }
  save(input, baseRevision) {
    const p = checkedProject(input);
    if (!(baseRevision === null || Number.isInteger(baseRevision))) fail('BAD_REVISION', 'baseRevision must be null or a number');
    return this.#tx(() => {
      const cur = this.db.prepare('SELECT revision FROM projects WHERE id=?').get(p.id);
      if (!cur && this.db.prepare('SELECT 1 FROM tombstones WHERE id=?').get(p.id)) fail('CONFLICT', 'project was deleted', 409);
      if (cur && baseRevision === null) fail('CONFLICT', 'baseRevision required for existing project', 409);
      if (cur && baseRevision !== cur.revision) fail('CONFLICT', 'revision conflict', 409);
      if (!cur && baseRevision !== null) fail('CONFLICT', 'project does not exist', 409);
      const out = externalizeProject(p, { projectsDir: this.dir, jobsDir: this.jobsDir });
      out.revision = cur ? cur.revision + 1 : 1;
      return this.#replace(cur ? this.#read(p.id) : null, out);
    });
  }
  delete(id, baseRevision) { validateProjectId(id); if (!Number.isInteger(baseRevision)) fail('BAD_REVISION','baseRevision must be a number'); return this.#tx(() => { const p=this.db.prepare('SELECT revision FROM projects WHERE id=?').get(id); if (!p || p.revision !== baseRevision) fail('CONFLICT',p?'revision conflict':'project does not exist',409); this.#backup(this.#read(id)); this.db.prepare('DELETE FROM projects WHERE id=?').run(id); this.db.prepare('INSERT INTO tombstones VALUES (?,?,?)').run(id,p.revision,Date.now()); return {id,revision:p.revision}; }); }
  patch(id, change) {
    validateProjectId(id); patchShape(change);
    return this.#tx(() => {
      const p = this.#read(id), edits = [];
      for (const kind of ['nodes', 'edges']) {
        const seen = new Set();
        for (const item of change[kind] || []) {
          if (seen.has(item.id)) fail('BAD_PATCH', `duplicate ${kind} id`); seen.add(item.id);
          if (item.after !== null && (!item.after || typeof item.after !== 'object' || Array.isArray(item.after) || item.after.id !== item.id)) fail('BAD_PATCH', `invalid ${kind} after`);
          const row = this.db.prepare(`SELECT json FROM ${kind} WHERE project_id=? AND id=?`).get(id, item.id);
          const persisted = value => {
            if (!value) return value;
            const copy = { ...value };
            for (const key of kind === 'nodes' ? ['selected', 'dragging', 'resizing', 'measured'] : ['selected']) delete copy[key];
            return copy;
          };
          if (!same(persisted(row ? JSON.parse(row.json) : null), persisted(item.before))) fail('CONFLICT', `${kind} changed`, 409);
          // An explicit undo is allowed only against the current acknowledged revision.
          if (!row && item.after !== null && change.baseRevision !== p.revision && this.db.prepare('SELECT 1 FROM entity_tombstones WHERE project_id=? AND kind=? AND id=?').get(id, kind, item.id)) fail('CONFLICT', `${kind} was deleted`, 409);
          edits.push({ kind, item });
        }
      }
      if (change.name && !same(p.name, change.name.before)) fail('CONFLICT', 'name changed', 409);
      if (change.baseRevision !== undefined && change.baseRevision !== p.revision) {
        const removed = new Set((change.nodes || []).filter(n => n.after === null).map(n => n.id));
        for (const edge of p.edges) if (removed.has(edge.source) || removed.has(edge.target)) {
          const edit = (change.edges || []).find(e => e.id === edge.id);
          if (!edit || !same(edit.before, edge)) fail('CONFLICT', 'node connections changed', 409);
        }
      }
      const graph = { nodes: new Map(p.nodes.map(n => [n.id, n])), edges: new Map(p.edges.map(e => [e.id, e])) };
      const removedNodes = new Set();
      for (const { kind, item } of edits) {
        if (item.after === null) {
          graph[kind].delete(item.id);
          if (kind === 'nodes' && item.before !== null) removedNodes.add(item.id);
        } else graph[kind].set(item.id, item.after);
      }
      // Explicit edge additions/updates must be valid, not silently discarded.
      for (const item of change.edges || []) if (item.after &&
        (!graph.nodes.has(item.after.source) || !graph.nodes.has(item.after.target))) {
        fail('BAD_GRAPH', 'edge references missing node');
      }
      for (const [edgeId, edge] of graph.edges) {
        if (removedNodes.has(edge.source) || removedNodes.has(edge.target)) graph.edges.delete(edgeId);
      }
      const nodes = [...graph.nodes.values()], edges = [...graph.edges.values()];
      const valid = new Set(nodes.map(n => n.id));
      if (edges.some(e => !valid.has(e.source) || !valid.has(e.target))) fail('BAD_GRAPH', 'edge references missing node');
      const next = externalizeProject(checkedProject({ ...p, ...(change.name ? { name: change.name.after } : {}),
        nodes, edges, revision: p.revision + 1, updatedAt: Date.now() }), { projectsDir: this.dir, jobsDir: this.jobsDir });
      return this.#replace(p, next);
    });
  }
  migrateMedia(jobsDir=this.jobsDir) { let n=0; for (const p of this.list()) { const out=externalizeProject(p,{projectsDir:this.dir,jobsDir}); if (!same(out,p)) { this.save(out,p.revision); n++; } } return n; }
  close() { this.db.close(); }
}
export function createSqliteProjectStorage(dir, options={}) { return new SqliteProjectStorage(dir, options); }
