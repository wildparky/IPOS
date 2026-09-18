import { useEffect, useRef, useState } from 'react';
import { NodeToolbar, Position, useReactFlow, useStore } from '@xyflow/react';
import { ImagePlus, Film, FolderPlus, Tags, Download, MessageSquarePlus, Group, LayoutGrid } from 'lucide-react';
import { NODE_CATALOG, downloadUrl } from './nodes';
import { useCanvasCtx } from './CanvasContext';
import { useCollectionsStore, type FavKind } from '../collectionsStore';
import { useUiStore } from '../uiStore';
import { randomUUID } from '../uuid';
import { arrangeNodes } from './arrangeNodes';

export default function MultiSelectionToolbar() {
  const nodes = useStore(s => s.nodes);
  const selected = nodes.filter(n => n.selected);
  const { setNodes, setEdges, getEdges } = useReactFlow();
  const { groupSelectedNodes } = useCanvasCtx();
  const collections = useCollectionsStore(s => s.collections);
  const [panel, setPanel] = useState<'tags' | 'collections' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const selectionKey = selected.map(n => n.id).sort().join('|');
  useEffect(() => { setPanel(null); setNotice(''); }, [selectionKey]);
  useEffect(() => {
    if (!panel) return;
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as HTMLElement)) setPanel(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [panel]);
  if (selected.length < 2) return null;
  const ids = new Set(selected.map(n => n.id));
  const media = selected.flatMap(n => {
    const kind: FavKind | null = ['upload', 'imagegen'].includes(n.type ?? '') ? 'image' : n.type === 'videogen' ? 'video' : n.type === 'musicgen' ? 'audio' : null;
    const url = n.data.resultUrl || n.data.imageUrl;
    return kind && typeof url === 'string' && url ? [{ node: n, kind, url }] : [];
  });
  const images = media.filter(m => m.kind === 'image');
  const generate = (type: 'imagegen' | 'videogen') => {
    const id = 'n_' + randomUUID();
    const entry = NODE_CATALOG.find(n => n.type === type)!;
    const x = Math.max(...selected.map(n => n.position.x + (n.measured?.width ?? n.width ?? 280))) + 80;
    const y = Math.min(...selected.map(n => n.position.y));
    const urls = images.map(m => m.url);
    setNodes(current => [...current.map(n => ({ ...n, selected: false })), {
      id, type, position: { x, y }, selected: true,
      data: { ...entry.defaultData, status: 'idle', referenceUrl: urls[0], referenceUrl2: type === 'imagegen' ? urls[1] : undefined,
        referenceUrls: urls, ...(type === 'videogen' ? { inputMode: 'omniReference' } : {}) },
    }]);
    setEdges(edges => [...edges, ...images.map(m => ({ id: 'e_' + randomUUID(), source: m.node.id, target: id, type: 'flow' }))]);
  };
  const arrange = () => {
    const items = selected.filter(n => n.type !== 'group').sort((a,b) => a.position.y - b.position.y || a.position.x - b.position.x);
    if (!items.length) return;
    const { positions } = arrangeNodes(items, getEdges(), {
      x: Math.min(...items.map(n => n.position.x)), y: Math.min(...items.map(n => n.position.y)),
    });
    setNodes(current => current.map(n => positions.has(n.id) ? {...n,position:positions.get(n.id)!} : n));
  };
  const batchTag = (key: string, value: string | null) => setNodes(current => current.map(n => ids.has(n.id) ? {...n,data:{...n.data,[key]:value}} : n));
  const actions = [
    { label:'Generate Image', Icon:ImagePlus, disabled:!images.length || images.length > 1, run:()=>generate('imagegen') },
    { label:'Generate Video', Icon:Film, disabled:!images.length, run:()=>generate('videogen') },
    { label:'Save to Collections', Icon:FolderPlus, disabled:!media.length, run:()=>setPanel(panel==='collections'?null:'collections') },
    { label:'Tag', Icon:Tags, run:()=>setPanel(panel==='tags'?null:'tags') },
    { label:'Batch download', Icon:Download, disabled:!media.length || busy, run:async()=>{
      setBusy(true); setNotice('');
      try { for (const m of media) await downloadUrl(m.url,`${m.node.id}.${m.kind==='image'?'png':m.kind==='video'?'mp4':'mp3'}`); setNotice('다운로드 요청 완료. 여러 파일 다운로드 허용이 필요할 수 있습니다.'); }
      catch { setNotice('일부 다운로드에 실패했습니다.'); } finally { setBusy(false); }
    } },
    { label:'Add to chat', Icon:MessageSquarePlus, run:()=>useUiStore.getState().queueAgentReferences(selected.map(n=>`@${n.id} (${String(n.data.title || n.data.label || n.type)})`).join('\n')) },
    { label:'Group', Icon:Group, disabled:!selected.some(n=>n.type!=='group'), run:()=>groupSelectedNodes(selected[0].id) },
    { label:'Auto Arrange', Icon:LayoutGrid, disabled:!selected.some(n=>n.type!=='group'), run:arrange },
  ];
  return <NodeToolbar nodeId={selected.map(n=>n.id)} isVisible position={Position.Top} offset={40}>
    <div ref={root} className="multi-selection-tools nodrag nopan" onClick={e=>e.stopPropagation()}>
      <div className="node-toolbar-pill-row" role="toolbar" aria-label="Multiple selection actions">
        {actions.map(({label,Icon,run,disabled})=><button type="button" className="toolbar-btn" key={label} aria-label={label} title={label==='Generate Image' && images.length>1?'현재 Codex 이미지 브리지는 참조 이미지 1개를 지원합니다':label} disabled={disabled} onClick={()=>void run()}><Icon size={16}/></button>)}
      </div>
      {panel==='collections' && <div className="group-tag-menu"><strong>Save to Collections</strong>{collections.map(c=><button key={c.id} onClick={()=>{
        for(const m of media) useCollectionsStore.getState().addItem({collectionId:c.id,kind:m.kind,url:m.url,title:String(m.node.data.title || m.node.id)});
        setPanel(null);setNotice('Collections에 저장했습니다.');
      }}>{c.name}</button>)}</div>}
      {panel==='tags' && <div className="group-tag-menu" role="dialog" aria-label="Selection tags">
        {[
          {key:'productionStatus',label:'Production Status',values:['WIP','REVIEW','APPROVED','HOLD']},
          {key:'assetType',label:'어셋타입',values:['Char','Scene','Prop','Reference','KeyShot','Concept']},
        ].map(({key,label,values})=><fieldset key={key}><legend>{label}</legend>{values.map(value=><label key={value}><input type="radio" name={`multi-${key}`} checked={selected.every(n=>n.data[key]===value)} onChange={()=>batchTag(key,value)}/>{value}</label>)}</fieldset>)}
      </div>}
      {notice && <div role="status" className="multi-selection-notice">{notice}</div>}
    </div>
  </NodeToolbar>;
}
