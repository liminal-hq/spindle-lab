// The M6 result view (docs/plan.md §4.8): in-app playback of the muxed
// output, an independent ffprobe verification report, the exact ffmpeg argv
// (displayed and copyable), save/reveal, and session cleanup.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { convertFileSrc } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/Button';
import { Panel } from '../../../ui/Panel';
import { cleanupRenderSession, probeOutput, saveRenderAs } from '../render';
import { useSvgLabStore } from '../svg-lab-store';
import type { ProbeReport } from '../types';
import './ResultPanel.css';

// Upper bound for the blob-URL video fallback below: the whole file is
// fetched into webview memory, and while a lab export loop is normally
// short, nothing stops someone requesting a long capture -- fetching it
// whole has to stop somewhere. Matches Spindle's own
// `VIDEO_PREVIEW_BLOB_CAP_BYTES` (`SceneCanvas.tsx`'s `BackgroundVideo`),
// the precedent this whole fallback is ported from.
const VIDEO_PREVIEW_BLOB_CAP_BYTES = 512 * 1024 * 1024;

export function ResultPanel() {
	const sessionId = useSvgLabStore((s) => s.captureSessionId);
	const renderResult = useSvgLabStore((s) => s.renderResult);
	const resetCapture = useSvgLabStore((s) => s.resetCapture);

	const [probe, setProbe] = useState<ProbeReport | null>(null);
	const [probeError, setProbeError] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [cleanedUp, setCleanedUp] = useState(false);

	// Video loading: try Tauri's asset protocol directly first (native
	// streaming, no full-file memory load), and only fall back to a capped
	// in-memory blob if that fails -- see the `onError` handler below for
	// why (a WebKitGTK-specific gap, not a CSP/scope issue). Ported from
	// Spindle's `BackgroundVideo` (`SceneCanvas.tsx`), which hardened this
	// exact sequence for its own motion-menu background preview.
	const [loadFailed, setLoadFailed] = useState(false);
	const [blobSrc, setBlobSrc] = useState<string | null>(null);
	const videoElRef = useRef<HTMLVideoElement | null>(null);
	// Whether this output has already retried a load failure once -- a
	// freshly-muxed file can still be settling (e.g. a slow filesystem
	// flush) when the element starts loading, so one retry avoids a
	// permanent "Preview unavailable" for an output that's actually fine.
	const retriedRef = useRef(false);
	// Whether the blob-URL fallback fetch has been started for this output,
	// so a failing blob source doesn't loop back into another fetch.
	const blobAttemptedRef = useRef(false);
	// The output path this component currently renders -- read inside the
	// async fallback fetch so a result landing after the user starts a new
	// capture is dropped instead of applied to the wrong output.
	const outputPathRef = useRef<string | null>(null);
	outputPathRef.current = renderResult?.outputPath ?? null;
	// Live while mounted; the in-flight fallback fetch checks it before
	// creating an object URL, so an unmount mid-download can't strand an
	// unrevoked URL on a setter that no longer renders anything.
	const mountedRef = useRef(true);
	// The in-flight fallback fetch's controller -- aborted on unmount and on
	// a new render result so a stale download stops consuming the full file.
	const blobAbortRef = useRef<AbortController | null>(null);

	const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
		videoElRef.current = el;
	}, []);

	useEffect(() => {
		setProbe(null);
		setProbeError(null);
		setCleanedUp(false);
		setLoadFailed(false);
		retriedRef.current = false;
		blobAttemptedRef.current = false;
		blobAbortRef.current?.abort();
		blobAbortRef.current = null;
		setBlobSrc(null);
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

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			blobAbortRef.current?.abort();
			blobAbortRef.current = null;
		};
	}, []);

	// Revoke a fallback object URL once it's replaced or the component
	// unmounts, so the fetched bytes don't outlive the preview needing them.
	useEffect(() => {
		return () => {
			if (blobSrc != null) URL.revokeObjectURL(blobSrc);
		};
	}, [blobSrc]);

	if (renderResult == null) return null;

	function handleVideoError() {
		if (!retriedRef.current) {
			retriedRef.current = true;
			setTimeout(() => videoElRef.current?.load(), 300);
			return;
		}
		// WebKitGTK's media player cannot stream over Tauri's custom asset://
		// scheme (plain fetches through it work fine -- confirmed manually
		// against the real app: correct headers, working HTTP Range support),
		// so on Linux the <video> above always fails with
		// MEDIA_ERR_SRC_NOT_SUPPORTED regardless of codec. GStreamer's
		// playback pipeline uses its own network element rather than
		// WebKit's page resource loader (what fetch()/<img> use), and that
		// element does not know about Tauri's custom protocol handler.
		// Fall back to fetching the file through the asset protocol --
		// which still enforces the same capability scope -- and playing it
		// from an in-memory blob URL, capped so a large export can't be
		// forced whole into memory.
		if (!blobAttemptedRef.current && renderResult != null) {
			blobAttemptedRef.current = true;
			const fallbackPath = renderResult.outputPath;
			const controller = new AbortController();
			blobAbortRef.current = controller;
			void (async () => {
				try {
					const response = await fetch(convertFileSrc(fallbackPath), {
						signal: controller.signal,
					});
					if (!response.ok) {
						throw new Error(`asset fetch failed: ${response.status}`);
					}
					// Fast-path reject on the header, but don't trust it alone --
					// a missing or malformed Content-Length must not bypass the
					// cap, so it's also enforced while the stream is consumed.
					const length = Number(response.headers.get('content-length') ?? '0');
					if (length > VIDEO_PREVIEW_BLOB_CAP_BYTES) {
						throw new Error('output too large for blob preview');
					}
					let blob: Blob;
					if (response.body) {
						const reader = response.body.getReader();
						const chunks: BlobPart[] = [];
						let received = 0;
						for (;;) {
							const { done, value } = await reader.read();
							if (done) break;
							received += value.byteLength;
							if (received > VIDEO_PREVIEW_BLOB_CAP_BYTES) {
								controller.abort();
								throw new Error('output too large for blob preview');
							}
							chunks.push(value);
						}
						blob = new Blob(chunks);
					} else {
						blob = await response.blob();
					}
					if (!mountedRef.current || outputPathRef.current !== fallbackPath) return;
					setBlobSrc(URL.createObjectURL(blob));
				} catch {
					if (mountedRef.current && outputPathRef.current === fallbackPath) {
						setLoadFailed(true);
					}
				}
			})();
			return;
		}
		setLoadFailed(true);
	}

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
			{loadFailed ? (
				<div className="result-panel__video-placeholder">Preview unavailable</div>
			) : (
				<video
					// Keyed on the source so switching to the blob fallback mounts a
					// fresh element: a failed asset:// load can still deliver a
					// queued error event after React swaps `src`, which would read
					// as a bogus blob failure on a reused element.
					key={blobSrc ?? 'asset-protocol'}
					ref={setVideoRef}
					className="result-panel__video"
					src={blobSrc ?? convertFileSrc(renderResult.outputPath)}
					controls
					loop
					autoPlay
					onError={handleVideoError}
				/>
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
