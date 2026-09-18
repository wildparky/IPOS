import { useStore } from '@xyflow/react';

export default function ProductionStatusIcon({ id }: { id: string }) {
  const status = useStore(s => s.nodes.find(n => n.id === id)?.data.productionStatus);
  const colors: Record<string, string> = { WIP: '#3b82f6', REVIEW: '#f97316', APPROVED: '#22c55e', HOLD: '#9ca3af' };
  const label = typeof status === 'string' && colors[status] ? status : 'WIP';
  return <svg width="13" height="13" viewBox="0 0 24 24" role="img" aria-label={`Production Status: ${label}`} style={{ color: colors[label], flexShrink: 0 }}>
    <title>{`Production Status: ${label}`}</title>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <text x="12" y="12" textAnchor="middle" dominantBaseline="central" fontSize="13" fontFamily="Arial, sans-serif" fontWeight="600" fill="currentColor">{label[0]}</text>
  </svg>;
}
