// Tests for the transport primitives -- most importantly the
// seconds/milliseconds unit mismatch called out in docs/plan.md §4.2:
// `setCurrentTime()` is seconds, WAAPI `currentTime` is milliseconds.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { seekPreviewTo, setPreviewPlaying, type SeekableSvgDocument } from './transport';

function makeDoc(animationCount = 2): {
	doc: SeekableSvgDocument;
	setCurrentTime: ReturnType<typeof vi.fn>;
	pauseAnimations: ReturnType<typeof vi.fn>;
	unpauseAnimations: ReturnType<typeof vi.fn>;
	animations: {
		currentTime: number | null;
		play: ReturnType<typeof vi.fn>;
		pause: ReturnType<typeof vi.fn>;
	}[];
} {
	const setCurrentTime = vi.fn();
	const pauseAnimations = vi.fn();
	const unpauseAnimations = vi.fn();
	const animations = Array.from({ length: animationCount }, () => ({
		currentTime: null as number | null,
		play: vi.fn(),
		pause: vi.fn(),
	}));
	const doc: SeekableSvgDocument = {
		svgRoot: { setCurrentTime, pauseAnimations, unpauseAnimations },
		getAnimations: () => animations,
	};
	return { doc, setCurrentTime, pauseAnimations, unpauseAnimations, animations };
}

describe('seekPreviewTo', () => {
	it('calls setCurrentTime with plain seconds, not milliseconds', () => {
		const { doc, setCurrentTime } = makeDoc();
		seekPreviewTo(doc, 2.5);
		expect(setCurrentTime).toHaveBeenCalledWith(2.5);
	});

	it('sets each WAAPI animation currentTime to seconds * 1000', () => {
		const { doc, animations } = makeDoc();
		seekPreviewTo(doc, 2.5);
		for (const anim of animations) {
			expect(anim.currentTime).toBe(2500);
		}
	});

	it('does not throw when svgRoot or getAnimations is missing', () => {
		expect(() => seekPreviewTo({ svgRoot: null }, 1)).not.toThrow();
		expect(() => seekPreviewTo({ svgRoot: { setCurrentTime: vi.fn() } }, 1)).not.toThrow();
	});
});

describe('setPreviewPlaying', () => {
	it('unpauses SMIL and plays every WAAPI animation when starting playback', () => {
		const { doc, unpauseAnimations, pauseAnimations, animations } = makeDoc();
		setPreviewPlaying(doc, true);
		expect(unpauseAnimations).toHaveBeenCalledOnce();
		expect(pauseAnimations).not.toHaveBeenCalled();
		for (const anim of animations) expect(anim.play).toHaveBeenCalledOnce();
	});

	it('pauses SMIL and every WAAPI animation when stopping playback', () => {
		const { doc, unpauseAnimations, pauseAnimations, animations } = makeDoc();
		setPreviewPlaying(doc, false);
		expect(pauseAnimations).toHaveBeenCalledOnce();
		expect(unpauseAnimations).not.toHaveBeenCalled();
		for (const anim of animations) expect(anim.pause).toHaveBeenCalledOnce();
	});
});
