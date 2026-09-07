// Tests for the pure sizing/text half of rasterise.ts (docs/plan.md §4.4).
// The impure `rasteriseSvg` pipeline (Blob -> Image.decode() -> canvas) is
// not meaningfully testable under happy-dom -- no real image decoding or 2D
// canvas rendering -- and is verified manually via Playwright instead; see
// the M4 report.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
	parseSvgLength,
	parseViewBox,
	prepareSvgForRasterisation,
	resolveViewBox,
} from './rasterise';

describe('parseSvgLength', () => {
	it('parses a bare number', () => {
		expect(parseSvgLength('200')).toBe(200);
	});

	it('strips a trailing unit', () => {
		expect(parseSvgLength('200px')).toBe(200);
		expect(parseSvgLength('50%')).toBe(50);
	});

	it('returns null for null or unparsable input', () => {
		expect(parseSvgLength(null)).toBeNull();
		expect(parseSvgLength('auto')).toBeNull();
	});
});

describe('parseViewBox', () => {
	it('parses a space-separated viewBox', () => {
		expect(parseViewBox('0 0 200 100')).toEqual({ minX: 0, minY: 0, width: 200, height: 100 });
	});

	it('parses a comma-separated viewBox', () => {
		expect(parseViewBox('1,2,3,4')).toEqual({ minX: 1, minY: 2, width: 3, height: 4 });
	});

	it('returns null for the wrong number of components or null input', () => {
		expect(parseViewBox(null)).toBeNull();
		expect(parseViewBox('0 0 100')).toBeNull();
	});
});

describe('resolveViewBox', () => {
	it('prefers an explicit viewBox over width/height', () => {
		const root = { getAttribute: (name: string) => (name === 'viewBox' ? '0 0 50 50' : '999') };
		expect(resolveViewBox(root)).toEqual({ minX: 0, minY: 0, width: 50, height: 50 });
	});

	it('synthesises a viewBox from width/height when absent', () => {
		const attrs: Record<string, string | null> = { width: '640', height: '480' };
		const root = { getAttribute: (name: string) => attrs[name] ?? null };
		expect(resolveViewBox(root)).toEqual({ minX: 0, minY: 0, width: 640, height: 480 });
	});

	it('throws when neither a viewBox nor width/height is present', () => {
		const root = { getAttribute: () => null };
		expect(() => resolveViewBox(root)).toThrow(/no viewBox and no numeric width\/height/);
	});
});

describe('prepareSvgForRasterisation', () => {
	it('sets explicit export width/height and preserveAspectRatio', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>`;
		const prepared = prepareSvgForRasterisation(svg, 640, 480);
		const doc = new DOMParser().parseFromString(prepared, 'image/svg+xml');
		const root = doc.documentElement;
		expect(root.getAttribute('width')).toBe('640');
		expect(root.getAttribute('height')).toBe('480');
		expect(root.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
		expect(root.getAttribute('viewBox')).toBe('0 0 100 100');
	});

	it('synthesises a viewBox from width/height when the source has none', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="10" height="10"/></svg>`;
		const prepared = prepareSvgForRasterisation(svg, 400, 200);
		const doc = new DOMParser().parseFromString(prepared, 'image/svg+xml');
		expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 200 100');
	});

	it('throws for a source with no sizing basis at all', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="30"/></svg>`;
		expect(() => prepareSvgForRasterisation(svg, 100, 100)).toThrow();
	});

	it('defaults to fit (xMidYMid meet) when fitMode is omitted', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`;
		const prepared = prepareSvgForRasterisation(svg, 640, 480);
		const doc = new DOMParser().parseFromString(prepared, 'image/svg+xml');
		expect(doc.documentElement.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
	});

	it('maps fitMode "fit" to xMidYMid meet (letterbox/pillarbox, undistorted)', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`;
		const prepared = prepareSvgForRasterisation(svg, 640, 480, 'fit');
		const doc = new DOMParser().parseFromString(prepared, 'image/svg+xml');
		expect(doc.documentElement.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
	});

	it('maps fitMode "stretch" to preserveAspectRatio="none" (fill, may distort)', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`;
		const prepared = prepareSvgForRasterisation(svg, 640, 480, 'stretch');
		const doc = new DOMParser().parseFromString(prepared, 'image/svg+xml');
		expect(doc.documentElement.getAttribute('preserveAspectRatio')).toBe('none');
	});

	it('maps fitMode "fill" to xMidYMid slice (cover, crops, undistorted)', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`;
		const prepared = prepareSvgForRasterisation(svg, 640, 480, 'fill');
		const doc = new DOMParser().parseFromString(prepared, 'image/svg+xml');
		expect(doc.documentElement.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
	});
});
