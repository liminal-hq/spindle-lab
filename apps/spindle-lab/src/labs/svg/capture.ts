// The M5 frame-capture loop (docs/plan.md §4.6): for each sampled t_i, bakes
// the live preview through the same CSS-then-SMIL pipeline
// `BakeParityView.tsx` established (M4), rasterises it, and writes it as a
// numbered PNG into the Rust-allocated session frames directory via
// `@tauri-apps/plugin-fs`'s `writeFile`. Progress and cancellation are
// reported directly to the caller (the zustand store, in practice) rather
// than via a Tauri event, per docs/plan.md §5: "Capture-phase progress never
// crosses the boundary; it is set directly on the zustand store from the
// loop."
//
// This module's own loop is impure (DOM, canvas, filesystem writes) and is
// therefore verified manually via Playwright + `pnpm tauri dev`, the same
// way `rasterise.ts`'s pipeline is -- see that module's doc comment. The two
// small helpers below are pure and unit-tested directly.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { writeFile } from '@tauri-apps/plugin-fs';
import { bakeCssAtTime } from './bake-css';
import { bakeSmilAtTime } from './bake-smil';
import { rasteriseSvg } from './rasterise';
import { frameTimeSeconds, type Fps, type LoopMode } from './timeline';

/**
 * Matches the Rust-provided `frame_pattern` (`frame_%06d.png` -- see
 * `session.rs`'s `FRAME_PATTERN`), which ffmpeg's image2 demuxer also reads
 * from in `ffmpeg.rs`'s `build_mux_command`. Joins with a forward slash --
 * this lab's frame directories live under `$APPCACHE`, and the desktop
 * targets it actually ships against today (Linux/macOS) accept that
 * unconditionally; a Windows-specific join would be a fair follow-up if this
 * lab ever runs there.
 */
export function frameFileName(framesDir: string, index: number): string {
	return `${framesDir}/frame_${String(index).padStart(6, '0')}.png`;
}

/**
 * Whether the capture loop should yield to `requestAnimationFrame` after
 * writing the frame at `index`, per docs/plan.md §4.6's worked loop
 * (`if (i % 4 === 0) await ... requestAnimationFrame`) -- keeps the
 * progress bar and cancel button responsive during a long capture without
 * yielding so often that per-frame overhead dominates.
 */
export function shouldYieldAfterFrame(index: number): boolean {
	return index % 4 === 3;
}

export interface CaptureFeatures {
	smilAnimationCount: number;
	cssAnimationRuleCount: number;
}

export interface CaptureOptions {
	/** The inlined SVG source text from `svg_import` (docs/plan.md §4.1). */
	sourceText: string;
	features: CaptureFeatures;
	/** The live sandboxed preview document -- read from only when a CSS bake is needed. */
	previewDoc: Document;
	framesDir: string;
	frameCount: number;
	durationSecs: number;
	fps: Fps;
	loopMode: LoopMode;
	width: number;
	height: number;
	background: 'transparent' | string;
	/** Called after each frame is written, with the count so far and the total. */
	onProgress: (framesDone: number, frameTotal: number) => void;
	/** Checked before every frame; returning `true` stops the loop early. */
	isCancelled: () => boolean;
}

export interface CaptureOutcome {
	cancelled: boolean;
}

/**
 * Runs the M5 capture loop, per docs/plan.md §4.6. Bakes and rasterises each
 * sampled frame in turn and writes it to disk, checking `isCancelled()`
 * before every frame so a mid-capture cancel stops promptly rather than
 * after the whole schedule finishes.
 */
export async function runCaptureLoop(options: CaptureOptions): Promise<CaptureOutcome> {
	const {
		sourceText,
		features,
		previewDoc,
		framesDir,
		frameCount,
		durationSecs,
		fps,
		loopMode,
		width,
		height,
		background,
		onProgress,
		isCancelled,
	} = options;

	for (let index = 0; index < frameCount; index++) {
		if (isCancelled()) return { cancelled: true };

		const t = frameTimeSeconds(index, durationSecs, fps, loopMode);

		// Same composition order as BakeParityView.tsx's "Bake this frame":
		// CSS first (the only step reading live WAAPI/CSSOM state), then SMIL
		// against the CSS-baked text -- see that component's comment for why
		// the order isn't actually load-bearing for correctness.
		let text = sourceText;
		if (features.cssAnimationRuleCount > 0) {
			text = bakeCssAtTime(previewDoc, text, t);
		}
		if (features.smilAnimationCount > 0) {
			text = bakeSmilAtTime(text, t);
		}

		const blob = await rasteriseSvg(text, { width, height, background });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		await writeFile(frameFileName(framesDir, index), bytes);

		onProgress(index + 1, frameCount);

		if (shouldYieldAfterFrame(index)) {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
	}

	return { cancelled: false };
}
