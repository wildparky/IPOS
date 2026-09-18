import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { hydrateFromFiles, loadCurrentProject } from './projects';
import './styles.css';

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Hydrate projects from the on-disk JSON files before mounting so the canvas
// loads the file-authoritative state (survives cache clear / external edits).
// Do not mount a stale browser-only canvas when the server cannot be reached.
async function start() {
  const root = document.getElementById('root')!;
  root.textContent = 'Loading projects from server…';
  try { await hydrateFromFiles(); await loadCurrentProject(); mount(); }
  catch (error) {
    root.textContent = `프로젝트 서버 연결 실패: ${(error as Error).message} `;
    const retry = document.createElement('button');
    retry.textContent = '다시 연결'; retry.onclick = () => { void start(); };
    root.append(retry);
  }
}
void start();
