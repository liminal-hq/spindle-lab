// Live-preview transport primitives (docs/plan.md §4.2): play/pause and
// scrub, operating on the sandboxed iframe's `contentDocument`. Kept as
// small dependency-injected functions (a duck-typed shape, not the real DOM
// `Document`) so the load-bearing seconds/milliseconds unit mismatch below
// is unit-testable without a live SVG document.
//
// This is *preview* seeking only -- the seek-then-serialise pitfall that
// baking must avoid (docs/plan.md §4.3) does not apply here: nothing is
// serialised, the live document is simply told what time it is.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

interface SeekableSvgRoot {
	setCurrentTime?: (seconds: number) => void;
	pauseAnimations?: () => void;
	unpauseAnimations?: () => void;
}

interface SeekableAnimation {
	currentTime: number | null;
	play: () => void;
	pause: () => void;
}

/**
 * The minimal shape this module needs. `svgRoot` is deliberately **not**
 * `doc.documentElement`: `SvgPreviewFrame` wraps the imported SVG in a full
 * `<html><body>{svg}</body></html>` srcdoc (see its centring/sizing
 * comment), so `documentElement` there is the `<html>` element, which has
 * none of the SMIL control methods. The real `<svg>` root has to be found
 * with a query -- see `asSeekableSvgDocument` below, which is also why this
 * was caught late: `Element.animationsPaused`/`setCurrentTime` calls on
 * `<html>` are silently no-ops (optional chaining), not errors.
 */
export interface SeekableSvgDocument {
	svgRoot: SeekableSvgRoot | null;
	getAnimations?: () => SeekableAnimation[];
}

/**
 * Seeks both animation engines to `tSeconds`, per docs/plan.md §4.2.
 *
 * `SVGSVGElement.setCurrentTime()` takes **seconds**; WAAPI's
 * `Animation.currentTime` is in **milliseconds**. Both engines run on a
 * given SVG unconditionally (harmlessly, if only one is actually in use --
 * see `mixed-smil-css.svg`) since telling one engine to seek does nothing
 * to the other. Do not drop the `* 1000` below -- see the unit test in
 * transport.test.ts guarding exactly this regression.
 */
export function seekPreviewTo(doc: SeekableSvgDocument, tSeconds: number): void {
	doc.svgRoot?.setCurrentTime?.(tSeconds);
	doc.getAnimations?.().forEach((anim) => {
		anim.currentTime = tSeconds * 1000;
	});
}

/** Plays or pauses both animation engines on the live preview document. */
export function setPreviewPlaying(doc: SeekableSvgDocument, playing: boolean): void {
	if (playing) {
		doc.svgRoot?.unpauseAnimations?.();
		doc.getAnimations?.().forEach((anim) => anim.play());
	} else {
		doc.svgRoot?.pauseAnimations?.();
		doc.getAnimations?.().forEach((anim) => anim.pause());
	}
}

/**
 * Narrows a real `iframe.contentDocument` to the minimal shape above,
 * locating the actual `<svg>` element (see the doc comment on
 * `SeekableSvgDocument`) rather than assuming it is the document root.
 */
export function asSeekableSvgDocument(doc: Document): SeekableSvgDocument {
	return {
		svgRoot: doc.querySelector('svg') as unknown as SeekableSvgRoot | null,
		getAnimations: doc.getAnimations
			? () => doc.getAnimations() as unknown as SeekableAnimation[]
			: undefined,
	};
}
