// Renders the Spindle Lab shell: chrome plus the active lab, driven by the hash route.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { Topbar } from './shell/Topbar';
import { Sidebar } from './shell/Sidebar';
import { Statusbar } from './shell/Statusbar';
import { LAB_REGISTRY } from './shell/registry';
import { navigateToLab, useHashRoute } from './shell/useHashRoute';
import { Button } from './ui/Button';
import './design-system.css';
import './App.css';

function LandingPage() {
	return (
		<div className="landing">
			<div>
				<h1>Spindle Lab</h1>
				<p>Pick a lab from the sidebar, or start one below.</p>
			</div>
			<div className="landing__lab-list">
				{LAB_REGISTRY.map((lab) => (
					<Button key={lab.id} onClick={() => navigateToLab(lab.id)}>
						{lab.title}
						{lab.status === 'stub' ? ' (stub)' : ''} — {lab.blurb}
					</Button>
				))}
			</div>
		</div>
	);
}

function App() {
	const route = useHashRoute();
	const activeLab = LAB_REGISTRY.find((lab) => lab.id === route);
	const ActiveLabComponent = activeLab?.Component;

	return (
		<div className="app-shell">
			<Topbar activeLabTitle={activeLab?.title} />
			<Sidebar currentRoute={route} />
			<main className="main-content">
				{ActiveLabComponent != null ? <ActiveLabComponent /> : <LandingPage />}
			</main>
			<Statusbar />
		</div>
	);
}

export default App;
