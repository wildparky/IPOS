// Agent preferences — how the media agent behaves, persisted to localStorage.
//   - mode: "manual" (confirm before each generation) | "auto" (run autonomously)
//   - imageModel / videoModel: the default models the agent uses for image /
//     video steps (chosen in Settings). The planner may suggest a model, but the
//     agent always builds steps with these so the choice is predictable.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { VIDEO_MODELS, TOPVIEW_VIDEO_MODELS } from './nodes';

const DEFAULT_IMAGE_MODEL = 'codex/gpt-image-2';

export type AgentMode = 'manual' | 'auto';

interface AgentPrefsState {
  mode: AgentMode;
  imageModel: string;
  videoModel: string;
  setMode: (mode: AgentMode) => void;
  setImageModel: (id: string) => void;
  setVideoModel: (id: string) => void;
}

export const useAgentPrefs = create<AgentPrefsState>()(
  persist(
    (set) => ({
      mode: 'manual',
      imageModel: DEFAULT_IMAGE_MODEL,
      videoModel: TOPVIEW_VIDEO_MODELS[0]?.id ?? VIDEO_MODELS[0].id,
      setMode: (mode) => set({ mode }),
      setImageModel: (imageModel) => set({ imageModel }),
      setVideoModel: (videoModel) => set({ videoModel }),
    }),
    {
      name: 'franklin-canvas:agent-prefs',
      version: 1,
      // Move existing installs to the new Codex default once. Later user
      // choices remain persisted normally.
      migrate: (persisted) => ({ ...(persisted as object), imageModel: DEFAULT_IMAGE_MODEL }) as AgentPrefsState,
    },
  ),
);
