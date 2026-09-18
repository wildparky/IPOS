import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ImageIcon, Plus } from 'lucide-react';
import { createProject, flushProjects, hydrateFromFiles, listProjects, loadProject, PROJECTS_CHANGED, setCurrentId } from '../projects';

export default function ProjectSwitcher({ name, currentId, onOpen, onProjects }: { name: string; currentId: string; onOpen: () => void; onProjects: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState(listProjects);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const refresh = () => { void hydrateFromFiles().catch(e => setError(e.message)); };
    const changed = () => setProjects(listProjects());
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as HTMLElement)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener(PROJECTS_CHANGED, changed);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { clearInterval(timer); window.removeEventListener(PROJECTS_CHANGED, changed); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const choose = async (id?: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await flushProjects();
      if (id) { await loadProject(id); setCurrentId(id); }
      else createProject(`Project ${projects.length + 1}`);
      setOpen(false); onOpen();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="project-switcher" ref={root}>
    <button type="button" className="canvas-brand-input project-switcher-trigger" aria-label="Open projects" aria-expanded={open} onClick={() => { setOpen(v => !v); setQuery(''); }}><span>{name}</span><ChevronDown size={14} /></button>
    {open && <div className="project-switcher-menu" role="dialog" aria-label="Projects">
      <header><button type="button" className="project-switcher-heading" onClick={() => { setOpen(false); onProjects(); }}>PROJECTS</button><input autoFocus aria-label="Filter projects" placeholder="Search projects" value={query} onChange={e => setQuery(e.target.value)} /></header>
      {error && <p role="alert">{error}</p>}
      <div className="project-switcher-list">
        {projects.filter(p => p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(p => <button type="button" key={p.id} disabled={busy} aria-current={p.id === currentId ? 'page' : undefined} onClick={() => void choose(p.id)}>
          {p.coverUrl ? <img src={p.coverUrl} alt="" /> : <ImageIcon size={28} />}<span>{p.name}</span>
        </button>)}
        {!projects.some(p => p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p>No projects found</p>}
      </div>
      <button type="button" className="project-switcher-new" disabled={busy} onClick={() => void choose()}><Plus size={16} /> New Project</button>
    </div>}
  </div>;
}
