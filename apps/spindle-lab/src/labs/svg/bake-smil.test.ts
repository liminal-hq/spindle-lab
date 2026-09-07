// Tests for the SMIL declarative time-shift bake (docs/plan.md §4.3(a)).
// These check the *rewritten attributes*, not rendered pixels -- there is no
// way to execute SMIL in a unit test (see timeline.ts's module doc comment
// on happy-dom's SMIL gaps), so correctness here means "the shifted begin/
// end values are exactly what the browser's own SMIL engine needs to freeze
// the right frame at document time 0". Real pixel-level parity is checked
// manually via Playwright -- see the M4 report.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { bakeSmilAtTime } from './bake-smil';

function animateTransformAttrs(bakedText: string): {
	begin: string | null;
	end: string | null;
	fill: string | null;
} {
	const doc = new DOMParser().parseFromString(bakedText, 'image/svg+xml');
	const el = doc.querySelector('animateTransform')!;
	return {
		begin: el.getAttribute('begin'),
		end: el.getAttribute('end'),
		fill: el.getAttribute('fill'),
	};
}

const ROTATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
	<rect x="35" y="35" width="30" height="30">
		<animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="2s" repeatCount="indefinite"/>
	</rect>
</svg>`;

describe('bakeSmilAtTime -- rotate animateTransform (repeatCount="indefinite")', () => {
	it('at t=0: leaves begin at 0s and freezes with end just after 0s, fill=freeze', () => {
		const { begin, end, fill } = animateTransformAttrs(bakeSmilAtTime(ROTATE_SVG, 0));
		expect(begin).toBe('0s');
		expect(end).toBe('0.001s');
		expect(fill).toBe('freeze');
	});

	it('at the midpoint (t=1 of a 2s cycle): shifts begin to -1s', () => {
		const { begin, end, fill } = animateTransformAttrs(bakeSmilAtTime(ROTATE_SVG, 1));
		expect(begin).toBe('-1s');
		expect(end).toBe('0.001s');
		expect(fill).toBe('freeze');
	});

	it('at the end of one full cycle (t=2): shifts begin to -2s', () => {
		const { begin } = animateTransformAttrs(bakeSmilAtTime(ROTATE_SVG, 2));
		expect(begin).toBe('-2s');
	});

	it("shifts by the plain t offset even past several repeats (repeatCount is the engine's problem, not the shift's)", () => {
		const { begin } = animateTransformAttrs(bakeSmilAtTime(ROTATE_SVG, 5));
		expect(begin).toBe('-5s');
	});
});

describe('bakeSmilAtTime -- explicit begin="1s" (should never activate when baking before it starts)', () => {
	const DELAYED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
		<rect><animate attributeName="x" begin="1s" dur="2s" to="50"/></rect>
	</svg>`;

	it('at t=0: shifted begin stays positive (1s), so the animation is not yet active at document time 0', () => {
		const baked = bakeSmilAtTime(DELAYED_SVG, 0);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		const begin = doc.querySelector('animate')!.getAttribute('begin');
		expect(begin).toBe('1s');
		expect(Number.parseFloat(begin!)).toBeGreaterThan(0);
	});

	it('at t=0.5 (still before the original begin): shifted begin is still positive', () => {
		const baked = bakeSmilAtTime(DELAYED_SVG, 0.5);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		const begin = Number.parseFloat(doc.querySelector('animate')!.getAttribute('begin')!);
		expect(begin).toBeCloseTo(0.5);
		expect(begin).toBeGreaterThan(0);
	});

	it('at t=2 (after the original begin): shifted begin goes negative, i.e. now active', () => {
		const baked = bakeSmilAtTime(DELAYED_SVG, 2);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		const begin = Number.parseFloat(doc.querySelector('animate')!.getAttribute('begin')!);
		expect(begin).toBeCloseTo(-1);
	});
});

describe('bakeSmilAtTime -- existing explicit end (min(existing_end - t, 0))', () => {
	const EXPLICIT_END_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
		<rect><animate attributeName="x" begin="0s" dur="10s" end="3s" to="50"/></rect>
	</svg>`;

	it('baking before the original end (t=1): end shifts to 0s, same as the no-explicit-end case', () => {
		const baked = bakeSmilAtTime(EXPLICIT_END_SVG, 1);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		const el = doc.querySelector('animate')!;
		expect(el.getAttribute('begin')).toBe('-1s');
		expect(el.getAttribute('end')).toBe('0.001s');
		expect(el.getAttribute('fill')).toBe('freeze');
	});

	it('baking after the original end (t=5): end stays negative so the animation stays ended, not un-frozen', () => {
		const baked = bakeSmilAtTime(EXPLICIT_END_SVG, 5);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		const el = doc.querySelector('animate')!;
		expect(el.getAttribute('begin')).toBe('-5s');
		// existing end (3s) shifted by -5 is -2s; min(0, -2) = -2s.
		expect(el.getAttribute('end')).toBe('-2s');
		expect(el.getAttribute('fill')).toBe('freeze');
	});
});

describe('bakeSmilAtTime -- offset value parsing', () => {
	it('shifts a bare-number begin (implicit seconds)', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect><animate attributeName="x" begin="2" dur="1s" to="5"/></rect></svg>`;
		const baked = bakeSmilAtTime(svg, 0.5);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		expect(doc.querySelector('animate')!.getAttribute('begin')).toBe('1.5s');
	});

	it('shifts a millisecond begin', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect><animate attributeName="x" begin="500ms" dur="1s" to="5"/></rect></svg>`;
		const baked = bakeSmilAtTime(svg, 0.2);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		expect(doc.querySelector('animate')!.getAttribute('begin')).toBe('0.3s');
	});

	it('shifts every entry of a semicolon-separated begin list independently', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect><animate attributeName="x" begin="0s;2s" dur="1s" to="5"/></rect></svg>`;
		const baked = bakeSmilAtTime(svg, 1);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		expect(doc.querySelector('animate')!.getAttribute('begin')).toBe('-1s;1s');
	});
});

describe('bakeSmilAtTime -- syncbase and event begin values are left untouched', () => {
	it('does not rewrite a syncbase begin (other.end+1s)', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
			<rect id="other"><animate attributeName="x" dur="1s" to="5"/></rect>
			<rect><animate attributeName="y" begin="other.end+1s" dur="1s" to="5"/></rect>
		</svg>`;
		const baked = bakeSmilAtTime(svg, 3);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		const syncbaseAnim = doc.querySelectorAll('animate')[1];
		expect(syncbaseAnim.getAttribute('begin')).toBe('other.end+1s');
	});

	it('does not rewrite an event-based begin (click)', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect><animate attributeName="x" begin="click" dur="1s" to="5"/></rect></svg>`;
		const baked = bakeSmilAtTime(svg, 3);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		expect(doc.querySelector('animate')!.getAttribute('begin')).toBe('click');
	});
});

describe('bakeSmilAtTime -- every SMIL element type is baked', () => {
	it('bakes animate, animateTransform, animateMotion, animateColor, and set', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
			<rect><animate attributeName="x" dur="1s" to="5"/></rect>
			<rect><animateTransform attributeName="transform" type="rotate" dur="1s" to="360"/></rect>
			<rect><animateMotion dur="1s" path="M0,0 L10,10"/></rect>
			<rect><animateColor attributeName="fill" dur="1s" to="#fff"/></rect>
			<rect><set attributeName="fill" to="#000" begin="1s"/></rect>
		</svg>`;
		const baked = bakeSmilAtTime(svg, 0.5);
		const doc = new DOMParser().parseFromString(baked, 'image/svg+xml');
		for (const tag of ['animate', 'animateTransform', 'animateMotion', 'animateColor', 'set']) {
			const el = doc.querySelector(tag)!;
			expect(el.getAttribute('end')).toBe('0.001s');
			expect(el.getAttribute('fill')).toBe('freeze');
		}
		expect(doc.querySelector('set')!.getAttribute('begin')).toBe('0.5s');
	});
});
