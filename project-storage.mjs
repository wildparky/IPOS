import fs from 'node:fs';
import path from 'node:path';
import { externalizeProject, migrateMedia as scanMedia } from './project-media.mjs';

const BACKUP_DIR = '.backups';
const TOMBSTONES = '.tombstones.json';

export class ProjectStorageError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function validateProjectId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || id.length > 128) {
    throw new ProjectStorageError('BAD_ID', 'bad id', 400);
  }
  return id;
}

function validateProject(project) {
  if (!project || typeof project !== 'object') throw new ProjectStorageError('BAD_PROJECT', 'project required');
  const id = validateProjectId(project.id);
  if (!Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
    throw new ProjectStorageError('BAD_GRAPH', 'project.nodes and project.edges must be arrays');
  }
  return { ...project, id };
}

function revisionOf(project) { return Number.isInteger(project?.revision) && project.revision >= 0 ? project.revision : 0; }

export class ProjectStorage {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.backupDir = path.join(this.dir, BACKUP_DIR);
    this.tombstonePath = path.join(this.dir, TOMBSTONES);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  file(id) { return path.join(this.dir, `${validateProjectId(id)}.json`); }
  get(id) {
    const file = this.file(id);
    if (!fs.existsSync(file)) throw new ProjectStorageError('NOT_FOUND', 'project not found', 404);
    const project = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...project, revision: revisionOf(project) };
  }
  summaries() {
    return this.list().map(p => {
      const counts = { image: 0, video: 0, music: 0 };
      let coverUrl;
      for (const n of p.nodes) {
        if (['upload', 'imagegen'].includes(n.type)) {
          counts.image++;
          const url = n.data?.resultUrl || n.data?.imageUrl;
          if (!coverUrl && typeof url === 'string' && !url.startsWith('data:')) coverUrl = url;
        } else if (n.type === 'videogen') counts.video++;
        else if (n.type === 'musicgen') counts.music++;
      }
      return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, revision: p.revision, nodeCount: p.nodes.length, edgeCount: p.edges.length, counts, coverUrl };
    });
  }
  tombstones() {
    try { const value = JSON.parse(fs.readFileSync(this.tombstonePath, 'utf8')); return value && typeof value === 'object' ? value : {}; }
    catch { return {}; }
  }
  writeAtomic(file, value) {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
    try { fs.renameSync(tmp, file); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
  }
  backup(file) {
    if (!fs.existsSync(file)) return;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
    fs.copyFileSync(file, path.join(this.backupDir, `${path.basename(file, '.json')}-${stamp}.json`));
  }
  list() {
    const projects = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith('.json') || name === TOMBSTONES) continue;
      try {
        const p = JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
        if (p && typeof p === 'object' && Array.isArray(p.nodes) && Array.isArray(p.edges)) projects.push({ ...p, revision: revisionOf(p) });
      } catch {}
    }
    return projects;
  }
  save(input, baseRevision) {
    const project = validateProject(input);
    if (!(baseRevision === null || Number.isInteger(baseRevision))) throw new ProjectStorageError('BAD_REVISION', 'baseRevision must be null or a number');
    const file = this.file(project.id);
    const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (!current && this.tombstones()[project.id]) throw new ProjectStorageError('CONFLICT', 'project was deleted', 409);
    if (current && baseRevision === null) throw new ProjectStorageError('CONFLICT', 'baseRevision required for existing project', 409);
    if (current && baseRevision !== revisionOf(current)) throw new ProjectStorageError('CONFLICT', 'revision conflict', 409);
    if (!current && baseRevision !== null) throw new ProjectStorageError('CONFLICT', 'project does not exist', 409);
    const media = externalizeProject(project, { projectsDir: this.dir, jobsDir: this.jobsDir });
    const saved = { ...media, revision: current ? revisionOf(current) + 1 : 1 };
    this.backup(file); this.writeAtomic(file, saved);
    return saved;
  }
  migrateMedia(jobsDir = this.jobsDir) {
    const changes = scanMedia(jobsDir, this.dir);
    for (const change of changes) {
      const current = JSON.parse(fs.readFileSync(change.file, 'utf8'));
      this.backup(change.file);
      this.writeAtomic(change.file, { ...change.project, revision: revisionOf(current) + 1 });
    }
    return changes.length;
  }
  delete(id, baseRevision) {
    id = validateProjectId(id);
    if (!Number.isInteger(baseRevision)) throw new ProjectStorageError('BAD_REVISION', 'baseRevision must be a number');
    const file = this.file(id);
    let current = null;
    if (fs.existsSync(file)) current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!current) throw new ProjectStorageError('CONFLICT', 'project does not exist', 409);
    if (baseRevision !== revisionOf(current)) throw new ProjectStorageError('CONFLICT', 'revision conflict', 409);
    this.backup(file);
    const tombstones = this.tombstones(); tombstones[id] = { revision: revisionOf(current), deletedAt: Date.now() };
    this.writeAtomic(this.tombstonePath, tombstones);
    fs.rmSync(file);
    return { id, revision: revisionOf(current) };
  }
}

export function createProjectStorage(dir, { jobsDir } = {}) { const store = new ProjectStorage(dir); store.jobsDir = path.resolve(jobsDir || path.join(dir, '..', 'web-jobs')); return store; }
