// Read-only inventory. Never offers a delete operation: other browsers may hold references.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function auditMedia({ projectsDir, jobsDir, projects, extraReferences = [], now = Date.now(), graceDays = 30 }) {
  const active = new Set(), backups = new Set(), hashes = new Set();
  const warnings = [];
  function refs(value, target) {
    if (typeof value === 'string') {
      if (value.startsWith('/api/project-media/') || value.startsWith('/api/generated/')) target.add(value.split('?')[0]);
      else if (/^data:(image|video|audio)\/[^;]+;base64,/.test(value)) hashes.add(crypto.createHash('sha256').update(Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')).digest('hex'));
    } else if (value && typeof value === 'object') Object.values(value).forEach(v => refs(v, target));
  }
  function jsonRefs(dir, target) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith('.json') || entry.name === '.tombstones.json') continue;
      if (!entry.isFile() || entry.isSymbolicLink()) { warnings.push('Skipped non-regular reference file'); continue; }
      try { refs(JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8')), target); }
      catch { warnings.push('Some reference files could not be read; candidates are unverified'); }
    }
  }
  // With SQLite, old top-level JSON is a backup, not current state.
  if (projects !== undefined) {
    if (!Array.isArray(projects)) throw new TypeError('projects must be an array');
    refs(projects, active);
    jsonRefs(projectsDir, backups);
  } else jsonRefs(projectsDir, active);
  jsonRefs(path.join(projectsDir, '.backups'), backups);
  refs(extraReferences, active);
  const files = [];
  function inventory(dir, prefix, category) {
    if (!fs.existsSync(dir)) return;
    if (fs.lstatSync(dir).isSymbolicLink()) { warnings.push('Skipped linked media directory'); return; }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const stat = fs.statSync(path.join(dir, entry.name));
      const url = prefix + entry.name;
      const ageDays = Math.max(0, (now - stat.mtimeMs) / 86400000);
      const hash = entry.name.split('.')[0];
      let state = active.has(url) ? 'referenced' : backups.has(url) || hashes.has(hash) ? 'backup-protected' : ageDays < graceDays ? 'recent' : 'candidate';
      files.push({ url, category, bytes: stat.size, ageDays: Math.floor(ageDays), state });
    }
  }
  if (fs.existsSync(projectsDir)) for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[A-Za-z0-9_-]+$/.test(entry.name)) continue;
    const projectDir = path.join(projectsDir, entry.name);
    const mediaDir = path.join(projectDir, 'media');
    if (fs.existsSync(mediaDir) && fs.lstatSync(mediaDir).isSymbolicLink()) { warnings.push('Skipped linked media directory'); continue; }
    for (const bucket of ['uploads', 'generated']) inventory(path.join(mediaDir, bucket), `/api/project-media/${entry.name}/${bucket}/`, bucket);
  }
  inventory(jobsDir, '/api/generated/', 'shared-generated');
  if (warnings.length) for (const file of files) if (file.state === 'candidate') file.state = 'unverified';
  const totals = { files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), candidateFiles: 0, candidateBytes: 0 };
  for (const file of files) if (file.state === 'candidate') { totals.candidateFiles++; totals.candidateBytes += file.bytes; }
  return { ok: true, readOnly: true, graceDays, totals, files, warnings: [...new Set(warnings)], limitations: ['Other browsers may have unsynced collections or drafts. Candidates are not safe-to-delete determinations.', 'Temporary bridge inputs, task work directories and backup JSON sizes are excluded.'] };
}
