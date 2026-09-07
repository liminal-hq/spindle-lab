// Shows the parsed feature report and warnings for an imported SVG, including
// the blocking banner for script-bearing SVGs (docs/plan.md §4.1, §8).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { Panel } from '../../../ui/Panel';
import type { SvgImportResult } from '../types';
import './FeatureReportPanel.css';

interface FeatureReportPanelProps {
	result: SvgImportResult;
}

export function FeatureReportPanel({ result }: FeatureReportPanelProps) {
	const { features, warnings, inlinedAssetCount } = result;

	return (
		<Panel title="Feature report" className="feature-report">
			{features.hasScript && (
				<div className="feature-report__blocking-banner" role="alert">
					Script-driven animation is not supported in this version.
				</div>
			)}

			<dl className="feature-report__counts">
				<div>
					<dt>SMIL animations</dt>
					<dd>{features.smilAnimationCount}</dd>
				</div>
				<div>
					<dt>CSS animation rules</dt>
					<dd>{features.cssAnimationRuleCount}</dd>
				</div>
				<div>
					<dt>Assets inlined</dt>
					<dd>{inlinedAssetCount}</dd>
				</div>
				<div>
					<dt>Intrinsic size</dt>
					<dd>
						{features.intrinsicWidth != null && features.intrinsicHeight != null
							? `${features.intrinsicWidth} × ${features.intrinsicHeight}`
							: '—'}
					</dd>
				</div>
				<div>
					<dt>viewBox</dt>
					<dd>{features.viewBox != null ? features.viewBox.join(' ') : '—'}</dd>
				</div>
			</dl>

			{warnings.length > 0 && (
				<ul className="feature-report__warnings">
					{warnings.map((warning, index) => (
						<li key={`${warning.code}-${index}`} className="feature-report__warning">
							<span className="feature-report__warning-code">{warning.code}</span>
							{warning.message}
						</li>
					))}
				</ul>
			)}
		</Panel>
	);
}
