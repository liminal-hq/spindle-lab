// SVG Lab zustand store: the currently imported file, its feature report,
// and the transport-bar playback state (docs/plan.md §4.2, §4.5, M3).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import { importSvg } from './import';
import type { FitMode } from './rasterise';
import { FPS_PRESETS, type Fps, type LoopMode } from './timeline';
import type {
	AspectRatio,
	OutputCodec,
	RenderProgressEvent,
	RenderResult,
	SvgImportResult,
} from './types';

const DEFAULT_FPS: Fps = FPS_PRESETS.find((preset) => preset.label.startsWith('29.97'))!.fps;
const DEFAULT_DURATION_SECONDS = 5.0;
const DEFAULT_EXPORT_WIDTH = 720;
const DEFAULT_EXPORT_HEIGHT = 480;

/** The M5/M6 capture-and-mux pipeline's current phase (docs/plan.md §4.6-§4.8). */
export type CapturePhase = 'idle' | 'capturing' | 'muxing' | 'done' | 'cancelled' | 'error';

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

	// Export/capture settings (docs/plan.md §4.6, M5). fps/duration/loopMode
	// above are shared with the transport bar -- a single source of truth,
	// per docs/plan.md's "same fps/duration/loopMode state" design.
	exportWidth: number;
	exportHeight: number;
	background: 'transparent' | string;
	codec: OutputCodec;
	loopCount: number;
	/** How the source SVG maps into the export raster (docs/plan.md's DVD MPEG-2 section). */
	fitMode: FitMode;
	/** `null` = don't force a DAR; see `types.ts`'s `AspectRatio` doc comment. */
	aspectRatio: AspectRatio | null;
	setExportSize: (width: number, height: number) => void;
	setBackground: (background: 'transparent' | string) => void;
	setCodec: (codec: OutputCodec) => void;
	setLoopCount: (loopCount: number) => void;
	setFitMode: (fitMode: FitMode) => void;
	setAspectRatio: (aspectRatio: AspectRatio | null) => void;
	/** Sets resolution + fps + codec + aspect + fit mode together, per an "Export preset" selection. */
	applyExportPreset: (preset: {
		width: number;
		height: number;
		fps: Fps;
		codec: OutputCodec;
		aspectRatio: AspectRatio | null;
		fitMode: FitMode;
	}) => void;

	// Capture/mux pipeline state (docs/plan.md §4.6-§4.8, M5/M6).
	captureSessionId: string | null;
	capturePhase: CapturePhase;
	captureFramesDone: number;
	captureFrameTotal: number;
	captureError: string | null;
	muxProgress: RenderProgressEvent | null;
	renderResult: RenderResult | null;
	beginCapture: (sessionId: string, frameTotal: number) => void;
	setCaptureProgress: (framesDone: number, frameTotal: number) => void;
	setCapturePhase: (phase: CapturePhase) => void;
	setCaptureError: (message: string) => void;
	setMuxProgress: (progress: RenderProgressEvent | null) => void;
	setRenderResult: (result: RenderResult | null) => void;
	resetCapture: () => void;
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

const initialExportState = {
	exportWidth: DEFAULT_EXPORT_WIDTH,
	exportHeight: DEFAULT_EXPORT_HEIGHT,
	background: 'transparent' as 'transparent' | string,
	codec: 'h264-mp4' as OutputCodec,
	loopCount: 1,
	fitMode: 'fit' as FitMode,
	aspectRatio: null as AspectRatio | null,
};

const initialCaptureState = {
	captureSessionId: null as string | null,
	capturePhase: 'idle' as CapturePhase,
	captureFramesDone: 0,
	captureFrameTotal: 0,
	captureError: null as string | null,
	muxProgress: null as RenderProgressEvent | null,
	renderResult: null as RenderResult | null,
};

export const useSvgLabStore = create<SvgLabState>((set) => ({
	result: null,
	loading: false,
	error: null,
	...initialPlaybackState,
	...initialExportState,
	...initialCaptureState,
	importFile: async (path: string) => {
		set({ loading: true, error: null, ...initialPlaybackState, ...initialCaptureState });
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

	setExportSize: (width, height) => set({ exportWidth: width, exportHeight: height }),
	setBackground: (background) => set({ background }),
	setCodec: (codec) => set({ codec }),
	setLoopCount: (loopCount) => set({ loopCount }),
	setFitMode: (fitMode) => set({ fitMode }),
	setAspectRatio: (aspectRatio) => set({ aspectRatio }),
	applyExportPreset: (preset) =>
		set({
			exportWidth: preset.width,
			exportHeight: preset.height,
			fps: preset.fps,
			codec: preset.codec,
			aspectRatio: preset.aspectRatio,
			fitMode: preset.fitMode,
		}),

	beginCapture: (sessionId, frameTotal) =>
		set({
			captureSessionId: sessionId,
			capturePhase: 'capturing',
			captureFramesDone: 0,
			captureFrameTotal: frameTotal,
			captureError: null,
			muxProgress: null,
			renderResult: null,
		}),
	setCaptureProgress: (framesDone, frameTotal) =>
		set({ captureFramesDone: framesDone, captureFrameTotal: frameTotal }),
	setCapturePhase: (phase) => set({ capturePhase: phase }),
	setCaptureError: (message) => set({ capturePhase: 'error', captureError: message }),
	setMuxProgress: (progress) => set({ muxProgress: progress }),
	setRenderResult: (result) => set({ renderResult: result }),
	resetCapture: () => set({ ...initialCaptureState }),
}));
