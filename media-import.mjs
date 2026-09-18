import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { resolveProjectMediaUrl } from './project-media.mjs';

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function safeExt(ext, fallback) {
  return /^[a-z0-9]{1,5}$/i.test(ext || '') ? ext.toLowerCase() : fallback;
}

function makeTempPath(dir, ext) {
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${safeExt(ext, 'bin')}`);
}

function dataUrlToBuffer(value) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value || '');
  if (!match) throw new Error('Unsupported data URL');
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64') };
}

export async function materializeMedia(value, { jobsDir, prefix = 'input', maxBytes = 30 * 1024 * 1024 } = {}) {
  if (!value || typeof value !== 'string') throw new Error('media input is required');
  if (value.startsWith('/api/project-media/')) return resolveProjectMediaUrl(value, path.join(path.dirname(jobsDir || path.join(os.homedir(), '.franklin', 'web-jobs')), 'projects'));
  const tmpDir = path.join(jobsDir || path.join(os.homedir(), '.franklin', 'media'), 'bridge-inputs');
  if (value.startsWith('data:')) {
    const { mime, buffer } = dataUrlToBuffer(value);
    if (buffer.length > maxBytes) throw new Error('media input is too large');
    const out = makeTempPath(tmpDir, MIME_EXT[mime] || 'bin');
    fs.writeFileSync(out, buffer);
    return out;
  }
  if (value.startsWith('/api/generated/')) {
    const filename = path.basename(value.slice('/api/generated/'.length).split('?')[0]);
    const root = path.resolve(jobsDir || path.join(os.homedir(), '.franklin', 'web-jobs'));
    const candidate = path.resolve(root, filename);
    if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate)) throw new Error('generated media not found');
    return candidate;
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`media download failed (${response.status})`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error('media download is too large');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('media download is too large');
    const ext = MIME_EXT[(response.headers.get('content-type') || '').split(';')[0].toLowerCase()] || path.extname(new URL(value).pathname).slice(1) || 'bin';
    const out = makeTempPath(tmpDir, ext);
    fs.writeFileSync(out, buffer);
    return out;
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error('media path not found');
  return resolved;
}

export function copyImportedMedia(source, jobsDir, jobId, fallbackExt = 'bin') {
  if (!source) throw new Error('bridge returned no media path');
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('bridge media path does not exist');
  const ext = safeExt(path.extname(resolved).slice(1), fallbackExt);
  const target = path.join(jobsDir, `${jobId}.${ext}`);
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.copyFileSync(resolved, target);
  return { path: target, ext };
}
