// Export/capture settings for the SVG Lab capture pipeline (docs/plan.md
// §4.6, M5): fps, duration, and loop mode reuse the same store state the
// transport bar already drives (docs/plan.md §4.5); resolution, background,
// codec, and loop count are specific to capture and mux (§4.7).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { dvdCaptureGuardMessage } from '../dvd';
import type { FitMode } from '../rasterise';
import { effectiveDurationSecs, useSvgLabStore } from '../svg-lab-store';
import { FPS_PRESETS, type Fps, type LoopMode } from '../timeline';
import type { AspectRatio, OutputCodec } from '../types';
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
	{ value: 'mpeg2-dvd', label: 'MPEG-2 (DVD-legal)' },
];

/**
 * One-action shortcuts for a coherent resolution+fps+codec+aspect+fitMode
 * combination, per docs/plan.md's DVD MPEG-2 section -- rather than making
 * the user manually coordinate several independent fields into a
 * DVD-legal set. Follows the same preset-vs-custom pattern as
 * `RESOLUTION_PRESETS`/`FPS_PRESETS` above: selecting one sets every field
 * in one action, but the manual fields underneath remain fully editable and
 * the select falls back to "Custom" the moment any field is edited away
 * from a match.
 */
interface ExportPreset {
	label: string;
	width: number;
	height: number;
	fps: Fps;
	codec: OutputCodec;
	aspectRatio: AspectRatio | null;
	fitMode: FitMode;
}

const EXPORT_PRESETS: ExportPreset[] = [
	{
		label: 'DVD NTSC (720×480, MPEG-2)',
		width: 720,
		height: 480,
		fps: { num: 30000, den: 1001 },
		codec: 'mpeg2-dvd',
		aspectRatio: 'four-three',
		fitMode: 'fit',
	},
	{
		label: 'DVD NTSC Widescreen (720×480, MPEG-2, 16:9)',
		width: 720,
		height: 480,
		fps: { num: 30000, den: 1001 },
		codec: 'mpeg2-dvd',
		aspectRatio: 'sixteen-nine',
		fitMode: 'fit',
	},
	{
		label: 'DVD PAL (720×576, MPEG-2)',
		width: 720,
		height: 576,
		fps: { num: 25, den: 1 },
		codec: 'mpeg2-dvd',
		aspectRatio: 'four-three',
		fitMode: 'fit',
	},
	{
		label: 'DVD PAL Widescreen (720×576, MPEG-2, 16:9)',
		width: 720,
		height: 576,
		fps: { num: 25, den: 1 },
		codec: 'mpeg2-dvd',
		aspectRatio: 'sixteen-nine',
		fitMode: 'fit',
	},
	{
		label: 'Web (H.264 MP4)',
		width: 1920,
		height: 1080,
		fps: { num: 30, den: 1 },
		codec: 'h264-mp4',
		aspectRatio: null,
		fitMode: 'fit',
	},
];

const CUSTOM_EXPORT_PRESET_LABEL = 'Custom';

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
	const fitMode = useSvgLabStore((s) => s.fitMode);
	const setFitMode = useSvgLabStore((s) => s.setFitMode);
	const aspectRatio = useSvgLabStore((s) => s.aspectRatio);
	const setAspectRatio = useSvgLabStore((s) => s.setAspectRatio);
	const applyExportPreset = useSvgLabStore((s) => s.applyExportPreset);
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

	const matchingExportPreset = EXPORT_PRESETS.find(
		(preset) =>
			preset.width === exportWidth &&
			preset.height === exportHeight &&
			preset.fps.num === fps.num &&
			preset.fps.den === fps.den &&
			preset.codec === codec &&
			preset.aspectRatio === aspectRatio &&
			preset.fitMode === fitMode,
	);
	const exportPresetSelectValue = matchingExportPreset?.label ?? CUSTOM_EXPORT_PRESET_LABEL;

	function handleExportPresetChange(label: string) {
		if (label === CUSTOM_EXPORT_PRESET_LABEL) return;
		const preset = EXPORT_PRESETS.find((p) => p.label === label);
		if (preset != null) applyExportPreset(preset);
	}

	const dvdGuardMessage = dvdCaptureGuardMessage(codec, exportWidth, exportHeight, fps);

	return (
		<Panel title="Export settings" className="export-settings-panel">
			<div className="export-settings-panel__row">
				<label className="export-settings-panel__field">
					Export preset
					<select
						value={exportPresetSelectValue}
						disabled={disabled}
						onChange={(event) => handleExportPresetChange(event.target.value)}
					>
						{EXPORT_PRESETS.map((preset) => (
							<option key={preset.label} value={preset.label}>
								{preset.label}
							</option>
						))}
						<option value={CUSTOM_EXPORT_PRESET_LABEL}>{CUSTOM_EXPORT_PRESET_LABEL}</option>
					</select>
				</label>
			</div>

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
					Fit
					<select
						value={fitMode}
						disabled={disabled}
						onChange={(event) => setFitMode(event.target.value as FitMode)}
					>
						<option value="fit">Fit (letterbox, undistorted)</option>
						<option value="fill">Fill (cover, crops, undistorted)</option>
						<option value="stretch">Stretch (fill, may distort)</option>
					</select>
				</label>
				<label className="export-settings-panel__field">
					Aspect ratio
					<select
						value={aspectRatio ?? 'source'}
						disabled={disabled}
						onChange={(event) =>
							setAspectRatio(
								event.target.value === 'source' ? null : (event.target.value as AspectRatio),
							)
						}
					>
						<option value="source">Source (no forced DAR)</option>
						<option value="four-three">4:3</option>
						<option value="sixteen-nine">16:9 (anamorphic widescreen)</option>
					</select>
				</label>
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
			{dvdGuardMessage != null && (
				<p className="export-settings-panel__hint export-settings-panel__hint--error" role="alert">
					{dvdGuardMessage} Capture is disabled until the resolution and FPS match.
				</p>
			)}
		</Panel>
	);
}
