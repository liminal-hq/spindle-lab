// Play/pause/scrub/frame-step transport for the live sandboxed preview
// (docs/plan.md §4.2, M3). All playback is the browser's own SMIL/WAAPI
// engines via `transport.ts`; this component only translates UI events into
// those calls and mirrors the resulting time into the store.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../ui/Button';
import { Panel } from '../../../ui/Panel';
import { effectiveDurationSecs, useSvgLabStore } from '../svg-lab-store';
import {
	FPS_PRESETS,
	computeFrameCount,
	deriveDocumentDurationSeconds,
	frameIndexForTimeSeconds,
	frameTimeSeconds,
	type Fps,
	type LoopMode,
} from '../timeline';
import { asSeekableSvgDocument, seekPreviewTo, setPreviewPlaying } from '../transport';
import './TransportBar.css';

interface TransportBarProps {
	/** The sandboxed iframe's `contentDocument`, from `SvgPreviewFrame`'s `onReady`. `null` until it first loads. */
	doc: Document | null;
}

const CUSTOM_FPS_LABEL = 'Custom…';

export function TransportBar({ doc }: TransportBarProps) {
	const currentTimeSecs = useSvgLabStore((s) => s.currentTimeSecs);
	const isPlaying = useSvgLabStore((s) => s.isPlaying);
	const fps = useSvgLabStore((s) => s.fps);
	const loopMode = useSvgLabStore((s) => s.loopMode);
	const derivedDurationSecs = useSvgLabStore((s) => s.derivedDurationSecs);
	const durationOverrideSecs = useSvgLabStore((s) => s.durationOverrideSecs);
	const setCurrentTimeSecs = useSvgLabStore((s) => s.setCurrentTimeSecs);
	const setPlaying = useSvgLabStore((s) => s.setPlaying);
	const setFps = useSvgLabStore((s) => s.setFps);
	const setLoopMode = useSvgLabStore((s) => s.setLoopMode);
	const setDerivedDurationSecs = useSvgLabStore((s) => s.setDerivedDurationSecs);
	const setDurationOverrideSecs = useSvgLabStore((s) => s.setDurationOverrideSecs);

	const [customFps, setCustomFps] = useState<Fps>(fps);

	// As soon as the live preview document is ready (and again each time a
	// new SVG replaces it): derive the suggested duration (docs/plan.md
	// §4.5), and pause + rewind it to t=0. The sandboxed iframe's SMIL/CSS
	// engines autoplay from the instant `srcDoc` loads, so without this the
	// transport bar's initial "Play" button and "0.00s" readout would lie
	// about an animation that is already mid-cycle.
	useEffect(() => {
		if (doc == null) return;
		setDerivedDurationSecs(deriveDocumentDurationSeconds(doc));
		const seekable = asSeekableSvgDocument(doc);
		setPreviewPlaying(seekable, false);
		seekPreviewTo(seekable, 0);
		setPlaying(false);
		setCurrentTimeSecs(0);
	}, [doc, setDerivedDurationSecs, setPlaying, setCurrentTimeSecs]);

	const durationSecs = effectiveDurationSecs({ derivedDurationSecs, durationOverrideSecs });
	const frameCount = useMemo(
		() => computeFrameCount(durationSecs, fps, loopMode),
		[durationSecs, fps, loopMode],
	);
	const maxFrameIndex = Math.max(frameCount - 1, 0);
	const currentFrame = useMemo(
		() => frameIndexForTimeSeconds(currentTimeSecs, durationSecs, fps, loopMode),
		[currentTimeSecs, durationSecs, fps, loopMode],
	);

	const disabled = doc == null;

	// While playing, the live document advances its own clock; poll it each
	// frame purely for the readout -- nothing here drives playback itself.
	const isPlayingRef = useRef(isPlaying);
	isPlayingRef.current = isPlaying;
	useEffect(() => {
		if (!isPlaying || doc == null) return;
		let raf = 0;
		// The imported SVG's root is nested inside <body>, not doc.documentElement
		// -- see the doc comment on transport.ts's SeekableSvgDocument.
		const svg = doc.querySelector('svg') as unknown as { getCurrentTime?: () => number } | null;
		const tick = () => {
			if (!isPlayingRef.current) return;
			if (typeof svg?.getCurrentTime === 'function') {
				const t = svg.getCurrentTime();
				if (Number.isFinite(t)) setCurrentTimeSecs(t);
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [isPlaying, doc, setCurrentTimeSecs]);

	function seekTo(t: number) {
		const clamped = Math.min(Math.max(t, 0), durationSecs);
		setCurrentTimeSecs(clamped);
		if (doc != null) seekPreviewTo(asSeekableSvgDocument(doc), clamped);
	}

	function stepToFrame(index: number) {
		const clampedIndex = Math.min(Math.max(index, 0), maxFrameIndex);
		if (isPlaying && doc != null) {
			setPlaying(false);
			setPreviewPlaying(asSeekableSvgDocument(doc), false);
		}
		seekTo(frameTimeSeconds(clampedIndex, durationSecs, fps, loopMode));
	}

	function handlePlayPause() {
		if (doc == null) return;
		const next = !isPlaying;
		setPlaying(next);
		setPreviewPlaying(asSeekableSvgDocument(doc), next);
	}

	function handleFpsPresetChange(label: string) {
		if (label === CUSTOM_FPS_LABEL) return;
		const preset = FPS_PRESETS.find((p) => p.label === label);
		if (preset != null) setFps(preset.fps);
	}

	function handleCustomFpsChange(next: Fps) {
		setCustomFps(next);
		if (next.num > 0 && next.den > 0) setFps(next);
	}

	const matchingPreset = FPS_PRESETS.find((p) => p.fps.num === fps.num && p.fps.den === fps.den);
	const fpsSelectValue = matchingPreset?.label ?? CUSTOM_FPS_LABEL;

	return (
		<Panel title="Transport" className="transport-bar">
			<div className="transport-bar__row">
				<Button
					onClick={handlePlayPause}
					disabled={disabled}
					aria-label={isPlaying ? 'Pause' : 'Play'}
				>
					{isPlaying ? 'Pause' : 'Play'}
				</Button>
				<Button
					variant="secondary"
					onClick={() => stepToFrame(currentFrame - 1)}
					disabled={disabled}
					aria-label="Previous frame"
				>
					Prev frame
				</Button>
				<Button
					variant="secondary"
					onClick={() => stepToFrame(currentFrame + 1)}
					disabled={disabled}
					aria-label="Next frame"
				>
					Next frame
				</Button>
				<span className="transport-bar__readout">
					{currentTimeSecs.toFixed(2)}s &middot; frame {currentFrame} / {maxFrameIndex}
				</span>
			</div>

			<input
				className="transport-bar__scrub"
				type="range"
				min={0}
				max={durationSecs}
				step={durationSecs > 0 ? durationSecs / Math.max(frameCount, 1) : 0.01}
				value={currentTimeSecs}
				disabled={disabled}
				onChange={(event) => seekTo(Number(event.target.value))}
				aria-label="Scrub"
			/>

			<div className="transport-bar__row">
				<label className="transport-bar__field">
					Duration
					<span className="transport-bar__badge">
						{durationOverrideSecs != null ? 'overridden' : 'derived'}
					</span>
					<input
						type="number"
						min={0.01}
						step={0.01}
						value={durationSecs}
						onChange={(event) => {
							const value = Number(event.target.value);
							setDurationOverrideSecs(Number.isFinite(value) && value > 0 ? value : null);
						}}
					/>
				</label>
				{durationOverrideSecs != null && (
					<Button variant="secondary" onClick={() => setDurationOverrideSecs(null)}>
						Reset to derived
					</Button>
				)}
				{derivedDurationSecs != null && (
					<span className="transport-bar__derived-value">
						derived: {derivedDurationSecs.toFixed(2)}s
					</span>
				)}
			</div>

			<div className="transport-bar__row">
				<label className="transport-bar__field">
					FPS
					<select
						value={fpsSelectValue}
						onChange={(event) => handleFpsPresetChange(event.target.value)}
					>
						{FPS_PRESETS.map((preset) => (
							<option key={preset.label} value={preset.label}>
								{preset.label}
							</option>
						))}
						<option value={CUSTOM_FPS_LABEL}>{CUSTOM_FPS_LABEL}</option>
					</select>
				</label>
				{fpsSelectValue === CUSTOM_FPS_LABEL && (
					<span className="transport-bar__custom-fps">
						<input
							type="number"
							min={1}
							value={customFps.num}
							onChange={(event) =>
								handleCustomFpsChange({ ...customFps, num: Number(event.target.value) })
							}
							aria-label="Custom fps numerator"
						/>
						/
						<input
							type="number"
							min={1}
							value={customFps.den}
							onChange={(event) =>
								handleCustomFpsChange({ ...customFps, den: Number(event.target.value) })
							}
							aria-label="Custom fps denominator"
						/>
					</span>
				)}
				<label className="transport-bar__field">
					Loop mode
					<select
						value={loopMode}
						onChange={(event) => setLoopMode(event.target.value as LoopMode)}
					>
						<option value="seamless">Seamless (end-exclusive)</option>
						<option value="once">Once (end-inclusive)</option>
					</select>
				</label>
			</div>
		</Panel>
	);
}
