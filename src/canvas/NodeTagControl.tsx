import { useEffect, useRef, useState } from 'react';
import { NodeToolbar, Position, useReactFlow, useStore } from '@xyflow/react';
import { Tags } from 'lucide-react';

const statuses: Record<string, string> = { WIP: '#3b82f6', REVIEW: '#f97316', APPROVED: '#22c55e', HOLD: '#9ca3af' };
export default function NodeTagControl({ id }: { id: string }) {
  const data = useStore(s => s.nodes.find(n => n.id === id)?.data);
  const { updateNodeData } = useReactFlow();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as HTMLElement)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return <div ref={root} style={{ position: 'relative' }} className="nodrag nopan" onClick={e => e.stopPropagation()}>
    <button type="button" className="toolbar-btn" aria-label="Tag" title="Tag" aria-expanded={open} onClick={() => setOpen(v => !v)}
      style={{ color: statuses[String(data?.productionStatus)] }}><Tags size={16} aria-hidden /></button>
    {open && <div className="group-tag-menu" role="dialog" aria-label="Node tags">
      <fieldset><legend>Production Status</legend>
        {Object.entries(statuses).map(([value,color]) => <label key={value} style={{ color }}>
          <input type="radio" name={`node-status-${id}`} checked={data?.productionStatus === value} onChange={() => updateNodeData(id,{productionStatus:value})}/>{value}
        </label>)}
      </fieldset>
      <hr />
      <fieldset><legend>어셋타입</legend>
        {['Char','Scene','Prop','Reference','KeyShot','Concept'].map(value => <label key={value}>
          <input type="radio" name={`node-asset-${id}`} checked={data?.assetType === value} onChange={() => updateNodeData(id,{assetType:value})}/>{value}
        </label>)}
      </fieldset>
      <button type="button" onClick={() => updateNodeData(id,{productionStatus:null,assetType:null,tags:[]})}>No Tag</button>
    </div>}
  </div>;
}

export function NodeTagToolbar({ id }: { id: string }) {
  const visible = useStore(s => s.nodes.filter(n => n.selected).length === 1 && !!s.nodes.find(n => n.id === id)?.selected);
  return <NodeToolbar isVisible={visible} position={Position.Top} offset={12}>
    <div className="node-toolbar-pill-row"><NodeTagControl id={id}/></div>
  </NodeToolbar>;
}
