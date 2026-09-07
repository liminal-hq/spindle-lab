// Tests for the SVG Lab zustand store's import lifecycle.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvgLabStore } from './svg-lab-store';
import type { SvgImportResult } from './types';

vi.mock('./import', () => ({
	importSvg: vi.fn(),
}));

const { importSvg } = await import('./import');
const importSvgMock = vi.mocked(importSvg);

const initialState = useSvgLabStore.getState();

function makeResult(overrides: Partial<SvgImportResult> = {}): SvgImportResult {
	return {
		text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
		sourcePath: '/tmp/example.svg',
		features: {
			hasScript: false,
			hasForeignObject: false,
			externalFontFaces: [],
			unresolvedExternalRefs: [],
			smilAnimationCount: 0,
			cssAnimationRuleCount: 0,
			intrinsicWidth: 10,
			intrinsicHeight: 10,
			viewBox: [0, 0, 10, 10],
		},
		warnings: [],
		inlinedAssetCount: 0,
		...overrides,
	};
}

describe('useSvgLabStore', () => {
	afterEach(() => {
		useSvgLabStore.setState(initialState, true);
		importSvgMock.mockReset();
	});

	it('starts with no result, not loading, no error', () => {
		const state = useSvgLabStore.getState();
		expect(state.result).toBeNull();
		expect(state.loading).toBe(false);
		expect(state.error).toBeNull();
	});

	it('stores the result on a successful import', async () => {
		const result = makeResult();
		importSvgMock.mockResolvedValue(result);

		await useSvgLabStore.getState().importFile('/tmp/example.svg');

		const state = useSvgLabStore.getState();
		expect(state.result).toEqual(result);
		expect(state.loading).toBe(false);
		expect(state.error).toBeNull();
	});

	it('stores the error message on a failed import and clears any previous result', async () => {
		importSvgMock.mockRejectedValue(new Error('file not found'));

		await useSvgLabStore.getState().importFile('/tmp/missing.svg');

		const state = useSvgLabStore.getState();
		expect(state.result).toBeNull();
		expect(state.loading).toBe(false);
		expect(state.error).toContain('file not found');
	});
});
