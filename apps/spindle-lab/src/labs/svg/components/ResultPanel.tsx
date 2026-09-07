// The M6 result view (docs/plan.md §4.8): in-app playback of the muxed
// output, an independent ffprobe verification report, the exact ffmpeg argv
// (displayed and copyable), save/reveal, and session cleanup.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { convertFileSrc } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';
import { Button } from '../../../ui/Button';
import { Panel } from '../../../ui/Panel';
import { cleanupRenderSession, probeOutput, saveRenderAs } from '../render';
import { useSvgLabStore } from '../svg-lab-store';
import type { ProbeReport } from '../types';
import './ResultPanel.css';

export function ResultPanel() {
	const sessionId = useSvgLabStore((s) => s.captureSessionId);
	const renderResult = useSvgLabStore((s) => s.renderResult);
	const resetCapture = useSvgLabStore((s) => s.resetCapture);

	const [probe, setProbe] = useState<ProbeReport | null>(null);
	const [probeError, setProbeError] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [cleanedUp, setCleanedUp] = useState(false);
	const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
	const [videoError, setVideoError] = useState<string | null>(null);

	useEffect(() => {
		setProbe(null);
		setProbeError(null);
		setCleanedUp(false);
		if (renderResult == null) return;
		let cancelled = false;
		probeOutput(renderResult.outputPath)
			.then((report) => {
				if (!cancelled) setProbe(report);
			})
			.catch((err) => {
				if (!cancelled) setProbeError(String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [renderResult]);

	// WebKitGTK's <video> element cannot play a src pointed directly at
	// Tauri's asset protocol (`convertFileSrc`'s URL) -- confirmed manually
	// against the real app: `fetch()` against that exact URL succeeds with
	// correct headers (including working HTTP Range support), but assigning
	// it as `video.src` fails immediately with `MEDIA_ERR_SRC_NOT_SUPPORTED`.
	// This is a GStreamer/WebKitGTK limitation, not a CSP or scope issue --
	// GStreamer's playback pipeline uses its own network element for
	// `<video>`/`<audio>` sources rather than going through WebKit's page
	// resource loader (which is what `fetch()` and `<img>` use), and that
	// element does not know about Tauri's custom protocol handler. Fetching
	// the bytes ourselves and handing the video element a `blob:` URL (which
	// *is* backed by in-memory data GStreamer can read directly) sidesteps
	// the problem entirely.
	useEffect(() => {
		setVideoBlobUrl(null);
		setVideoError(null);
		if (renderResult == null) return;
		let cancelled = false;
		let objectUrl: string | null = null;
		fetch(convertFileSrc(renderResult.outputPath))
			.then((res) => {
				if (!res.ok) throw new Error(`fetch failed with status ${res.status}`);
				return res.blob();
			})
			.then((blob) => {
				if (cancelled) return;
				objectUrl = URL.createObjectURL(blob);
				setVideoBlobUrl(objectUrl);
			})
			.catch((err) => {
				if (!cancelled) setVideoError(String(err));
			});
		return () => {
			cancelled = true;
			if (objectUrl != null) URL.revokeObjectURL(objectUrl);
		};
	}, [renderResult]);

	if (renderResult == null) return null;

	async function handleCopyCommand() {
		if (renderResult == null) return;
		try {
			await navigator.clipboard.writeText(renderResult.ffmpegCommand.join(' '));
			setStatusMessage('ffmpeg command copied to clipboard.');
		} catch (err) {
			setStatusMessage(`Could not copy to clipboard: ${String(err)}`);
		}
	}

	async function handleSaveAs() {
		if (renderResult == null) return;
		try {
			const extension = renderResult.outputPath.split('.').pop() ?? 'mp4';
			const destination = await save({
				defaultPath: renderResult.outputPath.split('/').pop(),
				filters: [{ name: 'Video', extensions: [extension] }],
			});
			if (destination == null) return;
			await saveRenderAs(renderResult.outputPath, destination);
			setStatusMessage(`Saved to ${destination}.`);
		} catch (err) {
			setStatusMessage(`Save failed: ${String(err)}`);
		}
	}

	async function handleReveal() {
		if (renderResult == null) return;
		try {
			await revealItemInDir(renderResult.outputPath);
		} catch (err) {
			setStatusMessage(`Could not reveal the file: ${String(err)}`);
		}
	}

	async function handleCleanupFrames() {
		if (sessionId == null) return;
		try {
			await cleanupRenderSession(sessionId, false);
			setCleanedUp(true);
			setStatusMessage('Captured frames removed; the output file was kept.');
		} catch (err) {
			setStatusMessage(`Cleanup failed: ${String(err)}`);
		}
	}

	return (
		<Panel title="Result" className="result-panel">
			{videoBlobUrl != null ? (
				<video className="result-panel__video" src={videoBlobUrl} controls loop autoPlay />
			) : (
				<div className="result-panel__video-placeholder">
					{videoError != null ? `Could not load the video: ${videoError}` : 'Loading video…'}
				</div>
			)}

			<dl className="result-panel__facts">
				<div>
					<dt>Output</dt>
					<dd className="result-panel__path">{renderResult.outputPath}</dd>
				</div>
				<div>
					<dt>Requested</dt>
					<dd>
						{renderResult.frameCount} frames &middot; {renderResult.durationSecs.toFixed(2)}s
					</dd>
				</div>
			</dl>

			<div className="result-panel__probe">
				<h4>ffprobe verification</h4>
				{probeError != null && <p className="result-panel__error">{probeError}</p>}
				{probe != null && (
					<dl className="result-panel__facts">
						<div>
							<dt>Codec</dt>
							<dd>{probe.codecName ?? '—'}</dd>
						</div>
						<div>
							<dt>Dimensions</dt>
							<dd>
								{probe.width != null && probe.height != null
									? `${probe.width} × ${probe.height}`
									: '—'}
							</dd>
						</div>
						<div>
							<dt>Frame rate</dt>
							<dd>{probe.rFrameRate ?? '—'}</dd>
						</div>
						<div>
							<dt>Frame count</dt>
							<dd>{probe.nbFrames ?? '—'}</dd>
						</div>
						<div>
							<dt>Duration</dt>
							<dd>{probe.durationSecs != null ? `${probe.durationSecs.toFixed(2)}s` : '—'}</dd>
						</div>
						<div>
							<dt>Colour tags</dt>
							<dd>
								{[probe.colorPrimaries, probe.colorTransfer, probe.colorSpace]
									.filter((v) => v != null)
									.join(' / ') || '—'}
							</dd>
						</div>
					</dl>
				)}
			</div>

			<div className="result-panel__command">
				<h4>ffmpeg command</h4>
				<code className="result-panel__command-text">{renderResult.ffmpegCommand.join(' ')}</code>
				<Button variant="secondary" onClick={handleCopyCommand}>
					Copy command
				</Button>
			</div>

			<div className="result-panel__actions">
				<Button variant="primary" onClick={handleSaveAs}>
					Save as…
				</Button>
				<Button variant="secondary" onClick={handleReveal}>
					Reveal
				</Button>
				<Button variant="secondary" onClick={handleCleanupFrames} disabled={cleanedUp}>
					{cleanedUp ? 'Frames removed' : 'Clean up frames'}
				</Button>
				<Button variant="secondary" onClick={resetCapture}>
					Start a new capture
				</Button>
			</div>

			{statusMessage != null && <p className="result-panel__status">{statusMessage}</p>}
		</Panel>
	);
}
