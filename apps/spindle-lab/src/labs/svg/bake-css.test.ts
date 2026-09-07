// Tests for the CSS resolved-value-inlining bake (docs/plan.md §4.3(b)).
//
// happy-dom does not create `Animation` objects from `@keyframes`/`animation`
// CSS (there is no CSS animation *engine* to drive `document.getAnimations()`
// -- see timeline.ts's module doc comment on the equivalent SMIL gap), so
// `liveDoc` and `getComputedStyleFn` are both hand-built fakes here rather
// than a real animated document: a fake `liveDoc` supplies `querySelector`
// and `getAnimations()` wired to a real (but un-animated) element tree, and
// a fake `getComputedStyleFn` supplies the "resolved at t" values a real
// browser's WAAPI/CSSOM would have computed. This exercises the pairing and
// inlining logic in full; the actual resolved-value correctness is checked
// manually via Playwright -- see the M4 report.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { bakeCssAtTime, type ComputedStyleLike } from './bake-css';

/** Builds a live `<svg>` tree (real happy-dom elements) plus a fake `Document`-shaped wrapper around it. */
function makeLiveDoc(svgMarkup: string): { liveDoc: Document; svgRoot: Element } {
	const parsed = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
	const svgRoot = parsed.documentElement;
	const fakeDoc = {
		querySelector: (selector: string) => (selector === 'svg' ? svgRoot : null),
		getAnimations: undefined as (() => unknown[]) | undefined,
	};
	return { liveDoc: fakeDoc as unknown as Document, svgRoot };
}

/**
 * Wires `getAnimations()` onto a fake live doc, padding each fake animation
 * with no-op `play`/`pause` -- `setPreviewPlaying` (transport.ts) calls
 * these on every entry of `getAnimations()` unconditionally, exactly as a
 * real WAAPI `Animation` supports them regardless of whether it was created
 * from CSS or SMIL.
 */
function withAnimations(liveDoc: Document, animations: Record<string, unknown>[]): Document {
	const padded = animations.map((anim) => ({ play: () => {}, pause: () => {}, ...anim }));
	return {
		...(liveDoc as unknown as Record<string, unknown>),
		getAnimations: () => padded,
	} as unknown as Document;
}

describe('bakeCssAtTime', () => {
	it('inlines the resolved computed value onto the paired clone node and disables its animation', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle class="pulse" cx="50" cy="50" r="8"/></svg>`;
		const { liveDoc, svgRoot } = makeLiveDoc(svg);
		const circle = svgRoot.querySelector('circle')!;

		const doc = withAnimations(liveDoc, [
			{
				effect: {
					target: circle,
					getKeyframes: () => [
						{ offset: 0, easing: 'ease-in-out', r: '8', opacity: '1' },
						{ offset: 0.5, r: '20', opacity: '0.4' },
						{ offset: 1, r: '8', opacity: '1' },
					],
				},
			},
		]);

		const getComputedStyleFn = vi.fn((): ComputedStyleLike => ({ r: '14', opacity: '0.7' }));

		const baked = bakeCssAtTime(doc, svg, 1, getComputedStyleFn);
		const bakedDoc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		const bakedCircle = bakedDoc.querySelector('circle')!;

		expect(bakedCircle.getAttribute('style')).toContain('r: 14 !important');
		expect(bakedCircle.getAttribute('style')).toContain('opacity: 0.7 !important');
		expect(bakedCircle.getAttribute('style')).toContain('animation: none !important');
	});

	it('pairs the live target to the clone node by document-order index, not identity or attributes', () => {
		// Two structurally-identical <rect>s; only the second one animates.
		// If pairing were wrong (e.g. always node 0), this would inline onto
		// the wrong rect.
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="a" width="10" height="10"/><rect id="b" width="10" height="10"/></svg>`;
		const { liveDoc, svgRoot } = makeLiveDoc(svg);
		const secondRect = svgRoot.querySelectorAll('rect')[1];

		const doc = withAnimations(liveDoc, [
			{
				effect: {
					target: secondRect,
					getKeyframes: () => [{ fill: 'red' }, { fill: 'blue' }],
				},
			},
		]);

		const baked = bakeCssAtTime(doc, svg, 0.5, () => ({ fill: 'rgb(128, 0, 128)' }));
		const bakedDoc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		const [bakedA, bakedB] = Array.from(bakedDoc.querySelectorAll('rect'));

		expect(bakedA.getAttribute('style')).toBeNull();
		expect(bakedB.getAttribute('style')).toContain('fill: rgb(128, 0, 128) !important');
	});

	it('converts camelCase keyframe property names to kebab-case for setProperty', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>`;
		const { liveDoc, svgRoot } = makeLiveDoc(svg);
		const rect = svgRoot.querySelector('rect')!;

		const doc = withAnimations(liveDoc, [
			{
				effect: {
					target: rect,
					getKeyframes: () => [{ backgroundColor: 'red' }, { backgroundColor: 'blue' }],
				},
			},
		]);

		const baked = bakeCssAtTime(doc, svg, 0.5, () => ({ backgroundColor: 'rgb(1, 2, 3)' }));
		const bakedDoc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		expect(bakedDoc.querySelector('rect')!.getAttribute('style')).toContain(
			'background-color: rgb(1, 2, 3) !important',
		);
	});

	it('ignores offset/easing/composite keyframe keys as animatable properties', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>`;
		const { liveDoc, svgRoot } = makeLiveDoc(svg);
		const rect = svgRoot.querySelector('rect')!;
		// This fake deliberately answers for *any* property, including the
		// timing keys -- if the filter in bake-css.ts failed to exclude them,
		// the baked style would end up with bogus `offset`/`easing`/
		// `composite` declarations, which the assertion below checks for.
		const getComputedStyleFn = vi.fn((): ComputedStyleLike => ({
			opacity: '0.5',
			offset: 'bogus',
			easing: 'bogus',
			composite: 'bogus',
		}));

		const doc = withAnimations(liveDoc, [
			{
				effect: {
					target: rect,
					getKeyframes: () => [
						{ offset: 0, easing: 'linear', composite: 'replace', opacity: '1' },
						{ offset: 1, opacity: '0' },
					],
				},
			},
		]);

		const baked = bakeCssAtTime(doc, svg, 0.5, getComputedStyleFn);
		const bakedStyle = new DOMParser()
			.parseFromString(baked, 'image/svg+xml')
			.querySelector('rect')!
			.getAttribute('style');
		expect(bakedStyle).toContain('opacity: 0.5 !important');
		expect(bakedStyle).not.toContain('offset');
		expect(bakedStyle).not.toContain('easing');
		expect(bakedStyle).not.toContain('composite');
	});

	it('returns the source unchanged when the live document has no animations', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>`;
		const { liveDoc } = makeLiveDoc(svg);
		const doc = withAnimations(liveDoc, []);
		expect(bakeCssAtTime(doc, svg, 1)).toBe(svg);
	});

	it('seeks and pauses the live document via transport.ts primitives before reading computed styles', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>`;
		const { svgRoot } = makeLiveDoc(svg);
		const setCurrentTime = vi.fn();
		const pauseAnimations = vi.fn();
		(svgRoot as unknown as { setCurrentTime: typeof setCurrentTime }).setCurrentTime =
			setCurrentTime;
		(svgRoot as unknown as { pauseAnimations: typeof pauseAnimations }).pauseAnimations =
			pauseAnimations;

		const rect = svgRoot.querySelector('rect')!;
		const fakeDoc = {
			querySelector: (selector: string) => (selector === 'svg' ? svgRoot : null),
			getAnimations: () => [
				{
					play: () => {},
					pause: () => {},
					effect: { target: rect, getKeyframes: () => [{ opacity: '1' }] },
				},
			],
		} as unknown as Document;

		bakeCssAtTime(fakeDoc, svg, 2.5, () => ({ opacity: '0.3' }));
		expect(setCurrentTime).toHaveBeenCalledWith(2.5);
		expect(pauseAnimations).toHaveBeenCalledOnce();
	});
});
