import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import CanvasView from './views/CanvasView';
import ProjectsView from './views/ProjectsView';
import ComparisonView from './views/ComparisonView';
import SettingsDialog from './canvas/SettingsDialog';
import { useThemeStore } from './canvas/themeStore';
import type { Route } from './types';
import { Settings } from 'lucide-react';
import './studio-shell.css';

type SettingsSection = 'wallet' | 'models' | 'canvas' | 'about';

const TITLES: Record<Route, string> = {
  canvas: 'Canvas',
  projects: 'Projects',
  wallet: 'Billing',
  comparison: 'Comparison',
};

export default function App() {
  const [route, setRoute] = useState<Route>('canvas');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitial, setSettingsInitial] = useState<SettingsSection>('wallet');
  // Apply the persisted theme on mount (data-theme on <html>).
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const openSettings = (section: SettingsSection = 'wallet') => {
    setSettingsInitial(section);
    setSettingsOpen(true);
  };

  return (
    <div className={`app ipos-shell route-${route}`}>
      <div className="ipos-brand-header">
        <a className="mofac-home-link" href="https://mofacstudios.com/" target="_blank" rel="noopener noreferrer" title="MOFAC Studios"><img src="/mofac-logo.svg" alt="MOFAC" /></a>
        <span className="ipos-brand-text">
          <img className="ipos-symbol" src="/ipos-logo.png" alt="IPOS logo" />
          <span className="ipos-wordmark">iP<span>os</span></span>
          <span className="ipos-version">v1.2.5</span>
        </span>
        <button type="button" title="Settings" aria-label="Settings" onClick={() => openSettings('canvas')}><Settings size={17} /></button>
      </div>
      {route !== 'canvas' && <Sidebar
        route={route}
        onNavigate={setRoute}
      />}
      <main className="main" aria-label={TITLES[route]}>
        {route === 'canvas' && <CanvasView onProjects={() => setRoute('projects')} />}
        {route === 'projects' && <ProjectsView onOpenCanvas={() => setRoute('canvas')} />}
        {route === 'comparison' && <ComparisonView />}
      </main>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initial={settingsInitial}
      />
    </div>
  );
}
