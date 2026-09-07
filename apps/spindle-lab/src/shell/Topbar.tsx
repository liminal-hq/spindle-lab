// App-wide topbar: the app's window chrome. `decorations: false` in
// tauri.conf.json turns off the native title bar, and this renders the
// replacement -- the same cross-platform window-controls pattern used by
// Spindle and Threshold (originally Threshold's), so app name plus the
// active lab's title, and native-feeling minimise/maximise/close controls
// per platform.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform } from '@tauri-apps/plugin-os';
import './Topbar.css';

// ── Window control icons (from Threshold/Spindle) ───────────────────────────

const MinimiseIcon = () => (
	<svg width="10" height="1" viewBox="0 0 10 1" fill="none">
		<path d="M0 0.5H10" stroke="currentColor" strokeWidth="1" />
	</svg>
);

const MaximiseIcon = () => (
	<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
		<rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
	</svg>
);

const RestoreIcon = () => (
	<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
		<rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
		<path d="M0.5 2.5H7.5V9.5H0.5V2.5Z" fill="transparent" stroke="currentColor" strokeWidth="1" />
	</svg>
);

const CloseIcon = () => (
	<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
		<path d="M0.5 0.5L9.5 9.5" stroke="currentColor" strokeWidth="1" />
		<path d="M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
	</svg>
);

// ── Platform-specific window controls ───────────────────────────────────────

type PlatformType = 'mac' | 'linux' | 'win';

interface WindowControlProps {
	onMinimise: () => void;
	onToggleMaximise: () => void;
	onClose: () => void;
	isMaximised?: boolean;
}

function MacControls({ onMinimise, onToggleMaximise, onClose }: WindowControlProps) {
	return (
		<div className="window-controls mac">
			<button onClick={onClose} className="control-button mac-close" title="Close" />
			<button onClick={onMinimise} className="control-button mac-minimize" title="Minimise" />
			<button onClick={onToggleMaximise} className="control-button mac-maximize" title="Maximise" />
		</div>
	);
}

function WinControls({ onMinimise, onToggleMaximise, onClose, isMaximised }: WindowControlProps) {
	return (
		<div className="window-controls win">
			<button onClick={onMinimise} className="control-button win-minimize" title="Minimise">
				<MinimiseIcon />
			</button>
			<button
				onClick={onToggleMaximise}
				className="control-button win-maximize"
				title={isMaximised ? 'Restore' : 'Maximise'}
			>
				{isMaximised ? <RestoreIcon /> : <MaximiseIcon />}
			</button>
			<button onClick={onClose} className="control-button win-close" title="Close">
				<CloseIcon />
			</button>
		</div>
	);
}

function LinuxControls({ onMinimise, onToggleMaximise, onClose, isMaximised }: WindowControlProps) {
	return (
		<div className="window-controls linux">
			<button onClick={onMinimise} className="control-button linux-minimize" title="Minimise">
				<MinimiseIcon />
			</button>
			<button
				onClick={onToggleMaximise}
				className="control-button linux-maximize"
				title={isMaximised ? 'Restore' : 'Maximise'}
			>
				{isMaximised ? <RestoreIcon /> : <MaximiseIcon />}
			</button>
			<button onClick={onClose} className="control-button linux-close" title="Close">
				<CloseIcon />
			</button>
		</div>
	);
}

// ── Main Topbar ──────────────────────────────────────────────────────────────

interface TopbarProps {
	activeLabTitle?: string;
}

export function Topbar({ activeLabTitle }: TopbarProps) {
	const [platformType, setPlatformType] = useState<PlatformType>('linux');
	const [isMaximised, setIsMaximised] = useState(false);

	const appWindow = getCurrentWindow();

	useEffect(() => {
		const os = platform();
		if (os === 'macos') setPlatformType('mac');
		else if (os === 'linux') setPlatformType('linux');
		else setPlatformType('win');

		const updateState = async () => {
			try {
				setIsMaximised(await appWindow.isMaximized());
			} catch (e) {
				console.error('Failed to check window state', e);
			}
		};

		updateState();
		const unlistenPromise = appWindow.listen('tauri://resize', updateState);
		return () => {
			unlistenPromise.then((unlisten) => unlisten());
		};
	}, []);

	const minimise = () => appWindow.minimize();
	const toggleMaximise = async () => {
		await appWindow.toggleMaximize();
		setIsMaximised(await appWindow.isMaximized());
	};
	const close = () => appWindow.close();

	const controlProps: WindowControlProps = {
		onMinimise: minimise,
		onToggleMaximise: toggleMaximise,
		onClose: close,
		isMaximised,
	};

	const TopbarContent = () => (
		<>
			<span className="topbar__app-name" data-tauri-drag-region>
				Spindle Lab
			</span>
			{activeLabTitle != null && (
				<>
					<span className="topbar__separator" data-tauri-drag-region>
						/
					</span>
					<span className="topbar__lab-title" data-tauri-drag-region>
						{activeLabTitle}
					</span>
				</>
			)}
			<div className="topbar__spacer" data-tauri-drag-region />
		</>
	);

	return (
		<header className={`topbar is-${platformType}`} data-tauri-drag-region>
			{platformType === 'mac' && (
				<>
					<MacControls {...controlProps} />
					<TopbarContent />
				</>
			)}

			{platformType === 'linux' && (
				<>
					<TopbarContent />
					<LinuxControls {...controlProps} />
				</>
			)}

			{platformType === 'win' && (
				<>
					<TopbarContent />
					<WinControls {...controlProps} />
				</>
			)}
		</header>
	);
}
