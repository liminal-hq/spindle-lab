// Tests for the pure parts of timeline.ts: duration derivation and the
// frame-time sampling schedule (docs/plan.md §4.5). The SMIL heuristic
// parser is exercised against real DOM elements (happy-dom supports plain
// attribute reads fine, just not the live SMIL timing methods -- see the
// module doc comment in timeline.ts). CSS derivation and the live-preview
// wiring are exercised manually via Playwright instead (see the PR/report).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
	collectSmilAnimationEndTimes,
	computeFrameCount,
	deriveSuggestedDurationSeconds,
	frameIndexForTimeSeconds,
	frameTimeSeconds,
	fpsToFloat,
	type AnimationEndTimeInfo,
	type Fps,
} from './timeline';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgFragment(inner: string): SVGSVGElement {
	const doc = new DOMParser().parseFromString(
		`<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">${inner}</svg>`,
		'image/svg+xml',
	);
	return doc.documentElement as unknown as SVGSVGElement;
}

describe('collectSmilAnimationEndTimes', () => {
	it('marks repeatCount="indefinite" as infinite with a known cycle duration', () => {
		const root = svgFragment(
			'<rect><animateTransform attributeName="transform" type="rotate" dur="2s" repeatCount="indefinite"/></rect>',
		);
		const [info] = collectSmilAnimationEndTimes(root);
		expect(info.finite).toBe(false);
		expect(info.cycleDurationSeconds).toBeCloseTo(2);
	});

	it('computes a finite end time as begin + dur * repeatCount', () => {
		const root = svgFragment(
			'<rect><animate attributeName="x" begin="1s" dur="2s" repeatCount="3"/></rect>',
		);
		const [info] = collectSmilAnimationEndTimes(root);
		expect(info.finite).toBe(true);
		expect(info.endTimeSeconds).toBeCloseTo(1 + 2 * 3);
		expect(info.cycleDurationSeconds).toBeCloseTo(6);
	});

	it('defaults repeatCount to 1 and begin to 0 when absent', () => {
		const root = svgFragment('<rect><animate attributeName="x" dur="1500ms"/></rect>');
		const [info] = collectSmilAnimationEndTimes(root);
		expect(info.finite).toBe(true);
		expect(info.endTimeSeconds).toBeCloseTo(1.5);
	});

	it('parses bare-number and millisecond dur values', () => {
		const root = svgFragment(
			'<g><rect><animate attributeName="x" dur="2"/></rect><rect><animate attributeName="y" dur="500ms"/></rect></g>',
		);
		const infos = collectSmilAnimationEndTimes(root);
		expect(infos[0].endTimeSeconds).toBeCloseTo(2);
		expect(infos[1].endTimeSeconds).toBeCloseTo(0.5);
	});

	it('treats a missing dur, dur="indefinite", and repeatDur="indefinite" as infinite', () => {
		const root = svgFragment(
			[
				'<rect><set attributeName="x" to="5"/></rect>',
				'<rect><animate attributeName="x" dur="indefinite"/></rect>',
				'<rect><animate attributeName="x" dur="1s" repeatDur="indefinite"/></rect>',
			].join(''),
		);
		const infos = collectSmilAnimationEndTimes(root);
		expect(infos.every((info) => !info.finite)).toBe(true);
	});

	it('caps active duration at an explicit finite repeatDur', () => {
		const root = svgFragment(
			'<rect><animate attributeName="x" dur="1s" repeatCount="10" repeatDur="3s"/></rect>',
		);
		const [info] = collectSmilAnimationEndTimes(root);
		expect(info.finite).toBe(true);
		expect(info.endTimeSeconds).toBeCloseTo(3);
	});

	it('finds every animation element under the root, including nested ones', () => {
		const root = svgFragment(
			[
				'<rect><animateTransform attributeName="transform" dur="2s" repeatCount="indefinite"/></rect>',
				'<g><circle><animate attributeName="r" dur="3s" repeatCount="indefinite"/></circle></g>',
			].join(''),
		);
		expect(collectSmilAnimationEndTimes(root)).toHaveLength(2);
	});
});

describe('deriveSuggestedDurationSeconds', () => {
	it('defaults to 5.0s when there are no animations', () => {
		expect(deriveSuggestedDurationSeconds([])).toBe(5.0);
	});

	it('uses the max end time when every animation is finite', () => {
		const infos: AnimationEndTimeInfo[] = [
			{ finite: true, endTimeSeconds: 2, cycleDurationSeconds: 2 },
			{ finite: true, endTimeSeconds: 5, cycleDurationSeconds: 5 },
			{ finite: true, endTimeSeconds: 3, cycleDurationSeconds: 3 },
		];
		expect(deriveSuggestedDurationSeconds(infos)).toBe(5);
	});

	it('uses the LCM of cycle durations when any animation is infinite', () => {
		// mixed-smil-css.svg's shape: a 4s SMIL loop and a 1.5s CSS loop.
		const infos: AnimationEndTimeInfo[] = [
			{ finite: false, cycleDurationSeconds: 4 },
			{ finite: false, cycleDurationSeconds: 1.5 },
		];
		expect(deriveSuggestedDurationSeconds(infos)).toBeCloseTo(12);
	});

	it('includes finite animations in the LCM alongside infinite ones', () => {
		const infos: AnimationEndTimeInfo[] = [
			{ finite: false, cycleDurationSeconds: 2 },
			{ finite: true, endTimeSeconds: 3, cycleDurationSeconds: 3 },
		];
		expect(deriveSuggestedDurationSeconds(infos)).toBeCloseTo(6);
	});

	it('falls back to 5.0s when no finite cycle duration exists at all', () => {
		const infos: AnimationEndTimeInfo[] = [{ finite: false }];
		expect(deriveSuggestedDurationSeconds(infos)).toBe(5.0);
	});

	it('caps the derived duration at 60s', () => {
		const infos: AnimationEndTimeInfo[] = [
			{ finite: false, cycleDurationSeconds: 7 },
			{ finite: false, cycleDurationSeconds: 11 },
		];
		// lcm(7, 11) = 77s, which exceeds the 60s cap.
		expect(deriveSuggestedDurationSeconds(infos)).toBe(60);
	});
});

describe('fpsToFloat', () => {
	it('converts a rational fps to its decimal value', () => {
		const ntsc: Fps = { num: 30000, den: 1001 };
		expect(fpsToFloat(ntsc)).toBeCloseTo(29.97, 2);
	});
});

describe('frame sampling schedule', () => {
	const fps: Fps = { num: 30, den: 1 };

	it('seamless: end-exclusive, N = round(duration * rate)', () => {
		const count = computeFrameCount(2, fps, 'seamless');
		expect(count).toBe(60);
		expect(frameTimeSeconds(0, 2, fps, 'seamless')).toBe(0);
		// The last sampled frame is strictly before the loop end.
		expect(frameTimeSeconds(count - 1, 2, fps, 'seamless')).toBeCloseTo(2 - 2 / 60);
		// Frame `count` would coincide with frame 0 and is never produced.
	});

	it('once: end-inclusive, N = floor(duration * rate) + 1', () => {
		const count = computeFrameCount(2, fps, 'once');
		expect(count).toBe(61);
		expect(frameTimeSeconds(0, 2, fps, 'once')).toBe(0);
		expect(frameTimeSeconds(count - 1, 2, fps, 'once')).toBeCloseTo(2);
	});

	it('frameIndexForTimeSeconds inverts frameTimeSeconds for "once" mode', () => {
		for (let i = 0; i <= 60; i++) {
			const t = frameTimeSeconds(i, 2, fps, 'once');
			expect(frameIndexForTimeSeconds(t, 2, fps, 'once')).toBe(i);
		}
	});

	it('frameIndexForTimeSeconds inverts frameTimeSeconds for "seamless" mode', () => {
		const count = computeFrameCount(2, fps, 'seamless');
		for (let i = 0; i < count; i++) {
			const t = frameTimeSeconds(i, 2, fps, 'seamless');
			expect(frameIndexForTimeSeconds(t, 2, fps, 'seamless')).toBe(i);
		}
	});

	it('handles a zero duration without dividing by zero', () => {
		expect(computeFrameCount(0, fps, 'seamless')).toBe(0);
		expect(frameTimeSeconds(0, 0, fps, 'seamless')).toBe(0);
		expect(frameIndexForTimeSeconds(0, 0, fps, 'seamless')).toBe(0);
	});
});
