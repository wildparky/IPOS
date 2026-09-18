import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MEDIA_KEYS = new Set(['imageUrl', 'resultUrl', 'referenceUrl', 'referenceUrl2', 'referenceUrls', 'url']);
const MIME_EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif', avif: 'avif', bmp: 'bmp', mp4: 'mp4', webm: 'webm', quicktime: 'mov', mpeg: 'mp3', wav: 'wav', ogg: 'ogg' };

function safeId(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('bad project id'); return id; }
function extFor(mime, fallback = 'bin') { return MIME_EXT[mime.split('/')[1]] || (/^[a-z0-9]{1,8}$/i.test(fallback) ? fallback.toLowerCase() : 'bin'); }
function sourcePath(url, jobsDir) {
  const name = path.basename(url.split('/').pop().split('?')[0]);
  if (!name || name === '.' || name === '..') throw new Error('invalid media URL');
  const root = path.resolve(jobsDir);
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) throw new Error('unsafe media URL');
  return file;
}
function bytesFor(url, jobsDir) {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    if (!m || !/^((image|audio|video)\/[\w.+-]+)$/i.test(m[1])) throw new Error('unsupported media data URL');
    return { bytes: Buffer.from(m[2], 'base64'), ext: extFor(m[1].toLowerCase()) };
  }
  if (url.startsWith('/api/generated/')) {
    const file = sourcePath(url, jobsDir);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('generated media not found');
    return { bytes: fs.readFileSync(file), ext: extFor('', path.extname(file).slice(1)) };
  }
  return null;
}
function walk(value, fn) {
  if (Array.isArray(value)) return value.map(v => walk(v, fn));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, MEDIA_KEYS.has(k) ? fn(k, v) : walk(v, fn)]));
}

export function externalizeProject(project, { projectsDir, jobsDir } = {}) {
  if (!project || typeof project !== 'object' || !projectsDir || !jobsDir) throw new Error('project, projectsDir and jobsDir are required');
  const id = safeId(project.id);
  const mediaRoot = path.join(path.resolve(projectsDir), id, 'media');
  const out = walk(project, (key, value) => {
    if (Array.isArray(value)) return value.map(v => externalizeValue(v, id, mediaRoot, jobsDir));
    return externalizeValue(value, id, mediaRoot, jobsDir);
  });
  return out;
}
function externalizeValue(value, id, mediaRoot, jobsDir) {
  if (typeof value !== 'string') return value;
  const source = bytesFor(value, jobsDir);
  if (!source) return value;
  const hash = crypto.createHash('sha256').update(source.bytes).digest('hex');
  const bucket = value.startsWith('data:') ? 'uploads' : 'generated';
  const file = path.join(mediaRoot, bucket, `${hash}.${source.ext}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, source.bytes, { flag: 'wx' });
  if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) throw new Error('Stored media integrity verification failed');
  return `/api/project-media/${id}/${bucket}/${hash}.${source.ext}`;
}

export function resolveProjectMediaUrl(url, projectsDir) {
  if (typeof url !== 'string' || !url.startsWith('/api/project-media/')) return null;
  const m = /^\/api\/project-media\/([^/]+)\/(uploads|generated)\/([a-f0-9]{64})\.([a-z0-9]{1,8})$/i.exec(url.split('?')[0]);
  if (!m) throw new Error('invalid project media URL');
  const root = path.resolve(projectsDir);
  const file = path.resolve(root, safeId(m[1]), 'media', m[2], `${m[3].toLowerCase()}.${m[4].toLowerCase()}`);
  if (!file.startsWith(root + path.sep)) throw new Error('unsafe project media path');
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(file);
  if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) throw new Error('project media not found');
  return real;
}

export function migrateMedia(jobsDir, projectsDir) {
  const changed = [];
  if (!projectsDir) throw new Error('projectsDir is required');
  for (const name of fs.readdirSync(projectsDir)) {
    if (!/^[-A-Za-z0-9_]+\.json$/.test(name)) continue;
    const file = path.join(projectsDir, name); const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    const next = externalizeProject(p, { projectsDir, jobsDir });
    if (JSON.stringify(next) !== JSON.stringify(p)) changed.push({ file, project: next });
  }
  return changed;
}
