// SVG Lab page composition: import, a live sandboxed preview, the transport
// bar (docs/plan.md §4, M2 + M3), bake parity (M4), and the M5/M6 capture
// + mux pipeline: export settings -> begin session -> the frontend frame
// loop with progress/cancel -> mux -> the result panel.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { Panel } from '../../ui/Panel';
import { ProgressBar } from '../../ui/ProgressBar';
import { useSvgLabStore } from './svg-lab-store';
import { runCaptureLoop } from './capture';
import {
	beginRenderSession,
	cancelRenderSession,
	cleanupRenderSession,
	listenForRenderProgress,
	muxRenderSession,
} from './render';
import { computeFrameCount } from './timeline';
import { BakeParityView } from './components/BakeParityView';
import { ExportSettingsPanel } from './components/ExportSettingsPanel';
import { FeatureReportPanel } from './components/FeatureReportPanel';
import { ResultPanel } from './components/ResultPanel';
import { SvgPreviewFrame } from './components/SvgPreviewFrame';
import { TransportBar } from './components/TransportBar';
import './SvgLab.css';

export function SvgLab() {
	const result = useSvgLabStore((s) => s.result);
	const loading = useSvgLabStore((s) => s.loading);
	const error = useSvgLabStore((s) => s.error);
	const importFile = useSvgLabStore((s) => s.importFile);
	const capturePhase = useSvgLabStore((s) => s.capturePhase);
	const captureFramesDone = useSvgLabStore((s) => s.captureFramesDone);
	const captureFrameTotal = useSvgLabStore((s) => s.captureFrameTotal);
	const captureError = useSvgLabStore((s) => s.captureError);
	const muxProgress = useSvgLabStore((s) => s.muxProgress);

	// `SvgPreviewFrame` hands back its iframe's `contentDocument` once loaded;
	// TransportBar needs it to drive play/pause/scrub (docs/plan.md §4.2),
	// and the capture loop needs it to bake CSS animations against live
	// WAAPI/CSSOM state (docs/plan.md §4.3(b)).
	const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
	const handlePreviewReady = useCallback((doc: Document | null) => setPreviewDoc(doc), []);

	// The capture loop's own cancellation check (docs/plan.md §4.6): a plain
	// ref rather than store state, since the loop reads it synchronously on
	// every iteration and a ref avoids any risk of a stale closure over a
	// snapshotted store value.
	const cancelRequestedRef = useRef(false);

	// Mux progress arrives over `spindle-lab://render-progress`
	// (docs/plan.md §5) rather than via the store directly, since it's
	// emitted from Rust; only forward events for the session this page is
	// currently tracking.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		listenForRenderProgress((event) => {
			const currentSessionId = useSvgLabStore.getState().captureSessionId;
			if (event.sessionId === currentSessionId) {
				useSvgLabStore.getState().setMuxProgress(event);
			}
		}).then((fn) => {
			unlisten = fn;
		});
		return () => unlisten?.();
	}, []);

	async function handlePick() {
		const selected = await open({
			title: 'Import SVG',
			multiple: false,
			filters: [{ name: 'SVG', extensions: ['svg'] }],
		});
		if (typeof selected !== 'string') return;
		await importFile(selected);
	}

	async function handleStartCapture() {
		if (result == null || previewDoc == null) return;

		const store = useSvgLabStore.getState();
		const durationSecs = store.durationOverrideSecs ?? store.derivedDurationSecs ?? 5.0;
		const frameCount = computeFrameCount(durationSecs, store.fps, store.loopMode);
		if (frameCount <= 0) {
			store.setCaptureError('Nothing to capture: the computed frame count is zero.');
			return;
		}

		let sessionId: string;
		let framesDir: string;
		try {
			const session = await beginRenderSession({
				width: store.exportWidth,
				height: store.exportHeight,
				frameCount,
				fpsNum: store.fps.num,
				fpsDen: store.fps.den,
				label: result.sourcePath,
			});
			sessionId = session.sessionId;
			framesDir = session.framesDir;
		} catch (err) {
			store.setCaptureError(String(err));
			return;
		}

		cancelRequestedRef.current = false;
		store.beginCapture(sessionId, frameCount);

		const outcome = await runCaptureLoop({
			sourceText: result.text,
			features: result.features,
			previewDoc,
			framesDir,
			frameCount,
			durationSecs,
			fps: store.fps,
			loopMode: store.loopMode,
			width: store.exportWidth,
			height: store.exportHeight,
			background: store.background,
			onProgress: (done, total) => useSvgLabStore.getState().setCaptureProgress(done, total),
			isCancelled: () => cancelRequestedRef.current,
		});

		if (outcome.cancelled) {
			await cancelRenderSession(sessionId).catch(() => {});
			await cleanupRenderSession(sessionId, false).catch(() => {});
			useSvgLabStore.getState().setCapturePhase('cancelled');
			return;
		}

		useSvgLabStore.getState().setCapturePhase('muxing');
		try {
			const muxResult = await muxRenderSession(sessionId, {
				codec: store.codec,
				fpsNum: store.fps.num,
				fpsDen: store.fps.den,
				loopCount: store.loopCount,
				outputPath: null,
				crf: null,
			});
			useSvgLabStore.getState().setRenderResult(muxResult);
			useSvgLabStore.getState().setCapturePhase('done');
		} catch (err) {
			useSvgLabStore.getState().setCaptureError(String(err));
		}
	}

	function handleCancelCapture() {
		cancelRequestedRef.current = true;
	}

	const isCapturing = capturePhase === 'capturing';
	const isMuxing = capturePhase === 'muxing';

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
							<div className="svg-lab__preview-row">
								<SvgPreviewFrame svgText={result.text} onReady={handlePreviewReady} />
								<BakeParityView result={result} previewDoc={previewDoc} />
							</div>
							<TransportBar doc={previewDoc} />
							<ExportSettingsPanel />
							<Panel title="Capture" className="svg-lab__capture">
								<div className="svg-lab__capture-controls">
									<Button
										variant="primary"
										onClick={handleStartCapture}
										disabled={previewDoc == null || isCapturing || isMuxing}
									>
										{isCapturing ? 'Capturing…' : isMuxing ? 'Muxing…' : 'Capture'}
									</Button>
									{isCapturing && (
										<Button variant="secondary" onClick={handleCancelCapture}>
											Cancel
										</Button>
									)}
								</div>
								{isCapturing && (
									<ProgressBar
										value={captureFramesDone}
										max={Math.max(captureFrameTotal, 1)}
										label={`Capturing frame ${captureFramesDone} / ${captureFrameTotal}`}
									/>
								)}
								{isMuxing && (
									<ProgressBar
										value={muxProgress?.percent ?? 0}
										max={100}
										label={
											muxProgress?.percent != null
												? `Muxing… ${muxProgress.percent.toFixed(0)}%`
												: 'Muxing…'
										}
									/>
								)}
								{capturePhase === 'cancelled' && (
									<p className="svg-lab__capture-status">Capture cancelled.</p>
								)}
								{capturePhase === 'error' && captureError != null && (
									<p className="svg-lab__capture-error" role="alert">
										{captureError}
									</p>
								)}
							</Panel>
							<ResultPanel />
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
