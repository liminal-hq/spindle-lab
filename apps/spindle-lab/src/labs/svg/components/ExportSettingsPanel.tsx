// Export/capture settings for the SVG Lab capture pipeline (docs/plan.md
// §4.6, M5): fps, duration, and loop mode reuse the same store state the
// transport bar already drives (docs/plan.md §4.5); resolution, background,
// codec, and loop count are specific to capture and mux (§4.7).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { effectiveDurationSecs, useSvgLabStore } from '../svg-lab-store';
import { FPS_PRESETS, type LoopMode } from '../timeline';
import type { OutputCodec } from '../types';
import { Panel } from '../../../ui/Panel';
import './ExportSettingsPanel.css';

interface ResolutionPreset {
	label: string;
	width: number;
	height: number;
}

/** Sane presets plus custom, per docs/plan.md §6's M5 description. */
const RESOLUTION_PRESETS: ResolutionPreset[] = [
	{ label: '720 × 480 (NTSC DVD)', width: 720, height: 480 },
	{ label: '720 × 576 (PAL DVD)', width: 720, height: 576 },
	{ label: '1280 × 720 (HD)', width: 1280, height: 720 },
	{ label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
	{ label: '512 × 512 (square)', width: 512, height: 512 },
];

const CUSTOM_RESOLUTION_LABEL = 'Custom…';

/**
 * Shown when `fps` doesn't match any `FPS_PRESETS` entry -- e.g. a custom
 * value set via TransportBar's own custom-fps inputs, since fps is shared
 * store state (docs/plan.md's "same fps/duration/loopMode state" design).
 * Without this fallback option, a `<select>` with no matching `<option>`
 * value silently renders its *first* option as selected instead, which
 * would misreport a custom fps as e.g. "23.976" here -- caught manually
 * while verifying M5/M6 against the real app. This panel doesn't offer its
 * own custom-fps number inputs (TransportBar already does, and duplicating
 * that editor would just be two controls fighting over one store field);
 * selecting this option is therefore a no-op.
 */
const CUSTOM_FPS_LABEL = 'Custom (set via Transport)';

const CODEC_OPTIONS: { value: OutputCodec; label: string }[] = [
	{ value: 'h264-mp4', label: 'H.264 MP4 (default)' },
	{ value: 'ffv1-mkv', label: 'Lossless FFV1 MKV' },
	{ value: 'qtrle-mov', label: 'Lossless QuickTime RLE (alpha)' },
];

export function ExportSettingsPanel() {
	const fps = useSvgLabStore((s) => s.fps);
	const setFps = useSvgLabStore((s) => s.setFps);
	const loopMode = useSvgLabStore((s) => s.loopMode);
	const setLoopMode = useSvgLabStore((s) => s.setLoopMode);
	const derivedDurationSecs = useSvgLabStore((s) => s.derivedDurationSecs);
	const durationOverrideSecs = useSvgLabStore((s) => s.durationOverrideSecs);
	const setDurationOverrideSecs = useSvgLabStore((s) => s.setDurationOverrideSecs);
	const exportWidth = useSvgLabStore((s) => s.exportWidth);
	const exportHeight = useSvgLabStore((s) => s.exportHeight);
	const setExportSize = useSvgLabStore((s) => s.setExportSize);
	const background = useSvgLabStore((s) => s.background);
	const setBackground = useSvgLabStore((s) => s.setBackground);
	const codec = useSvgLabStore((s) => s.codec);
	const setCodec = useSvgLabStore((s) => s.setCodec);
	const loopCount = useSvgLabStore((s) => s.loopCount);
	const setLoopCount = useSvgLabStore((s) => s.setLoopCount);
	const capturePhase = useSvgLabStore((s) => s.capturePhase);

	const disabled = capturePhase === 'capturing' || capturePhase === 'muxing';
	const durationSecs = effectiveDurationSecs({ derivedDurationSecs, durationOverrideSecs });

	const matchingResolution = RESOLUTION_PRESETS.find(
		(preset) => preset.width === exportWidth && preset.height === exportHeight,
	);
	const resolutionSelectValue = matchingResolution?.label ?? CUSTOM_RESOLUTION_LABEL;

	function handleResolutionPresetChange(label: string) {
		if (label === CUSTOM_RESOLUTION_LABEL) return;
		const preset = RESOLUTION_PRESETS.find((p) => p.label === label);
		if (preset != null) setExportSize(preset.width, preset.height);
	}

	const matchingFps = FPS_PRESETS.find((p) => p.fps.num === fps.num && p.fps.den === fps.den);

	return (
		<Panel title="Export settings" className="export-settings-panel">
			<div className="export-settings-panel__row">
				<label className="export-settings-panel__field">
					FPS
					<select
						value={matchingFps?.label ?? CUSTOM_FPS_LABEL}
						disabled={disabled}
						onChange={(event) => {
							const preset = FPS_PRESETS.find((p) => p.label === event.target.value);
							if (preset != null) setFps(preset.fps);
						}}
					>
						{FPS_PRESETS.map((preset) => (
							<option key={preset.label} value={preset.label}>
								{preset.label}
							</option>
						))}
						{matchingFps == null && <option value={CUSTOM_FPS_LABEL}>{CUSTOM_FPS_LABEL}</option>}
					</select>
				</label>
				<label className="export-settings-panel__field">
					Duration (s)
					<span className="export-settings-panel__badge">
						{durationOverrideSecs != null ? 'overridden' : 'derived'}
					</span>
					<input
						type="number"
						min={0.01}
						step={0.01}
						value={durationSecs}
						disabled={disabled}
						onChange={(event) => {
							const value = Number(event.target.value);
							setDurationOverrideSecs(Number.isFinite(value) && value > 0 ? value : null);
						}}
					/>
				</label>
				<label className="export-settings-panel__field">
					Loop mode
					<select
						value={loopMode}
						disabled={disabled}
						onChange={(event) => setLoopMode(event.target.value as LoopMode)}
					>
						<option value="seamless">Seamless (end-exclusive)</option>
						<option value="once">Once (end-inclusive)</option>
					</select>
				</label>
			</div>

			<div className="export-settings-panel__row">
				<label className="export-settings-panel__field">
					Resolution
					<select
						value={resolutionSelectValue}
						disabled={disabled}
						onChange={(event) => handleResolutionPresetChange(event.target.value)}
					>
						{RESOLUTION_PRESETS.map((preset) => (
							<option key={preset.label} value={preset.label}>
								{preset.label}
							</option>
						))}
						<option value={CUSTOM_RESOLUTION_LABEL}>{CUSTOM_RESOLUTION_LABEL}</option>
					</select>
				</label>
				{resolutionSelectValue === CUSTOM_RESOLUTION_LABEL && (
					<span className="export-settings-panel__custom-resolution">
						<input
							type="number"
							min={2}
							step={2}
							value={exportWidth}
							disabled={disabled}
							onChange={(event) => setExportSize(Number(event.target.value), exportHeight)}
							aria-label="Custom width"
						/>
						×
						<input
							type="number"
							min={2}
							step={2}
							value={exportHeight}
							disabled={disabled}
							onChange={(event) => setExportSize(exportWidth, Number(event.target.value))}
							aria-label="Custom height"
						/>
					</span>
				)}
			</div>

			<div className="export-settings-panel__row">
				<label className="export-settings-panel__field">
					Background
					<select
						value={background === 'transparent' ? 'transparent' : 'solid'}
						disabled={disabled}
						onChange={(event) =>
							setBackground(event.target.value === 'transparent' ? 'transparent' : '#ffffff')
						}
					>
						<option value="transparent">Transparent</option>
						<option value="solid">Solid colour</option>
					</select>
				</label>
				{background !== 'transparent' && (
					<input
						type="color"
						value={background}
						disabled={disabled}
						onChange={(event) => setBackground(event.target.value)}
						aria-label="Background colour"
					/>
				)}
			</div>

			<div className="export-settings-panel__row">
				<label className="export-settings-panel__field">
					Codec
					<select
						value={codec}
						disabled={disabled}
						onChange={(event) => setCodec(event.target.value as OutputCodec)}
					>
						{CODEC_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<label className="export-settings-panel__field">
					Loop count
					<input
						type="number"
						min={1}
						step={1}
						value={loopCount}
						disabled={disabled}
						onChange={(event) => {
							const value = Math.round(Number(event.target.value));
							setLoopCount(Number.isFinite(value) && value >= 1 ? value : 1);
						}}
					/>
				</label>
			</div>

			{background !== 'transparent' && codec === 'qtrle-mov' && (
				<p className="export-settings-panel__hint">
					QuickTime RLE preserves alpha -- pick a transparent background to actually use it.
				</p>
			)}
		</Panel>
	);
}
