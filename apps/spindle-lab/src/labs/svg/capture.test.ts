// Tests for capture.ts's pure helpers -- the loop itself needs a real DOM/
// canvas/filesystem and is verified manually (see capture.ts's doc comment).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { frameFileName, shouldYieldAfterFrame } from './capture';

describe('frameFileName', () => {
	it('zero-pads the frame index to 6 digits, matching the Rust frame_pattern', () => {
		expect(frameFileName('/tmp/frames', 0)).toBe('/tmp/frames/frame_000000.png');
		expect(frameFileName('/tmp/frames', 42)).toBe('/tmp/frames/frame_000042.png');
		expect(frameFileName('/tmp/frames', 123456)).toBe('/tmp/frames/frame_123456.png');
	});
});

describe('shouldYieldAfterFrame', () => {
	it('yields after every 4th frame (indices 3, 7, 11, ...)', () => {
		expect(shouldYieldAfterFrame(0)).toBe(false);
		expect(shouldYieldAfterFrame(1)).toBe(false);
		expect(shouldYieldAfterFrame(2)).toBe(false);
		expect(shouldYieldAfterFrame(3)).toBe(true);
		expect(shouldYieldAfterFrame(4)).toBe(false);
		expect(shouldYieldAfterFrame(7)).toBe(true);
		expect(shouldYieldAfterFrame(11)).toBe(true);
	});
});
