// Mirrors the Rust `svg_import` response shape (src-tauri/src/labs/svg/import.rs).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

/** A single non-fatal warning surfaced by `svg_import`. */
export interface SvgWarning {
	code: string;
	message: string;
}

/** Feature/security inspection of an imported SVG (docs/plan.md §4.1). */
export interface SvgFeatureReport {
	/** Any `<script>` element or `on*` event attribute anywhere in the tree. Blocking in the UI. */
	hasScript: boolean;
	hasForeignObject: boolean;
	externalFontFaces: string[];
	unresolvedExternalRefs: string[];
	smilAnimationCount: number;
	cssAnimationRuleCount: number;
	intrinsicWidth: number | null;
	intrinsicHeight: number | null;
	viewBox: [number, number, number, number] | null;
}

/** The result of `svg_import`: the inlined SVG text plus its feature report. */
export interface SvgImportResult {
	text: string;
	sourcePath: string;
	features: SvgFeatureReport;
	warnings: SvgWarning[];
	inlinedAssetCount: number;
}

// --- M5/M6 capture-session / mux types (docs/plan.md §5), mirroring the
// Rust shapes in src-tauri/src/labs/svg/{session,ffmpeg,probe}.rs ---

/** Mirrors Rust `session::RenderRequest`. */
export interface RenderRequest {
	width: number;
	height: number;
	frameCount: number;
	fpsNum: number;
	fpsDen: number;
	label: string;
}

/** Mirrors Rust `session::RenderSession`, returned by `svg_render_session_begin`. */
export interface RenderSession {
	sessionId: string;
	framesDir: string;
	framePattern: string;
}

/** The three v1 mux targets from docs/plan.md §4.7's table. */
export type OutputCodec = 'h264-mp4' | 'ffv1-mkv' | 'qtrle-mov';

/** Mirrors Rust `ffmpeg::MuxOptions`, the argument to `svg_render_session_mux`. */
export interface MuxOptions {
	codec: OutputCodec;
	fpsNum: number;
	fpsDen: number;
	loopCount: number;
	outputPath?: string | null;
	crf?: number | null;
}

/** Mirrors Rust `commands::RenderResult`, returned by `svg_render_session_mux`. */
export interface RenderResult {
	outputPath: string;
	frameCount: number;
	durationSecs: number;
	ffmpegCommand: string[];
	log: string;
}

/** Mirrors Rust `probe::ProbeReport`, returned by `svg_probe_output`. */
export interface ProbeReport {
	codecName: string | null;
	width: number | null;
	height: number | null;
	rFrameRate: string | null;
	nbFrames: string | null;
	durationSecs: number | null;
	formatName: string | null;
	colorPrimaries: string | null;
	colorTransfer: string | null;
	colorSpace: string | null;
}

/** The `spindle-lab://render-progress` event payload, per docs/plan.md §5. */
export interface RenderProgressEvent {
	sessionId: string;
	phase: 'mux';
	percent: number | null;
	message: string | null;
	elapsedSecs: number | null;
	etaSecs: number | null;
}
