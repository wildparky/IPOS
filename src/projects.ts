import { randomUUID } from './uuid';
import type { Node, Edge } from '@xyflow/react';
export interface ProjectSummary {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    revision: number;
    nodeCount: number;
    edgeCount: number;
    counts: {
        image: number;
        video: number;
        music: number;
    };
    coverUrl?: string;
}
export interface Project extends ProjectSummary {
    nodes: Node[];
    edges: Edge[];
}
const CURRENT_KEY = 'franklin-canvas:current-project';
let summaries: ProjectSummary[] = [];
const full = new Map<string, Project>();
let ready = false;
let queue: Promise<void> = Promise.resolve();
const revisions = new Map<string, number>();
const blocked = new Set<string>();
let pending = 0;
export const PROJECTS_CHANGED = 'franklin-projects-changed';
export const PROJECT_MEDIA_CHANGED = 'franklin-project-media-changed';
const mediaUrls = new Map<string, string>();
export function canonicalMedia<T>(v: T): T { if (typeof v === 'string')
    return (mediaUrls.get(v) ?? v) as T; if (Array.isArray(v))
    return v.map(canonicalMedia) as T; if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canonicalMedia(x)])) as T; return v; }
function remember(a: unknown, b: unknown) { if (typeof a === 'string' && typeof b === 'string' && a !== b && b.startsWith('/api/project-media/'))
    mediaUrls.set(a, b);
else if (a && b && typeof a === 'object' && typeof b === 'object')
    for (const [k, v] of Object.entries(a))
        remember(v, (b as Record<string, unknown>)[k]); }
function notify() { window.dispatchEvent(new Event(PROJECTS_CHANGED)); }
async function request(url: string, body?: unknown) { const r = await fetch(url, { ...(body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(15000) }); const d = await r.json(); if (!r.ok || d.ok === false)
    throw new Error(r.status === 409 ? '다른 브라우저에서 변경하거나 삭제했습니다. 복구본을 내보낸 뒤 새로고침하세요.' : d.error || 'Project server error'); return d; }
function put(p: Project) { const x = canonicalMedia(p); full.set(x.id, x); return x; }
async function ensureFull(id: string) { const cached = full.get(id); if (cached)
    return cached; const d = await request('/api/projects/' + encodeURIComponent(id)); if (!d.project)
    throw new Error('Project not found'); revisions.set(id, d.project.revision ?? 0); return put(d.project as Project); }
function enqueue(p: Project, remove = false) { if (blocked.has(p.id))
    return; const snap = JSON.parse(JSON.stringify(p)) as Project; pending++; queue = queue.then(async () => { try {
    if (blocked.has(p.id))
        return;
    const baseRevision = revisions.get(p.id) ?? null;
    const d = await request(remove ? '/api/projects/delete' : '/api/projects/save', remove ? { id: p.id, baseRevision } : { project: canonicalMedia(snap), baseRevision });
    if (remove) {
        summaries = summaries.filter(x => x.id !== p.id);
        full.delete(p.id);
        revisions.delete(p.id);
    }
    else {
        const revision = d.project?.revision ?? d.revision;
        if (typeof revision !== 'number')
            throw new Error('백엔드를 새 버전으로 재시작하세요.');
        revisions.set(p.id, revision);
        if (d.project) {
            remember(snap, d.project);
            const latest = full.get(p.id);
            if (latest)
                put({ ...canonicalMedia(latest), revision });
            window.dispatchEvent(new Event(PROJECT_MEDIA_CHANGED));
        }
    }
    notify();
}
catch (e) {
    blocked.add(p.id);
    try {
        localStorage.setItem('franklin-recovery:' + p.id, JSON.stringify(full.get(p.id) ?? snap));
    }
    catch { }
    alert('프로젝트 저장 실패: ' + (e as Error).message + '\\nProjects의 복구본 내보내기로 작업을 보관할 수 있습니다.');
}
finally {
    pending--;
} }); }
export async function hydrateFromFiles() { await queue; const d = await request('/api/projects?summary=1'); if (d.storageVersion !== 2)
    throw new Error('백엔드를 새 버전으로 재시작한 뒤 다시 시도하세요.'); if (!Array.isArray(d.projects))
    throw new Error('Invalid project response'); if (pending)
    return; summaries = [...d.projects.filter((p: ProjectSummary) => !blocked.has(p.id)), ...summaries.filter(p => blocked.has(p.id))]; for (const p of d.projects as ProjectSummary[])
    if (!full.has(p.id) && !blocked.has(p.id))
        revisions.set(p.id, p.revision ?? 0); ready = true; notify(); }
export async function loadProject(id: string) {
    await queue;
    if (blocked.has(id))
        return ensureFull(id);
    const data = await request('/api/projects/' + encodeURIComponent(id));
    if (pending)
        return ensureFull(id);
    revisions.set(id, data.project.revision ?? 0);
    return put(data.project);
}
export async function loadCurrentProject() {
    const selected = getCurrentId();
    const id = summaries.some(p => p.id === selected) ? selected : listProjects()[0]?.id;
    if (!id) {
        try {
            localStorage.removeItem(CURRENT_KEY);
        }
        catch { }
        return null;
    }
    setCurrentId(id);
    return loadProject(id);
}
export function listProjects() { return [...summaries].sort((a, b) => b.updatedAt - a.updatedAt); }
export function getCurrentId() { try {
    return localStorage.getItem(CURRENT_KEY);
}
catch {
    return null;
} }
export function setCurrentId(id: string) { try {
    localStorage.setItem(CURRENT_KEY, id);
}
catch { } }
export function getProject(id: string) { return full.get(id) || null; }
export function getOrCreateCurrent(seed?: {
    nodes: Node[];
    edges: Edge[];
}): Project { if (!ready)
    throw new Error('Project server is not ready'); const id = getCurrentId() || listProjects()[0]?.id; const p = id ? full.get(id) : undefined; if (p)
    return p; if (id)
    throw new Error('Selected project is still loading'); return createProject('Untitled project', seed); }
export function createProject(name = 'Untitled project', seed?: {
    nodes: Node[];
    edges: Edge[];
}): Project { const now = Date.now(); const p = { id: 'p_' + randomUUID().replaceAll('-', ''), name, nodes: seed?.nodes ?? [], edges: seed?.edges ?? [], createdAt: now, updatedAt: now, revision: 0, nodeCount: seed?.nodes.length ?? 0, edgeCount: seed?.edges.length ?? 0, counts: { image: 0, video: 0, music: 0 } }; summaries = [p, ...summaries]; put(p); setCurrentId(p.id); enqueue(p); notify(); return p; }
export async function renameProject(id: string, name: string) { const p = await ensureFull(id); const n = { ...p, name, updatedAt: Date.now() }; put(n); summaries = summaries.map(x => x.id === id ? { ...x, name: n.name, updatedAt: n.updatedAt } : x); enqueue(n); notify(); }
export async function deleteProject(id: string) { enqueue(await ensureFull(id), true); }
export function saveProjectCanvas(id: string, nodes: Node[], edges: Edge[]) { const p = full.get(id); if (!p || (JSON.stringify(p.nodes) === JSON.stringify(nodes) && JSON.stringify(p.edges) === JSON.stringify(edges)))
    return; const n = { ...p, nodes, edges, nodeCount: nodes.length, edgeCount: edges.length, updatedAt: Date.now() }; put(n); summaries = summaries.map(x => x.id === id ? { ...x, updatedAt: n.updatedAt, nodeCount: nodes.length, edgeCount: edges.length } : x); enqueue(n); }
export function exportProjectRecovery() { const b = new Blob([JSON.stringify([...full.values()])], { type: 'application/json' }); const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = 'franklin-recovery-' + Date.now() + '.json'; a.click(); URL.revokeObjectURL(u); }
export function importLegacyProjects() { const saved = JSON.parse(localStorage.getItem('franklin-canvas:projects') || '[]') as Project[]; if (!Array.isArray(saved))
    throw new Error('Invalid legacy projects'); for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('franklin-recovery:'))
        saved.push(JSON.parse(localStorage.getItem(key)!));
} if (!saved.length) {
    const nodes = JSON.parse(localStorage.getItem('franklin-canvas:nodes') || '[]'), edges = JSON.parse(localStorage.getItem('franklin-canvas:edges') || '[]');
    if (nodes.length || edges.length)
        createProject('Legacy canvas (복구본)', { nodes, edges });
    else
        alert('이 브라우저에 기존 프로젝트가 없습니다.');
} for (const p of saved)
    if (Array.isArray(p.nodes) && Array.isArray(p.edges))
        createProject(p.name + ' (복구본)', p); }
window.addEventListener('beforeunload', e => { if (pending || blocked.size) {
    e.preventDefault();
    e.returnValue = '';
} });
