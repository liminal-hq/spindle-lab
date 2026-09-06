// SVG Lab zustand store: the currently imported file, its feature report,
// and the transport-bar playback state (docs/plan.md §4.2, §4.5, M3).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import { importSvg } from './import';
import { FPS_PRESETS, type Fps, type LoopMode } from './timeline';
import type { SvgImportResult } from './types';

const DEFAULT_FPS: Fps = FPS_PRESETS.find((preset) => preset.label.startsWith('29.97'))!.fps;
const DEFAULT_DURATION_SECONDS = 5.0;

interface SvgLabState {
	result: SvgImportResult | null;
	loading: boolean;
	error: string | null;
	importFile: (path: string) => Promise<void>;

	// Transport / timeline state (docs/plan.md §4.5).
	currentTimeSecs: number;
	isPlaying: boolean;
	fps: Fps;
	loopMode: LoopMode;
	/** The duration timeline.ts derived from the live document, once known. */
	derivedDurationSecs: number | null;
	/** A user-typed override; wins over `derivedDurationSecs` when set. */
	durationOverrideSecs: number | null;

	setCurrentTimeSecs: (seconds: number) => void;
	setPlaying: (playing: boolean) => void;
	setFps: (fps: Fps) => void;
	setLoopMode: (mode: LoopMode) => void;
	setDerivedDurationSecs: (seconds: number) => void;
	setDurationOverrideSecs: (seconds: number | null) => void;
}

/** The duration actually driving playback: the override if set, else the derived value, else the flat default (docs/plan.md §4.5). */
export function effectiveDurationSecs(
	state: Pick<SvgLabState, 'derivedDurationSecs' | 'durationOverrideSecs'>,
): number {
	return state.durationOverrideSecs ?? state.derivedDurationSecs ?? DEFAULT_DURATION_SECONDS;
}

const initialPlaybackState = {
	currentTimeSecs: 0,
	isPlaying: false,
	fps: DEFAULT_FPS,
	loopMode: 'seamless' as LoopMode,
	derivedDurationSecs: null as number | null,
	durationOverrideSecs: null as number | null,
};

export const useSvgLabStore = create<SvgLabState>((set) => ({
	result: null,
	loading: false,
	error: null,
	...initialPlaybackState,
	importFile: async (path: string) => {
		set({ loading: true, error: null, ...initialPlaybackState });
		try {
			const result = await importSvg(path);
			set({ result, loading: false });
		} catch (err) {
			set({ error: String(err), loading: false });
		}
	},

	setCurrentTimeSecs: (seconds) => set({ currentTimeSecs: seconds }),
	setPlaying: (playing) => set({ isPlaying: playing }),
	setFps: (fps) => set({ fps }),
	setLoopMode: (loopMode) => set({ loopMode }),
	setDerivedDurationSecs: (seconds) => set({ derivedDurationSecs: seconds }),
	setDurationOverrideSecs: (seconds) => set({ durationOverrideSecs: seconds }),
}));
