// App-wide statusbar: ffmpeg/ffprobe presence from `lab_env_check`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect } from 'react';
import { useShellStore } from './shell-store';
import type { ToolStatus } from '../platform/env';
import './Statusbar.css';

function toolLabel(name: string, status: ToolStatus): string {
	if (!status.found) {
		return `${name}: not found`;
	}
	return status.version != null ? `${name}: ${status.version}` : `${name}: found`;
}

export function Statusbar() {
	const envReport = useShellStore((s) => s.envReport);
	const envLoading = useShellStore((s) => s.envLoading);
	const envError = useShellStore((s) => s.envError);
	const refreshEnv = useShellStore((s) => s.refreshEnv);

	useEffect(() => {
		refreshEnv();
	}, [refreshEnv]);

	return (
		<footer className="statusbar">
			{envLoading && <span className="statusbar__item">Checking environment…</span>}
			{envError != null && (
				<span className="statusbar__item statusbar__item--error">{envError}</span>
			)}
			{envReport != null && (
				<>
					<span
						className={`statusbar__item ${envReport.ffmpeg.found ? '' : 'statusbar__item--warning'}`}
						title={envReport.ffmpeg.path ?? undefined}
					>
						{toolLabel('ffmpeg', envReport.ffmpeg)}
					</span>
					<span
						className={`statusbar__item ${envReport.ffprobe.found ? '' : 'statusbar__item--warning'}`}
						title={envReport.ffprobe.path ?? undefined}
					>
						{toolLabel('ffprobe', envReport.ffprobe)}
					</span>
				</>
			)}
		</footer>
	);
}
