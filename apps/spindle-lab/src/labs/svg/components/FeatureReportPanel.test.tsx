// Tests for FeatureReportPanel: the blocking banner and warnings list.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeatureReportPanel } from './FeatureReportPanel';
import type { SvgImportResult } from '../types';

function makeResult(overrides: Partial<SvgImportResult> = {}): SvgImportResult {
	return {
		text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
		sourcePath: '/tmp/example.svg',
		features: {
			hasScript: false,
			hasForeignObject: false,
			externalFontFaces: [],
			unresolvedExternalRefs: [],
			smilAnimationCount: 2,
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

describe('FeatureReportPanel', () => {
	it('shows the blocking banner for a script-bearing SVG', () => {
		const result = makeResult({
			features: { ...makeResult().features, hasScript: true },
		});

		render(<FeatureReportPanel result={result} />);

		expect(
			screen.getByText('Script-driven animation is not supported in this version.'),
		).toBeInTheDocument();
	});

	it('does not show the blocking banner for a non-scripted SVG', () => {
		render(<FeatureReportPanel result={makeResult()} />);

		expect(
			screen.queryByText('Script-driven animation is not supported in this version.'),
		).not.toBeInTheDocument();
	});

	it('shows the SMIL animation count', () => {
		render(<FeatureReportPanel result={makeResult()} />);

		expect(screen.getByText('2')).toBeInTheDocument();
	});

	it('lists warnings with their code and message', () => {
		const result = makeResult({
			warnings: [{ code: 'missing-sizing', message: 'No viewBox and no width/height.' }],
		});

		render(<FeatureReportPanel result={result} />);

		expect(screen.getByText('missing-sizing')).toBeInTheDocument();
		expect(screen.getByText('No viewBox and no width/height.')).toBeInTheDocument();
	});
});
