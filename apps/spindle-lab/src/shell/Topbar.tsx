// App-wide topbar: app name plus the active lab's title.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import './Topbar.css';

interface TopbarProps {
	activeLabTitle?: string;
}

export function Topbar({ activeLabTitle }: TopbarProps) {
	return (
		<header className="topbar">
			<span className="topbar__app-name">Spindle Lab</span>
			{activeLabTitle != null && (
				<>
					<span className="topbar__separator">/</span>
					<span className="topbar__lab-title">{activeLabTitle}</span>
				</>
			)}
		</header>
	);
}
