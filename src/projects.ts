import { randomUUID } from './uuid';
import { cleanGraph, graphPatch, mergeProject } from './projectMerge';
import type { Node, Edge } from '@xyflow/react';

export interface ProjectSummary {
    id: string; name: string; createdAt: number; updatedAt: number; revision: number;
    nodeCount: number; edgeCount: number;
    counts: { image: number; video: number; music: number }; coverUrl?: string;
}
export interface Project extends ProjectSummary { nodes: Node[]; edges: Edge[] }
const CURRENT_KEY = 'franklin-canvas:current-project';
let summaries: ProjectSummary[] = [], ready = false, partial = false;
const full = new Map<string, Project>(), acknowledged = new Map<string, Project>();
const blocked = new Set<string>(), deleting = new Set<string>();
let queue: Promise<void> = Promise.resolve(), busy = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
export const PROJECTS_CHANGED = 'franklin-projects-changed';
export const PROJECT_GRAPH_CHANGED = 'franklin-project-graph-changed';
export const PROJECT_SYNC_CHANGED = 'franklin-project-sync-changed';
const syncMessages = new Map<string, string>(), mediaUrls = new Map<string, string>();
export function canonicalMedia<T>(v: T): T {
    if (typeof v === 'string') return (mediaUrls.get(v) ?? v) as T;
    if (Array.isArray(v)) return v.map(canonicalMedia) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canonicalMedia(x)])) as T;
    return v;
}
function remember(a: unknown, b: unknown) {
    if (typeof a === 'string' && typeof b === 'string' && a !== b && b.startsWith('/api/project-media/')) mediaUrls.set(a, b);
    else if (Array.isArray(a) && Array.isArray(b)) {
        // Concurrent additions can change indices: correlate media by entity ID.
        for (let i = 0; i < a.length; i++) remember(a[i], a[i]?.id ? b.find(x => x?.id === a[i].id) : b[i]);
    } else if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const [k, v] of Object.entries(a)) remember(v, (b as Record<string, unknown>)[k]);
    }
}
function notify() { window.dispatchEvent(new Event(PROJECTS_CHANGED)); }
function setSync(id: string, message: string) { syncMessages.set(id, message); window.dispatchEvent(new Event(PROJECT_SYNC_CHANGED)); }
export function projectSyncMessage(id: string) { return syncMessages.get(id) || ''; }
function put(input: Project) {
    const p = cleanGraph(canonicalMedia(input));
    p.nodeCount = p.nodes.length; p.edgeCount = p.edges.length;
    full.set(p.id, p);
    const summary: ProjectSummary = { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, revision: p.revision,
        nodeCount: p.nodeCount, edgeCount: p.edgeCount, counts: p.counts, coverUrl: p.coverUrl };
    summaries = [summary, ...summaries.filter(x => x.id !== p.id)];
    return p;
}
function hasChanges(id: string) {
    const p = full.get(id), base = acknowledged.get(id);
    if (!p) return false;
    if (!base || deleting.has(id)) return true;
    const patch = graphPatch(base, p);
    return !!(patch.nodes.length || patch.edges.length || patch.name);
}
function needsSave() { return [...full.keys()].some(id => !blocked.has(id) && hasChanges(id)); }
async function request(url: string, body?: unknown) {
    const r = await fetch(url, { ...(body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    if (!r.ok || d.ok === false) throw Object.assign(new Error(r.status === 409
        ? '다른 브라우저가 같은 항목을 변경했습니다. 복구본을 내보낸 뒤 최신 프로젝트를 다시 여세요.'
        : d.error || '프로젝트 서버 연결 실패'), { status: r.status });
    return d;
}
export function blockProject(id: string, error: unknown, draft?: { nodes: Node[]; edges: Edge[] }) {
    const p = full.get(id);
    if (p && draft) put({ ...p, ...draft });
    const first = !blocked.has(id); blocked.add(id);
    const message = (error as Error).message || '프로젝트 동기화 충돌';
    setSync(id, '저장 중단: ' + message);
    try { localStorage.setItem('franklin-recovery:' + id, JSON.stringify(full.get(id))); } catch {}
    if (first) alert('프로젝트 저장 중단: ' + message + '\nProjects의 복구본 내보내기로 작업을 보관할 수 있습니다.');
}
function publish(p: Project) {
    put(p); window.dispatchEvent(new CustomEvent(PROJECT_GRAPH_CHANGED, { detail: p.id })); notify();
}
async function drain() {
    busy = true;
    try {
        while (needsSave()) {
            for (const id of [...full.keys()]) {
                if (blocked.has(id) || !hasChanges(id)) continue;
                const snap = structuredClone(full.get(id)!), base = acknowledged.get(id);
                try {
                    setSync(id, '저장 중…');
                    if (deleting.has(id)) {
                        await request('/api/projects/delete', { id, baseRevision: base?.revision ?? null });
                        full.delete(id); acknowledged.delete(id); deleting.delete(id);
                        summaries = summaries.filter(p => p.id !== id); setSync(id, '삭제됨'); notify(); continue;
                    }
                    const d = partial && base
                        ? await request('/api/projects/patch', { id, patch: { ...graphPatch(base, snap), baseRevision: base.revision } })
                        : await request('/api/projects/save', { project: snap, baseRevision: base?.revision ?? null });
                    if (!d.project || !Number.isInteger(d.project.revision)) throw new Error('백엔드를 새 버전으로 재시작하세요.');
                    remember(snap, d.project);
                    const remote = cleanGraph(d.project as Project), latest = canonicalMedia(full.get(id) ?? snap);
                    const merged = mergeProject(canonicalMedia(snap), latest, remote);
                    acknowledged.set(id, remote); publish(merged);
                    if (!blocked.has(id)) setSync(id, '저장됨');
                } catch (e) { blockProject(id, e); }
            }
        }
    } finally { busy = false; }
}
function schedule() {
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = undefined; void flushProjects(); }, 300);
}
export async function flushProjects() {
    if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined; }
    queue = queue.then(drain); await queue;
}
export async function hydrateFromFiles() {
    await flushProjects();
    const d = await request('/api/projects?summary=1');
    if (d.storageVersion !== 2 || !Array.isArray(d.projects)) throw new Error('백엔드를 새 버전으로 재시작하세요.');
    partial = d.capabilities?.includes('entity-patch') === true;
    summaries = [...d.projects.filter((p: ProjectSummary) => !blocked.has(p.id) && !hasChanges(p.id)),
        ...summaries.filter(p => blocked.has(p.id) || hasChanges(p.id))];
    ready = true; notify();
}
export async function loadProject(id: string) {
    await flushProjects();
    if (blocked.has(id)) return full.get(id)!;
    const data = await request('/api/projects/' + encodeURIComponent(id));
    if (hasChanges(id)) return full.get(id)!;
    const p = cleanGraph(data.project as Project); acknowledged.set(id, p); return put(p);
}
export async function pollProject(id: string) {
    if (!partial || busy || hasChanges(id) || blocked.has(id)) return;
    const base = acknowledged.get(id); if (!base) return;
    try {
        const data = await request('/api/projects/' + encodeURIComponent(id));
        if (busy || hasChanges(id) || blocked.has(id) || acknowledged.get(id) !== base) return;
        const remote = cleanGraph(data.project as Project);
        if (remote.revision !== base.revision) { acknowledged.set(id, remote); publish(remote); }
        setSync(id, '동기화됨');
    } catch (e) {
        if ((e as { status?: number }).status === 404) blockProject(id, new Error('다른 브라우저에서 프로젝트를 삭제했습니다. 초안을 복구본으로 보관하세요.'));
        else setSync(id, '연결 확인 필요 · 로컬 변경은 보존됩니다');
    }
}
export async function loadCurrentProject() {
    const selected = getCurrentId(), id = summaries.some(p => p.id === selected) ? selected : listProjects()[0]?.id;
    if (!id) { try { localStorage.removeItem(CURRENT_KEY); } catch {} return null; }
    setCurrentId(id); return loadProject(id);
}
export function listProjects() { return [...summaries].sort((a, b) => b.updatedAt - a.updatedAt); }
export function getCurrentId() { try { return localStorage.getItem(CURRENT_KEY); } catch { return null; } }
export function setCurrentId(id: string) { try { localStorage.setItem(CURRENT_KEY, id); } catch {} }
export function getProject(id: string) { return full.get(id) || null; }
export function getOrCreateCurrent(seed?: { nodes: Node[]; edges: Edge[] }): Project {
    if (!ready) throw new Error('Project server is not ready');
    const id = getCurrentId() || listProjects()[0]?.id, p = id ? full.get(id) : undefined;
    if (p) return p; if (id) throw new Error('Selected project is still loading'); return createProject('Untitled project', seed);
}
export function createProject(name = 'Untitled project', seed?: { nodes: Node[]; edges: Edge[] }): Project {
    const now = Date.now();
    const p = put({ id: 'p_' + randomUUID().replaceAll('-', ''), name, nodes: seed?.nodes ?? [], edges: seed?.edges ?? [],
        createdAt: now, updatedAt: now, revision: 0, nodeCount: 0, edgeCount: 0, counts: { image: 0, video: 0, music: 0 } });
    setCurrentId(p.id); schedule(); notify(); return p;
}
export async function renameProject(id: string, name: string) {
    const p = full.get(id) ?? await loadProject(id); put({ ...p, name, updatedAt: Date.now() }); schedule(); notify();
}
export async function deleteProject(id: string) {
    await flushProjects(); if (!full.has(id)) await loadProject(id); deleting.add(id); await flushProjects();
}
export function saveProjectCanvas(id: string, nodes: Node[], edges: Edge[]) {
    const p = full.get(id); if (!p) return;
    const next = cleanGraph(canonicalMedia({ ...p, nodes, edges })), diff = graphPatch(p, next);
    if (!diff.nodes.length && !diff.edges.length) return;
    put({ ...next, updatedAt: Date.now() });
    if (blocked.has(id)) { try { localStorage.setItem('franklin-recovery:' + id, JSON.stringify(full.get(id))); } catch {} }
    else schedule();
}
export function exportProjectRecovery() {
    const b = new Blob([JSON.stringify([...full.values()])], { type: 'application/json' });
    const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = 'franklin-recovery-' + Date.now() + '.json'; a.click(); URL.revokeObjectURL(u);
}
export function importLegacyProjects() {
    const saved = JSON.parse(localStorage.getItem('franklin-canvas:projects') || '[]') as Project[];
    if (!Array.isArray(saved)) throw new Error('Invalid legacy projects');
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith('franklin-recovery:')) saved.push(JSON.parse(localStorage.getItem(key)!)); }
    if (!saved.length) {
        const nodes = JSON.parse(localStorage.getItem('franklin-canvas:nodes') || '[]'), edges = JSON.parse(localStorage.getItem('franklin-canvas:edges') || '[]');
        if (nodes.length || edges.length) createProject('Legacy canvas (복구본)', { nodes, edges }); else alert('이 브라우저에 기존 프로젝트가 없습니다.');
    }
    for (const p of saved) if (Array.isArray(p.nodes) && Array.isArray(p.edges)) createProject(p.name + ' (복구본)', p);
}
window.addEventListener('beforeunload', e => { if (busy || needsSave() || blocked.size) { e.preventDefault(); e.returnValue = ''; } });
