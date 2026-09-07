// Rasterisation: baked SVG text -> PNG `Blob`, per docs/plan.md §4.4.
//
// Split deliberately into pure sizing/text helpers (unit-tested below) and
// an impure `rasteriseSvg` pipeline that needs a real `Image`/`canvas` --
// happy-dom does not implement image decoding or 2D canvas drawing, so that
// half is exercised manually via Playwright instead (see the M4 report).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

export interface ViewBox {
	minX: number;
	minY: number;
	width: number;
	height: number;
}

/**
 * Parses a leading numeric prefix off an SVG length attribute (`"100px"`,
 * `"100"`, `"100%"`, …), mirroring the Rust `parse_length` helper in
 * `src-tauri/src/labs/svg/import.rs` so the two sizing heuristics agree.
 * Units (anything after the numeric run) are ignored, exactly as that
 * helper does -- v1 has no unit-conversion story on either side.
 */
export function parseSvgLength(raw: string | null): number | null {
	if (raw == null) return null;
	const trimmed = raw.trim();
	const match = /^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(trimmed);
	if (match == null) return null;
	const value = Number.parseFloat(match[0]);
	return Number.isFinite(value) ? value : null;
}

/** Parses a `viewBox="minX minY width height"` attribute value. */
export function parseViewBox(raw: string | null): ViewBox | null {
	if (raw == null) return null;
	const parts = raw
		.trim()
		.split(/[\s,]+/)
		.filter((part) => part.length > 0)
		.map(Number.parseFloat);
	if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
	const [minX, minY, width, height] = parts;
	return { minX, minY, width, height };
}

/** The minimal shape needed to resolve a root's sizing -- any `Element` satisfies this. */
export interface SvgRootLike {
	getAttribute: (name: string) => string | null;
}

/**
 * Resolves the effective `viewBox` for the root `<svg>`: the explicit one if
 * present, else one synthesised from `width`/`height` (docs/plan.md §4.4).
 * Throws when neither is available -- there is no basis to size the export
 * from, which is exactly the case `svg_import`'s "no viewBox and no
 * width/height" warning (see `no-viewbox.svg`) already flags upstream; this
 * is the point where that warning becomes a hard failure for baking.
 */
export function resolveViewBox(root: SvgRootLike): ViewBox {
	const explicit = parseViewBox(root.getAttribute('viewBox'));
	if (explicit != null) return explicit;

	const width = parseSvgLength(root.getAttribute('width'));
	const height = parseSvgLength(root.getAttribute('height'));
	if (width == null || height == null || width <= 0 || height <= 0) {
		throw new Error(
			'Cannot rasterise: the root <svg> has no viewBox and no numeric width/height to synthesise one from.',
		);
	}
	return { minX: 0, minY: 0, width, height };
}

/**
 * `'fit'` (default): `preserveAspectRatio="xMidYMid meet"` -- the content
 * letterboxes/pillarboxes, undistorted and centred, when the export aspect
 * ratio differs from the source's -- some of the export raster is left
 * empty (background-filled). `'fill'`: `preserveAspectRatio="xMidYMid
 * slice"` -- the content is scaled to *cover* the export raster completely
 * (no empty space on either axis), cropping whatever overflows the
 * non-limiting axis, undistorted -- the SVG-native equivalent of CSS
 * `background-size: cover`. `'stretch'`: `preserveAspectRatio="none"` --
 * the content fills the export raster exactly, distorting if the aspect
 * ratios differ. This is a direct, one-line mapping onto SVG's own
 * `preserveAspectRatio` spec for every mode -- the browser does the actual
 * scaling (and, for `'fill'`, cropping) work. See docs/plan.md's DVD
 * MPEG-2 section: this is a third axis orthogonal to both resolution and
 * `AspectRatio` (`dvd.ts`) -- it answers "how does the source map into the
 * raster", not "how should a player display the raster's pixels".
 */
export type FitMode = 'fit' | 'fill' | 'stretch';

function preserveAspectRatioForFitMode(fitMode: FitMode): string {
	switch (fitMode) {
		case 'stretch':
			return 'none';
		case 'fill':
			return 'xMidYMid slice';
		case 'fit':
			return 'xMidYMid meet';
	}
}

/**
 * Prepares baked SVG text for rasterisation, per docs/plan.md §4.4: ensures
 * a `viewBox` (synthesising one from `width`/`height` if absent), then sets
 * explicit pixel `width`/`height` for the export target and a
 * `preserveAspectRatio` driven by `fitMode` (default `'fit'`, i.e. today's
 * original letterboxing behaviour, unchanged). Pure text-in/text-out, like
 * `bake-smil.ts`.
 */
export function prepareSvgForRasterisation(
	svgText: string,
	exportWidth: number,
	exportHeight: number,
	fitMode: FitMode = 'fit',
): string {
	const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
	const parserError = doc.querySelector('parsererror');
	if (parserError != null) {
		throw new Error(
			`Failed to parse baked SVG for rasterisation: ${parserError.textContent ?? 'unknown error'}`,
		);
	}

	const root = doc.documentElement;
	const viewBox = resolveViewBox(root);
	if (root.getAttribute('viewBox') == null) {
		root.setAttribute(
			'viewBox',
			`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`,
		);
	}
	root.setAttribute('width', String(exportWidth));
	root.setAttribute('height', String(exportHeight));
	root.setAttribute('preserveAspectRatio', preserveAspectRatioForFitMode(fitMode));

	return new XMLSerializer().serializeToString(doc);
}

export interface RasteriseOptions {
	width: number;
	height: number;
	/** `'transparent'` (default) or any CSS colour string for a solid backing fill. */
	background?: 'transparent' | string;
	/** `'fit'` (default, letterbox/pillarbox) or `'stretch'` (fill, distorting). */
	fitMode?: FitMode;
}

/**
 * The rasterisation pipeline itself, exactly per docs/plan.md §4.4: baked
 * SVG text -> sized/viewBox-normalised text -> `Blob` -> object URL ->
 * `Image.decode()` -> `drawImage` onto a fixed-size 2D canvas -> PNG `Blob`.
 *
 * `img.decode()` is used rather than the `onload` event deliberately: per
 * the plan, `onload` can fire before the image is actually decodable, and a
 * `drawImage` at that point silently draws nothing -- `decode()` also
 * surfaces a real rejection (e.g. a `<foreignObject>`-only SVG the "SVG as
 * image" sandbox refuses to rasterise) instead of a blank canvas.
 *
 * This is fundamentally not meaningfully unit-testable under happy-dom (no
 * real image decoding, no real canvas 2D rendering) -- see the M4 report for
 * the manual Playwright verification that actually exercises this.
 */
export async function rasteriseSvg(svgText: string, options: RasteriseOptions): Promise<Blob> {
	const { width, height, background = 'transparent', fitMode = 'fit' } = options;
	const prepared = prepareSvgForRasterisation(svgText, width, height, fitMode);

	const blob = new Blob([prepared], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', {
			alpha: true,
			colorSpace: 'srgb',
			willReadFrequently: false,
		});
		if (ctx == null) throw new Error('Failed to acquire a 2D canvas rendering context.');

		ctx.clearRect(0, 0, width, height);
		if (background !== 'transparent') {
			ctx.fillStyle = background;
			ctx.fillRect(0, 0, width, height);
		}
		ctx.drawImage(img, 0, 0, width, height);

		const pngBlob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/png'),
		);
		if (pngBlob == null) throw new Error('canvas.toBlob() returned null while rasterising.');
		return pngBlob;
	} finally {
		URL.revokeObjectURL(url);
	}
}
