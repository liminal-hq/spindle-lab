// SVG Lab page composition: import + a live, sandboxed preview (docs/plan.md
// §4, M2). Timeline/transport (M3), baking (M4), capture (M5), and mux (M6)
// are later milestones and are not built here.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { open } from '@tauri-apps/plugin-dialog';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { useSvgLabStore } from './svg-lab-store';
import { FeatureReportPanel } from './components/FeatureReportPanel';
import { SvgPreviewFrame } from './components/SvgPreviewFrame';
import './SvgLab.css';

export function SvgLab() {
	const result = useSvgLabStore((s) => s.result);
	const loading = useSvgLabStore((s) => s.loading);
	const error = useSvgLabStore((s) => s.error);
	const importFile = useSvgLabStore((s) => s.importFile);

	async function handlePick() {
		const selected = await open({
			title: 'Import SVG',
			multiple: false,
			filters: [{ name: 'SVG', extensions: ['svg'] }],
		});
		if (typeof selected !== 'string') return;
		await importFile(selected);
	}

	return (
		<div className="svg-lab">
			<div className="svg-lab__toolbar">
				<Button variant="primary" onClick={handlePick} disabled={loading}>
					{loading ? 'Importing…' : 'Import SVG…'}
				</Button>
				{result != null && <span className="svg-lab__source-path">{result.sourcePath}</span>}
			</div>

			{error != null && (
				<Panel title="Import failed" className="svg-lab__error">
					<p>{error}</p>
				</Panel>
			)}

			{result != null && (
				<div className="svg-lab__content">
					<FeatureReportPanel result={result} />
					{result.features.hasScript ? (
						<Panel title="Preview" className="svg-lab__preview-blocked">
							<p>Preview is unavailable for script-bearing SVGs -- see the feature report above.</p>
						</Panel>
					) : (
						<div className="svg-lab__preview">
							<SvgPreviewFrame svgText={result.text} />
						</div>
					)}
				</div>
			)}

			{result == null && error == null && (
				<Panel title="SVG Lab">
					<p>Import an SVG file to see its feature report and a sandboxed live preview.</p>
				</Panel>
			)}
		</div>
	);
}
