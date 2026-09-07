// DVD-Video's raster/frame-rate legality model, per docs/plan.md's DVD
// MPEG-2 section: the encoded pixel raster is *always* exactly 720x480
// (NTSC) or 720x576 (PAL) and the frame rate is always 29.97fps (30000/1001)
// or 25fps -- 4:3 vs 16:9 anamorphic widescreen is signalled separately via
// the stream's display-aspect-ratio metadata (`AspectRatio` in `types.ts`,
// ffmpeg's `-aspect` flag), never by picking a different raster. "Fit vs
// stretch" is a third, orthogonal axis (`FitMode` in `rasterise.ts`): it
// answers "how does the source SVG map into that raster", not "how should a
// player display the raster's pixels".
//
// This module mirrors the Rust source of truth (`ffmpeg.rs`'s
// `validate_dvd_raster`/`dvd_tv_system_for_fps`) so the frontend can guard
// the Capture button *before* a doomed capture even starts, rather than
// only discovering the mismatch after a failed mux -- docs/plan.md's DVD
// MPEG-2 section asks for both: block early in the UI, but the Rust layer
// stays the actual enforcement point.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { Fps } from './timeline';

/** DVD-Video's only two legal pixel rasters. */
export const DVD_LEGAL_RASTERS: ReadonlyArray<{ width: number; height: number }> = [
	{ width: 720, height: 480 },
	{ width: 720, height: 576 },
];

export function isDvdLegalRaster(width: number, height: number): boolean {
	return DVD_LEGAL_RASTERS.some((raster) => raster.width === width && raster.height === height);
}

export function dvdRasterErrorMessage(width: number, height: number): string {
	return `DVD-legal MPEG-2 requires exactly 720×480 (NTSC) or 720×576 (PAL); got ${width}×${height}.`;
}

/** DVD-Video's only two legal frame rates, mirroring `dvd_tv_system_for_fps`. */
export function isDvdLegalFps(fps: Fps): boolean {
	return (fps.num === 30000 && fps.den === 1001) || (fps.num === 25 && fps.den === 1);
}

export function dvdFrameRateErrorMessage(fps: Fps): string {
	return `DVD-legal MPEG-2 requires 29.97fps (30000/1001, NTSC) or 25fps (PAL); got ${fps.num}/${fps.den}.`;
}

/**
 * The single guard message for a `Mpeg2Dvd` capture request, or `null` when
 * the request is DVD-legal (or the codec isn't `mpeg2-dvd` at all, in which
 * case none of this applies). Raster is checked before frame rate simply to
 * report one problem at a time rather than concatenating both.
 */
export function dvdCaptureGuardMessage(
	codec: string,
	width: number,
	height: number,
	fps: Fps,
): string | null {
	if (codec !== 'mpeg2-dvd') return null;
	if (!isDvdLegalRaster(width, height)) return dvdRasterErrorMessage(width, height);
	if (!isDvdLegalFps(fps)) return dvdFrameRateErrorMessage(fps);
	return null;
}
