// Video-generation settings popover:
//   生成模式 (Standard/Pro) · 比例 (16:9 / 9:16 / 1:1) ·
//   清晰度 · 生成时长 (3s … 10s)
// A 320px frosted-glass card composed of titled "segmented" rows.

import { useMemo } from 'react';
import type { VideoModelSpec } from './nodes';
import ModelDropdown from '../components/ModelDropdown';

export type AspectRatio = 'adaptive' | '16:9' | '9:16' | '1:1' | '3:4' | '4:3' | '21:9';
export type Mode = 'standard' | 'pro';
export type Resolution = '480p' | '720p' | '1080p' | '2160p';
export type VideoInputMode = 'text' | 'omniReference' | 'firstLast' | 'singleImage';

export interface VideoSettings {
  mode: Mode;
  ratio: AspectRatio;
  durationS: number;
  resolution: Resolution;
  audio: boolean;
  inputMode?: VideoInputMode;
}

interface Props {
  value: VideoSettings;
  onChange: (next: VideoSettings) => void;
  durations?: number[];
  modelSpec?: VideoModelSpec;
  modelId?: string;
  modelOptions?: { id: string; label: string }[];
  onModelChange?: (id: string) => void;
  hasImageReference?: boolean;
}

const DEFAULT_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10];

function Segmented<T extends string | number>({
  options, value, onChange, render,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  render?: (v: T) => React.ReactNode;
}) {
  return (
    <div className="seg">
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          className={`seg-btn ${opt === value ? 'is-active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange(opt); }}
        >
          {render ? render(opt) : String(opt)}
        </button>
      ))}
    </div>
  );
}

function RatioIcon({ ratio }: { ratio: AspectRatio }) {
  const dim = useMemo(() => {
    if (ratio === 'adaptive') return { w: 14, h: 10 };
    if (ratio === '16:9') return { w: 14, h: 7.875 };
    if (ratio === '9:16') return { w: 7.875, h: 14 };
    if (ratio === '3:4') return { w: 10.5, h: 14 };
    if (ratio === '4:3') return { w: 14, h: 10.5 };
    if (ratio === '21:9') return { w: 14, h: 6 };
    return { w: 14, h: 14 };
  }, [ratio]);
  return (
    <div className="ratio">
      <div
        className="ratio-box"
        style={{ width: dim.w, height: dim.h }}
      />
      <span className="ratio-label">{ratio}</span>
    </div>
  );
}

export default function VideoSettingsPanel({ value, onChange, durations = DEFAULT_DURATIONS, modelSpec, modelId, modelOptions = [], onModelChange }: Props) {
  const isTopView = modelSpec?.provider === 'topview';
  const resolutions = (modelSpec?.resolutions ?? ['480p', '720p', '1080p']) as Resolution[];
  const allowedDurations = modelSpec?.durations ?? durations;
  const requestedInputMode = value.inputMode;
  const modeLabels: Record<VideoInputMode, string> = {
    text: 'Text to Video',
    omniReference: 'Omni Reference',
    firstLast: 'First · Last',
    singleImage: 'Image to Video',
  };
  const modeOptions: { id: VideoInputMode; label: string }[] = (modelSpec?.supportedModes ?? ['text'])
    .map((id) => ({ id, label: modeLabels[id] }));
  const effectiveInputMode: VideoInputMode = modeOptions.some((option) => option.id === requestedInputMode)
    ? requestedInputMode as VideoInputMode
    : 'text';
  const fullRatios = (modelSpec?.aspectRatios ?? ['adaptive', '9:16', '3:4', '1:1', '4:3', '16:9', '21:9']) as AspectRatio[];
  const frameRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'] as AspectRatio[];
  const ratios = effectiveInputMode === 'firstLast' || effectiveInputMode === 'singleImage' ? frameRatios : fullRatios;
  const snapDuration = (raw: number) => allowedDurations.reduce((best, candidate) =>
    Math.abs(candidate - raw) < Math.abs(best - raw) ? candidate : best, allowedDurations[0]);
  return (
    <div className="video-settings-panel nodrag nopan" onClick={(e) => e.stopPropagation()}>
      {isTopView ? (
        <section className="panel-row">
          <div className="panel-row-title">Model and mode</div>
          <div className="video-model-mode-grid">
            <div className="video-model-column">
              {modelOptions.length > 0 && onModelChange ? (
                <ModelDropdown
                  models={modelOptions}
                  value={modelId ?? modelSpec.id}
                  onChange={onModelChange}
                  placement="down"
                  className="video-model-dropdown"
                />
              ) : <div className="panel-info-row"><span className="panel-info-strong">{modelSpec.label}</span></div>}
            </div>
            <div className="video-mode-column">
              <ModelDropdown
                models={modeOptions}
                value={effectiveInputMode}
                placement="down"
                className="video-mode-dropdown"
                onChange={(nextMode) => {
                  const option = modeOptions.find((entry) => entry.id === nextMode);
                  if (!option) return;
                  const nextRatios = option.id === 'firstLast' || option.id === 'singleImage' ? frameRatios : fullRatios;
                  onChange({ ...value, inputMode: option.id, ratio: nextRatios.includes(value.ratio) ? value.ratio : nextRatios[0] });
                }}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="panel-row">
          <div className="panel-row-title">Mode</div>
          <Segmented<Mode>
            options={['standard', 'pro']}
            value={value.mode}
            onChange={(v) => onChange({ ...value, mode: v })}
            render={(v) => v === 'standard' ? 'Standard' : 'Pro'}
          />
        </section>
      )}

      <section className="panel-row">
        <div className="panel-row-title">Aspect ratio</div>
        <Segmented<AspectRatio>
          options={ratios}
          value={ratios.includes(value.ratio) ? value.ratio : ratios[0]}
          onChange={(v) => onChange({ ...value, ratio: v })}
          render={(v) => <RatioIcon ratio={v} />}
        />
      </section>

      <section className="panel-row">
        <div className="panel-row-title">Resolution</div>
        <Segmented<Resolution>
          options={resolutions}
          value={resolutions.includes(value.resolution) ? value.resolution : resolutions[0]}
          onChange={(v) => onChange({ ...value, resolution: v })}
        />
      </section>

      <section className="panel-row">
        <div className="panel-row-title panel-row-title-inline">
          <span>Duration</span>
          <span className="panel-row-value">{value.durationS}s</span>
        </div>
        <input
          type="range"
          className="panel-slider"
          min={allowedDurations[0]}
          max={allowedDurations[allowedDurations.length - 1]}
          step={1}
          value={Math.max(allowedDurations[0], Math.min(allowedDurations[allowedDurations.length - 1], value.durationS))}
          onChange={(e) => onChange({ ...value, durationS: snapDuration(Number(e.target.value)) })}
          onClick={(e) => e.stopPropagation()}
          aria-label="Duration in seconds"
        />
        <div className="panel-slider-scale">
          <span>{allowedDurations[0]}s</span>
          <span>{allowedDurations[allowedDurations.length - 1]}s</span>
        </div>
      </section>

      {!isTopView && <section className="panel-row panel-row-inline">
        <div className="panel-row-title">Audio</div>
        <button
          type="button"
          role="switch"
          aria-checked={value.audio}
          className={`panel-toggle ${value.audio ? 'is-on' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange({ ...value, audio: !value.audio }); }}
        >
          <span className="panel-toggle-knob" />
        </button>
      </section>}
    </div>
  );
}
