// Registry-driven sidebar navigation between labs.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { LAB_REGISTRY } from './registry';
import { navigateToLab } from './useHashRoute';
import './Sidebar.css';

interface SidebarProps {
	currentRoute: string;
}

export function Sidebar({ currentRoute }: SidebarProps) {
	return (
		<nav className="sidebar">
			<div className="sidebar__section">
				<div className="sidebar__label">Labs</div>
				{LAB_REGISTRY.map((lab) => (
					<button
						key={lab.id}
						className={`sidebar__item ${currentRoute === lab.id ? 'sidebar__item--active' : ''}`}
						onClick={() => navigateToLab(lab.id)}
						title={lab.blurb}
					>
						<span className="sidebar__item__icon">{lab.icon}</span>
						{lab.title}
						{lab.status === 'stub' && <span className="sidebar__item__badge">stub</span>}
					</button>
				))}
			</div>
		</nav>
	);
}
