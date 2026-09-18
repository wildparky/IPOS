// Floating bottom prompt bar — chat-style generation input. Lives
// absolute-bottom inside the canvas viewport.
//
// Behavior:
//   • If an imagegen / videogen / musicgen node is selected, the bar
//     binds to its prompt / model / settings. Send triggers that
//     node's generation.
//   • If nothing is selected, the bar is hidden.

import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import {
  ArrowUp, ImageIcon, Film, Music, X, Plus, Upload, Settings2,
  type LucideIcon,
} from 'lucide-react';
import { IMAGE_MODELS, VIDEO_MODELS, MUSIC_MODELS, TOPVIEW_VIDEO_MODELS, TOPVIEW_VIDEO_SELECTOR } from './nodes';
import ModelDropdown from '../components/ModelDropdown';
import VideoSettingsPanel, { type VideoSettings, type AspectRatio, type VideoInputMode } from './VideoSettingsPanel';
import ImageSettingsPanel, { type ImageSettings, type ImageRatio, type ImageQuality, type ImageSize } from './ImageSettingsPanel';
import { useT } from '../i18n';

type Mode = 'imagegen' | 'videogen' | 'musicgen';

const MODE_META: Record<Mode, { label: string; icon: LucideIcon; models: { id: string; label: string }[] }> = {
  imagegen: { label: 'Image', icon: ImageIcon, models: IMAGE_MODELS },
  videogen: { label: 'Video', icon: Film, models: [TOPVIEW_VIDEO_SELECTOR] },
  musicgen: { label: 'Music', icon: Music, models: MUSIC_MODELS },
};

// Image models that accept multi-image fusion on the gateway
// (/api/v1/images/image2image image[]). Mirrors EDIT_SUPPORTED_MODELS there.
const MULTI_IMAGE_MODELS = new Set<string>([
  'openai/gpt-image-1', 'openai/gpt-image-2',
  'google/nano-banana', 'google/nano-banana-pro',
]);

interface Props {
  onSend: (payload: {
    nodeId: string | null;
    mode: Mode;
    prompt: string;
    model: string;
    /** Reference image attached via the picker / paperclip. Drives
     *  image-to-image (imagegen.edit) and image-to-video (first frame). */
    referenceUrl: string | null;
    /** Second reference image. For imagegen → multi-image fusion (e.g. style
     *  from img1 + subject from img2). For videogen → the LAST frame
     *  (first-and-last-frame interpolation, Seedance only). */
    referenceUrl2?: string | null;
    /** All image references when the selected video mode is Omni Reference. */
    referenceUrls?: string[];
    inputMode?: VideoInputMode;
  }) => void;
}

function costFor(mode: Mode, modelId: string, durationS = 5): number {
  if (mode === 'imagegen') {
    const m = IMAGE_MODELS.find((x) => x.id === modelId);
    return m?.price ?? 0;
  }
  if (mode === 'videogen') {
    const m = VIDEO_MODELS.find((x) => x.id === modelId);
    return (m?.pricePerS ?? 0) * durationS;
  }
  const m = MUSIC_MODELS.find((x) => x.id === modelId);
  return m?.price ?? 0;
}

// Reference picker: a thumbnail slot at the prompt bar's top-left. Empty →
// "+", clicking opens a popover that lists every image already on the canvas
// (upload nodes + completed imagegens). Pick one to use it as referenceUrl
// for the next gen. "Upload from disk" is also in the popover.
function ReferencePicker({
  attachment,
  onPick,
  onClear,
  onUploadClick,
  caption,
}: {
  attachment: string | null;
  onPick: (url: string) => void;
  onClear: () => void;
  onUploadClick: () => void;
  /** Optional tiny label under the slot — used to distinguish dual slots
   *  (e.g. "参考1 / 参考2" for fusion, "首帧 / 尾帧" for first-last video). */
  caption?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasImages = useStore((s) => {
    const out: { id: string; url: string; label: string }[] = [];
    for (const n of s.nodes) {
      const d = n.data as { imageUrl?: string; resultUrl?: string; title?: string };
      if (n.type === 'upload' && d.imageUrl) {
        out.push({ id: n.id, url: d.imageUrl, label: d.title || 'upload' });
      } else if (n.type === 'imagegen' && d.resultUrl) {
        out.push({ id: n.id, url: d.resultUrl, label: d.title || 'image' });
      }
    }
    return out;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={`pb-ref-picker ${caption ? 'has-caption' : ''}`} ref={rootRef}>
      {caption && <span className="pb-ref-caption">{caption}</span>}
      {attachment ? (
        <button
          type="button"
          className="pb-ref-thumb"
          onClick={() => setOpen((v) => !v)}
          aria-label="Change reference image"
          title="Change reference image"
        >
          <img src={attachment} alt="" />
          <span
            role="button"
            tabIndex={0}
            className="pb-ref-thumb-x"
            aria-label="Remove reference"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClear(); } }}
          >
            <X size={9} aria-hidden />
          </span>
        </button>
      ) : (
        <button
          type="button"
          className="pb-ref-empty"
          onClick={() => setOpen((v) => !v)}
          aria-label="Add reference image"
          title="Add reference image"
        >
          <Plus size={18} strokeWidth={2.5} aria-hidden />
        </button>
      )}
      {open && (
        <div className="pb-ref-menu" role="dialog" aria-label="Pick reference image">
          <div className="pb-ref-menu-head">
            <span>Pick from canvas</span>
            <button
              type="button"
              className="pb-ref-upload"
              onClick={() => { setOpen(false); onUploadClick(); }}
            >
              <Upload size={12} aria-hidden /> Upload
            </button>
          </div>
          {canvasImages.length === 0 ? (
            <div className="pb-ref-empty-state">No images on the canvas yet.</div>
          ) : (
            <ul className="pb-ref-grid">
              {canvasImages.map((img) => (
                <li key={img.id}>
                  <button
                    type="button"
                    className={`pb-ref-tile ${attachment === img.url ? 'is-selected' : ''}`}
                    onClick={() => { onPick(img.url); setOpen(false); }}
                    title={img.label}
                  >
                    <img src={img.url} alt={img.label} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function PromptBar({ onSend }: Props) {
  const t = useT();
  const { getNode, getNodes } = useReactFlow();
  const selectedIds = useStore((s) => s.nodes.filter((n) => n.selected).map((n) => n.id));
  const canvasImages = useStore((s) => {
    const out: { id: string; url: string; label: string }[] = [];
    for (const n of s.nodes) {
      const d = n.data as { imageUrl?: string; resultUrl?: string; title?: string };
      if (n.type === 'upload' && d.imageUrl) out.push({ id: n.id, url: d.imageUrl, label: d.title || n.id });
      else if (n.type === 'imagegen' && d.resultUrl) out.push({ id: n.id, url: d.resultUrl, label: d.title || n.id });
    }
    return out;
  });
  const selectedId = selectedIds[0] ?? null;
  const selectedNode = selectedId ? getNode(selectedId) : null;
  const selectedKind = selectedNode?.type as Mode | undefined;
  const bound = selectedKind && MODE_META[selectedKind] ? selectedKind : null;

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string>(IMAGE_MODELS[0].id);
  const [topviewModel, setTopviewModel] = useState<string>(TOPVIEW_VIDEO_MODELS[0].id);
  const [videoInputMode, setVideoInputMode] = useState<VideoInputMode>('text');
  const [attachment, setAttachment] = useState<string | null>(null);
  // Second reference: image fusion (imagegen) or last frame (videogen).
  const [attachment2, setAttachment2] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  // Settings popover state for the gear button. Same panel surface used on
  // the node, just anchored to the PromptBar so users can tweak size /
  // aspect / duration without clicking away from the prompt area.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsWrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { updateNodeData } = useReactFlow();

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!settingsWrapRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [settingsOpen]);

  // Hydrate from the bound node whenever the SELECTION changes — keyed on the
  // node id only. Depending on the whole `selectedNode` object would re-run this
  // on every data mutation (e.g. tweaking resolution/duration in the settings
  // panel calls updateNodeData → new object), which would clobber the prompt the
  // user is typing but hasn't sent yet. Re-sync on id/mode change only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (bound && selectedNode) {
      const d = selectedNode.data as { prompt?: string; model?: string; topviewModel?: string; inputMode?: VideoInputMode; referenceUrl?: string; referenceUrl2?: string; referenceUrls?: string[] };
      setPrompt(d.prompt ?? '');
      if (bound === 'videogen') {
        setModel(TOPVIEW_VIDEO_SELECTOR.id);
        setTopviewModel(d.topviewModel ?? (d.model?.startsWith('topview/seedance-') ? d.model : TOPVIEW_VIDEO_MODELS[0].id));
        setVideoInputMode(d.inputMode ?? 'text');
      } else {
        setModel(d.model ?? MODE_META[bound].models[0].id);
      }
      const refs = d.referenceUrls?.length ? d.referenceUrls : [d.referenceUrl, d.referenceUrl2].filter(Boolean) as string[];
      setAttachments(refs);
      setAttachment(refs[0] ?? null);
      setAttachment2(refs[1] ?? null);
    }
  }, [selectedNode?.id, bound]);

  const onAttachClick = () => fileRef.current?.click();
  const onAttachFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setAttachment(url);
      if (selectedId) updateNodeData(selectedId, { referenceUrl: url });
    };
    reader.readAsDataURL(file);
  };
  const clearAttachment = () => {
    setAttachment(null);
    if (selectedId) updateNodeData(selectedId, { referenceUrl: undefined });
  };
  // Second slot (fusion / last frame) — same flow, separate file input + key.
  const fileRef2 = useRef<HTMLInputElement>(null);
  const onAttachClick2 = () => fileRef2.current?.click();
  const onAttachFile2 = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setAttachment2(url);
      if (selectedId) updateNodeData(selectedId, { referenceUrl2: url });
    };
    reader.readAsDataURL(file);
  };
  const clearAttachment2 = () => {
    setAttachment2(null);
    if (selectedId) updateNodeData(selectedId, { referenceUrl2: undefined });
  };

  const updateOmniAttachments = (urls: string[]) => {
    const next = [...new Set(urls.filter(Boolean))];
    setAttachments(next);
    setAttachment(next[0] ?? null);
    setAttachment2(next[1] ?? null);
    if (selectedId) updateNodeData(selectedId, {
      referenceUrls: next,
      referenceUrl: next[0],
      referenceUrl2: next[1],
    });
  };

  // The bar is contextual to a generation node — hide it when nothing
  // relevant is selected.
  if (!bound) return null;
  const mode: Mode = bound;

  const meta = MODE_META[mode];
  const ModeIcon = meta.icon;
  const videoSpec = mode === 'videogen'
    ? TOPVIEW_VIDEO_MODELS.find((entry) => entry.id === topviewModel)
    : undefined;
  const activeVideoInputMode = mode === 'videogen'
    ? (selectedNode?.data as { inputMode?: VideoInputMode } | undefined)?.inputMode ?? videoInputMode
    : videoInputMode;
  const isOmniReference = mode === 'videogen' && activeVideoInputMode === 'omniReference';

  // A second image input is meaningful only for: image fusion (gpt-image /
  // nano-banana) and first-and-last-frame video (Seedance). Other models hide
  // the slot and never receive a second reference.
  const supportsSecondImage =
    (mode === 'imagegen' && MULTI_IMAGE_MODELS.has(model)) ||
    (mode === 'videogen' && (activeVideoInputMode === 'omniReference' || activeVideoInputMode === 'firstLast'));
  // Progressive disclosure: the 2nd slot only appears once the 1st is filled,
  // so the bar stays clean until you actually want a second reference.
  const showSecondSlot = supportsSecondImage && !isOmniReference && !!attachment;
  // Video frames are order-sensitive (first vs last), so label them; image
  // fusion references are interchangeable and need no caption.
  const captions: [string, string] | null = mode === 'videogen'
    ? activeVideoInputMode === 'omniReference' ? ['Reference 1', 'Reference 2']
      : activeVideoInputMode === 'singleImage' ? ['Image', '']
      : ['First', 'Last']
    : null;
  const videoSummaryData = mode === 'videogen'
    ? selectedNode?.data as { ratio?: AspectRatio; durationS?: number; resolution?: string } | undefined
    : undefined;
  const videoSummary = mode === 'videogen'
    ? `${videoSpec?.label ?? TOPVIEW_VIDEO_SELECTOR.label} · ${videoSummaryData?.ratio ?? '16:9'} · ${videoSummaryData?.resolution ?? '720p'} · ${videoSummaryData?.durationS ?? 5}s`
    : '';

  const send = () => {
    if (!prompt.trim()) return;
    onSend({
      nodeId: selectedId, mode, prompt, model: mode === 'videogen' ? topviewModel : model,
      referenceUrl: attachment,
      referenceUrl2: supportsSecondImage ? attachment2 : null,
      referenceUrls: isOmniReference ? attachments : undefined,
      inputMode: mode === 'videogen' ? videoInputMode : undefined,
    });
  };

  const mentionMatch = prompt.match(/(?:^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? '';
  const mentionOptions = mentionMatch
    ? canvasImages.filter((image) => `${image.label} ${image.id}`.toLowerCase().includes(mentionQuery)).slice(0, 8)
    : [];

  const addPromptReference = (image: { url: string; label: string }) => {
    if (isOmniReference) {
      updateOmniAttachments([...attachments, image.url]);
    } else if (!attachment) {
      setAttachment(image.url);
      if (selectedId) updateNodeData(selectedId, { referenceUrl: image.url });
    } else if (supportsSecondImage && !attachment2) {
      setAttachment2(image.url);
      if (selectedId) updateNodeData(selectedId, { referenceUrl2: image.url });
    } else {
      // Single-image modes have one reference slot. Selecting another asset
      // with @ replaces that slot, matching TopView's composer behavior.
      setAttachment(image.url);
      if (selectedId) updateNodeData(selectedId, {
        referenceUrl: image.url,
        ...(mode === 'videogen' ? { referenceUrls: [image.url] } : {}),
      });
    }
    const tokenStart = prompt.lastIndexOf('@');
    const nextPrompt = tokenStart >= 0
      ? `${prompt.slice(0, tokenStart)}@${image.label} `
      : `${prompt}@${image.label} `;
    setPrompt(nextPrompt);
    if (selectedId) updateNodeData(selectedId, { prompt: nextPrompt });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="prompt-bar nodrag nopan" onClick={(e) => e.stopPropagation()}>
      <div className="prompt-bar-top">
        {isOmniReference ? (
          <div className="pb-ref-omni-strip" aria-label="Omni Reference images">
            {attachments.map((url, index) => (
              <ReferencePicker
                key={`${url}-${index}`}
                attachment={url}
                onPick={(next) => updateOmniAttachments(attachments.map((item, i) => i === index ? next : item))}
                onClear={() => updateOmniAttachments(attachments.filter((_, i) => i !== index))}
                onUploadClick={onAttachClick}
              />
            ))}
            <ReferencePicker
              attachment={null}
              onPick={(url) => updateOmniAttachments([...attachments, url])}
              onClear={() => undefined}
              onUploadClick={onAttachClick}
            />
          </div>
        ) : (
          <ReferencePicker
            attachment={attachment}
            caption={captions?.[0]}
            onPick={(url) => {
              setAttachment(url);
              if (selectedId) updateNodeData(selectedId, { referenceUrl: url });
            }}
            onClear={clearAttachment}
            onUploadClick={onAttachClick}
          />
        )}
        <input ref={fileRef} type="file" accept="image/*" onChange={onAttachFile} hidden />
        {showSecondSlot && (
          <>
            <ReferencePicker
              attachment={attachment2}
              caption={captions?.[1]}
              onPick={(url) => {
                setAttachment2(url);
                if (selectedId) updateNodeData(selectedId, { referenceUrl2: url });
              }}
              onClear={clearAttachment2}
              onUploadClick={onAttachClick2}
            />
            <input ref={fileRef2} type="file" accept="image/*" onChange={onAttachFile2} hidden />
          </>
        )}
        <div className="pb-flex" />
        {bound && selectedNode && (
          <span className="pb-bound-chip">
            {t('pb_editing')} · <strong>{selectedNode.data?.title as string || meta.label}</strong> · {selectedId?.slice(0, 6)}
          </span>
        )}
      </div>

      <div className="pb-prompt-editor">
        <textarea
          className="prompt-bar-input"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            // Persist as you type so the draft survives deselect→reselect (the
            // hydrate effect reads it back from node data). No effect re-run since
            // it's keyed on node id, not the data object.
            if (selectedId) updateNodeData(selectedId, { prompt: e.target.value });
          }}
          onKeyDown={onKeyDown}
          placeholder={t('pb_placeholder')}
          rows={3}
        />
        {mentionMatch && mentionOptions.length > 0 && (
          <div className="pb-mention-menu" role="listbox" aria-label="Select referenced canvas image">
            {mentionOptions.map((image) => (
              <button
                key={image.id}
                type="button"
                className="pb-mention-item"
                onMouseDown={(e) => { e.preventDefault(); addPromptReference(image); }}
              >
                <img src={image.url} alt="" />
                <span><strong>@{image.label}</strong><small>{image.id}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="prompt-bar-bottom">
        <div className="pb-mode">
          <span className={`pb-mode-btn is-active`}>
            <ModeIcon size={14} aria-hidden />
            <span>{meta.label}</span>
          </span>
        </div>
        <div className="pb-divider" />
        {mode !== 'videogen' && (
          <ModelDropdown models={meta.models} value={model} onChange={(m) => { setModel(m); if (selectedId) updateNodeData(selectedId, { model: m }); }} />
        )}
        {/* Settings gear — Video (aspect / resolution / duration / audio) and
            Image (aspect ratio / quality). Music settings live in the music
            node's lyrics popover. */}
        {mode === 'imagegen' && (
          <div className="pb-settings-wrap" ref={settingsWrapRef}>
            <button
              type="button"
              className={`pb-icon-btn pb-settings-btn ${settingsOpen ? 'is-active' : ''}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Open image settings"
              aria-expanded={settingsOpen}
              title="Image settings"
            >
              <Settings2 size={20} strokeWidth={2.2} aria-hidden />
            </button>
            {settingsOpen && (() => {
              const nd = selectedNode?.data as { ratio?: ImageRatio; quality?: ImageQuality; size?: ImageSize } | undefined;
              const value: ImageSettings = { ratio: nd?.ratio ?? '1:1', quality: nd?.quality ?? 'standard', size: nd?.size ?? 'auto' };
              return (
                <div className="pb-settings-pop">
                  <ImageSettingsPanel
                    model={model}
                    value={value}
                    onChange={(next) => {
                      if (selectedId) updateNodeData(selectedId, { ratio: next.ratio, quality: next.quality, size: next.size });
                    }}
                  />
                </div>
              );
            })()}
          </div>
        )}
        {mode === 'videogen' && (
          <div className="pb-settings-wrap" ref={settingsWrapRef}>
            <button
              type="button"
              className={`pb-icon-btn pb-settings-btn ${settingsOpen ? 'is-active' : ''}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Open video settings"
              aria-expanded={settingsOpen}
              title="Video settings"
            >
              <Settings2 size={20} strokeWidth={2.2} aria-hidden />
            </button>
            {settingsOpen && (() => {
              const nd = selectedNode?.data as { mode?: 'standard' | 'pro'; ratio?: AspectRatio; durationS?: number; resolution?: '480p' | '720p' | '1080p' | '2160p'; audio?: boolean } | undefined;
              const value: VideoSettings = {
                mode: nd?.mode ?? 'standard',
                ratio: nd?.ratio ?? (videoSpec?.defaultAspectRatio as AspectRatio | undefined) ?? '16:9',
                durationS: nd?.durationS ?? videoSpec?.defaultDuration ?? 5,
                resolution: nd?.resolution ?? (videoSpec?.defaultResolution as '480p' | '720p' | '1080p' | '2160p' | undefined) ?? '720p',
                audio: nd?.audio ?? true,
                inputMode: (selectedNode?.data as { inputMode?: VideoInputMode } | undefined)?.inputMode ?? videoInputMode,
              };
              return (
                <div className="pb-settings-pop">
                  <VideoSettingsPanel
                    value={value}
                    modelSpec={videoSpec}
                    modelId={topviewModel}
                    modelOptions={TOPVIEW_VIDEO_MODELS}
                    onModelChange={(nextModel) => {
                      setTopviewModel(nextModel);
                      const nextSpec = TOPVIEW_VIDEO_MODELS.find((entry) => entry.id === nextModel);
                      const nextInputMode: VideoInputMode = attachment
                        ? nextSpec?.inputModes?.includes('singleImage') && !nextSpec.inputModes.includes('startEndFrame')
                          ? 'singleImage'
                          : (activeVideoInputMode === 'omniReference' || activeVideoInputMode === 'firstLast') ? activeVideoInputMode : 'firstLast'
                        : 'text';
                      setVideoInputMode(nextInputMode);
                      if (selectedId) updateNodeData(selectedId, {
                        model: nextModel,
                        topviewModel: nextModel,
                        ratio: nextSpec?.defaultAspectRatio ?? '16:9',
                        durationS: nextSpec?.defaultDuration ?? 5,
                        resolution: nextSpec?.defaultResolution ?? '720p',
                        inputMode: nextInputMode,
                      });
                    }}
                    hasImageReference={!!attachment}
                    onChange={(next) => {
                      setVideoInputMode(next.inputMode ?? videoInputMode);
                      if (selectedId) updateNodeData(selectedId, { mode: next.mode, ratio: next.ratio, durationS: next.durationS, resolution: next.resolution, audio: next.audio, inputMode: next.inputMode });
                    }}
                  />
                </div>
              );
            })()}
          </div>
        )}
        {mode === 'videogen' && (
          <button
            type="button"
            className="pb-video-summary"
            onClick={() => setSettingsOpen(true)}
            title="Open TopView Seedance settings"
          >
            <span>{videoSummary}</span>
          </button>
        )}
        <div className="pb-flex" />
        <div
          className="pb-cost"
          title="Estimated generation cost"
        >
          <span className="pb-cost-symbol">USDC</span>
          <span className="pb-cost-n">
            ${costFor(mode, model, (selectedNode?.data as { durationS?: number })?.durationS ?? 5).toFixed(3)}
          </span>
        </div>
        <button
          className="pb-send"
          type="button"
          onClick={send}
          disabled={!prompt.trim()}
          aria-label="Send"
          title="Send (Enter)"
        >
          <ArrowUp size={24} strokeWidth={3} aria-hidden />
        </button>
      </div>

      <span hidden>{getNodes().length}</span>
    </div>
  );
}
