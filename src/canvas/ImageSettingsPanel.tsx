import { useEffect, useState } from 'react';

// Image-generation settings popover. Codex GPT Image supports standard sizes
// plus arbitrary WIDTHxHEIGHT values subject to its documented limits.

export type ImageRatio = 'auto' | '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'standard' | 'hd';
export type ImageSize = string;

export interface ImageSettings {
  ratio: ImageRatio;
  quality: ImageQuality;
  size: ImageSize;
}

interface Props {
  value: ImageSettings;
  onChange: (next: ImageSettings) => void;
  model?: string;
}

const LEGACY_RATIOS: ImageRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const CODEX_RATIOS: ImageRatio[] = ['auto', '1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'];
const CODEX_SIZES: ImageSize[] = ['auto', '1K', '2K', '3K', '4K'];
const CODEX_PRESET_LONG_EDGES: Record<string, number> = { '1K': 1024, '2K': 2048, '3K': 3072, '4K': 3840 };

export function parseCodexSize(value: string): { width: number; height: number } | null {
  const match = /^([1-9]\d*)x([1-9]\d*)$/i.exec(value.trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function isValidCodexSize(value: string): boolean {
  if (value === 'auto') return true;
  if (CODEX_PRESET_LONG_EDGES[value]) return true;
  const parsed = parseCodexSize(value);
  if (!parsed) return false;
  const { width, height } = parsed;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  return width % 16 === 0 && height % 16 === 0
    && longEdge <= 3840 && shortEdge <= 2160
    && width / height >= 1 / 3 && width / height <= 3;
}

export function isExperimentalCodexSize(value: string): boolean {
  const parsed = parseCodexSize(value);
  if (!parsed || !isValidCodexSize(value)) return false;
  return Math.max(parsed.width, parsed.height) > 2560 || Math.min(parsed.width, parsed.height) > 1440;
}

function roundTo16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}

function fitCodexLimits(width: number, height: number): [number, number] {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const scale = Math.min(1, 3840 / longEdge, 2160 / shortEdge);
  return [
    Math.max(16, Math.floor((width * scale) / 16) * 16),
    Math.max(16, Math.floor((height * scale) / 16) * 16),
  ];
}

/** Calculate the concrete size sent to Codex from the selected ratio + size. */
export function calculateCodexOutputSize(ratio: ImageRatio, size: string): string {
  const ratioMap: Record<Exclude<ImageRatio, 'auto'>, [number, number]> = {
    '1:1': [1, 1], '3:2': [3, 2], '2:3': [2, 3], '16:9': [16, 9],
    '9:16': [9, 16], '4:3': [4, 3], '3:4': [3, 4],
  };
  const requested = parseCodexSize(size);
  const presetBase = CODEX_PRESET_LONG_EDGES[size];
  if (ratio === 'auto' && requested) return `${requested.width}x${requested.height}`;
  if (ratio === 'auto' && !presetBase) return 'auto';
  const [rw, rh] = ratio === 'auto' ? [16, 9] : ratioMap[ratio];
  const base = presetBase || (requested ? Math.max(requested.width, requested.height) : 1536);
  const width = rw >= rh ? base : base * rw / rh;
  const height = rw >= rh ? base * rh / rw : base;
  const fitted = fitCodexLimits(roundTo16(width), roundTo16(height));
  return `${fitted[0]}x${fitted[1]}`;
}

function RatioIcon({ ratio }: { ratio: ImageRatio }) {
  if (ratio === 'auto') return <div className="ratio"><div className="ratio-box" style={{ width: 14, height: 14 }} /><span className="ratio-label">Auto</span></div>;
  const [rw, rh] = ratio.split(':').map(Number);
  const max = 14;
  const w = rw >= rh ? max : (max * rw) / rh;
  const h = rh >= rw ? max : (max * rh) / rw;
  return (
    <div className="ratio">
      <div className="ratio-box" style={{ width: w, height: h }} />
      <span className="ratio-label">{ratio}</span>
    </div>
  );
}

function Segmented<T extends string>({ options, value, onChange, render }: {
  options: T[]; value: T; onChange: (v: T) => void; render?: (v: T) => React.ReactNode;
}) {
  return (
    <div className="seg">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`seg-btn ${opt === value ? 'is-active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange(opt); }}
        >
          {render ? render(opt) : opt}
        </button>
      ))}
    </div>
  );
}

export default function ImageSettingsPanel({ value, onChange, model }: Props) {
  const isCodex = model?.startsWith('codex/');
  const [customSize, setCustomSize] = useState(value.size !== 'auto' && !CODEX_SIZES.includes(value.size) ? value.size : '');
  useEffect(() => {
    setCustomSize(value.size !== 'auto' && !CODEX_SIZES.includes(value.size) ? value.size : '');
  }, [value.size]);
  const ratios = isCodex ? CODEX_RATIOS : LEGACY_RATIOS;
  const qualities: ImageQuality[] = isCodex ? ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] : ['standard', 'hd'];
  const normalizedValue: ImageSettings = {
    ratio: ratios.includes(value.ratio) ? value.ratio : ratios[0],
    quality: qualities.includes(value.quality) ? value.quality : qualities[0],
    size: isCodex && isValidCodexSize(value.size) ? value.size : 'auto',
  };
  const finalSize = isCodex ? calculateCodexOutputSize(normalizedValue.ratio, normalizedValue.size) : null;
  return (
    <div className="video-settings-panel nodrag nopan" onClick={(e) => e.stopPropagation()}>
      <section className="panel-row">
        <div className="panel-row-title">Aspect ratio</div>
        <Segmented<ImageRatio>
          options={ratios}
          value={normalizedValue.ratio}
          onChange={(v) => onChange({ ...value, ratio: v })}
          render={(v) => <RatioIcon ratio={v} />}
        />
      </section>

      {isCodex && (
        <section className="panel-row">
          <div className="panel-row-title panel-row-title-with-value">
            <span>Size</span>
            <span className="image-final-size">{finalSize}</span>
          </div>
          <Segmented<ImageSize>
            options={CODEX_SIZES}
            value={normalizedValue.size}
            onChange={(v) => { setCustomSize(''); onChange({ ...value, size: v }); }}
            render={(v) => v === 'auto' ? 'Auto' : v}
          />
          <input
            className="image-size-input"
            value={customSize}
            onChange={(e) => {
              const next = e.target.value.replace(/[^0-9xX]/g, '').replace('X', 'x');
              setCustomSize(next);
              if (isValidCodexSize(next)) onChange({ ...value, size: next });
            }}
            placeholder="Custom: 1536x864"
            aria-label="Custom image size"
            inputMode="numeric"
          />
          {customSize && !isValidCodexSize(customSize) && (
            <div className="image-size-help is-error">Use multiples of 16, ratio 1:3–3:1, max 3840×2160.</div>
          )}
          {finalSize && isExperimentalCodexSize(finalSize) && (
            <div className="image-size-help">Experimental size above 2560×1440.</div>
          )}
        </section>
      )}

      <section className="panel-row">
        <div className="panel-row-title">Quality</div>
        <Segmented<ImageQuality>
          options={qualities}
          value={normalizedValue.quality}
          onChange={(v) => onChange({ ...value, quality: v })}
          render={(v) => v[0].toUpperCase() + v.slice(1)}
        />
      </section>
    </div>
  );
}
