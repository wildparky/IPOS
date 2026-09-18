import { LayoutGrid, LibraryBig, Workflow } from 'lucide-react';
import type { Route } from '../types';
import { useUiStore } from '../uiStore';
export default function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  const openCollections = useUiStore(s => s.setCollectionsOpen);
  return <nav className="ipos-nav-rail" aria-label="Primary">
    <button title="Projects" aria-label="Projects" aria-current={route === 'projects' ? 'page' : undefined} onClick={() => onNavigate('projects')}><LayoutGrid size={18} /></button>
    <button title="Back to canvas (Esc)" aria-label="Back to canvas" onClick={() => onNavigate('canvas')}><Workflow size={18} /></button>
    <button title="Collections" aria-label="Collections" onClick={() => { onNavigate('canvas'); openCollections(true); }}><LibraryBig size={18} /></button>
  </nav>;
}
