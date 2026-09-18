import { useState } from 'react';
import { useCollectionsStore } from '../collectionsStore';

interface Report {
  totals: { files: number; bytes: number; candidateFiles: number; candidateBytes: number };
  files: { url: string; bytes: number; ageDays: number; state: string }[];
  warnings: string[];
}
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
export default function MediaStoragePanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scan = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/media/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ references: useCollectionsStore.getState().items.map(item => item.url) }), signal: AbortSignal.timeout(60000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || '조회 실패');
      setReport(data);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <details style={{ margin: '16px 0' }}>
    <summary>미디어 저장소 · 사용량 / 정리 후보</summary>
    <p>조회 전용입니다. 파일을 삭제하거나 이동하지 않습니다.</p>
    <button disabled={busy} onClick={() => void scan()}>{busy ? '조회 중…' : '사용량 조회'}</button>
    {error && <p role="alert">{error}</p>}
    {report && <div aria-live="polite">
      <p>미디어 {report.totals.files}개 · {size(report.totals.bytes)} / 정리 후보 {report.totals.candidateFiles}개 · {size(report.totals.candidateBytes)}</p>
      <p>프로젝트·타임라인·백업·현재 브라우저 컬렉션 참조와 최근 30일 파일을 보호합니다. 다른 브라우저의 미저장 참조는 확인할 수 없어, 후보가 곧 삭제 가능한 파일이라는 뜻은 아닙니다. 임시 파일과 백업 JSON 용량은 제외됩니다.</p>
      {report.warnings.map(w => <p key={w} role="alert">{w}</p>)}
      <ul>{report.files.filter(file => file.state === 'candidate').slice(0, 100).map(file => <li key={file.url}>{file.url} · {size(file.bytes)} · {file.ageDays}일</li>)}</ul>
      {report.totals.candidateFiles > 100 && <p>처음 100개 후보만 표시합니다.</p>}
    </div>}
  </details>;
}
