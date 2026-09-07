// Tests for the DVD-Video raster/frame-rate legality guard (docs/plan.md's
// DVD MPEG-2 section) -- mirrors `ffmpeg.rs`'s Rust-side unit tests for
// `validate_dvd_raster`/`dvd_tv_system_for_fps`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
	dvdCaptureGuardMessage,
	dvdFrameRateErrorMessage,
	dvdRasterErrorMessage,
	isDvdLegalFps,
	isDvdLegalRaster,
} from './dvd';

describe('isDvdLegalRaster', () => {
	it('accepts exactly 720x480 and 720x576', () => {
		expect(isDvdLegalRaster(720, 480)).toBe(true);
		expect(isDvdLegalRaster(720, 576)).toBe(true);
	});

	it('rejects any other raster', () => {
		expect(isDvdLegalRaster(1280, 720)).toBe(false);
		expect(isDvdLegalRaster(720, 400)).toBe(false);
		expect(isDvdLegalRaster(1920, 1080)).toBe(false);
	});
});

describe('isDvdLegalFps', () => {
	it('accepts 30000/1001 (NTSC) and 25/1 (PAL)', () => {
		expect(isDvdLegalFps({ num: 30000, den: 1001 })).toBe(true);
		expect(isDvdLegalFps({ num: 25, den: 1 })).toBe(true);
	});

	it('rejects any other frame rate', () => {
		expect(isDvdLegalFps({ num: 30, den: 1 })).toBe(false);
		expect(isDvdLegalFps({ num: 24, den: 1 })).toBe(false);
		expect(isDvdLegalFps({ num: 60000, den: 1001 })).toBe(false);
	});
});

describe('dvdCaptureGuardMessage', () => {
	it('is null for a non-mpeg2-dvd codec regardless of raster/fps', () => {
		expect(dvdCaptureGuardMessage('h264-mp4', 1920, 1080, { num: 30, den: 1 })).toBeNull();
	});

	it('is null for a DVD-legal mpeg2-dvd request', () => {
		expect(dvdCaptureGuardMessage('mpeg2-dvd', 720, 480, { num: 30000, den: 1001 })).toBeNull();
		expect(dvdCaptureGuardMessage('mpeg2-dvd', 720, 576, { num: 25, den: 1 })).toBeNull();
	});

	it('reports the raster error before checking fps', () => {
		const message = dvdCaptureGuardMessage('mpeg2-dvd', 1280, 720, { num: 30, den: 1 });
		expect(message).toBe(dvdRasterErrorMessage(1280, 720));
	});

	it('reports the frame-rate error for a legal raster with an illegal fps', () => {
		const fps = { num: 30, den: 1 };
		const message = dvdCaptureGuardMessage('mpeg2-dvd', 720, 480, fps);
		expect(message).toBe(dvdFrameRateErrorMessage(fps));
	});
});
