import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

interface Props {
  id: string;
  value?: string;
  fallback: string;
  dataKey?: string;
  className?: string;
}

export default function EditableNodeTitle({ id, value, fallback, dataKey = 'title', className }: Props) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const begin = (e: React.MouseEvent) => {
    e.stopPropagation();
    finished.current = false;
    setDraft(value ?? '');
    setEditing(true);
  };
  const cancel = () => { finished.current = true; setDraft(value ?? ''); setEditing(false); };
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    updateNodeData(id, { [dataKey]: draft.trim() || fallback });
    setEditing(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  };

  return editing ? (
    <input
      ref={inputRef}
      className={`nodrag nopan ${className ?? ''}`}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={e => e.stopPropagation()}
      aria-label="Node title"
    />
  ) : (
    <span className={className} onDoubleClick={begin} title="Double-click to rename">
      {value || fallback}
    </span>
  );
}
