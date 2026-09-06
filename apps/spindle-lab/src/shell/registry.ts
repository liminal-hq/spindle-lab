// LAB_REGISTRY — the single aggregation point for every lab in the app.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { createElement } from 'react';
import { SandboxLab } from '../labs/sandbox/SandboxLab';
import { ScratchLab } from '../labs/scratch/ScratchLab';
import { SvgLab } from '../labs/svg/SvgLab';
import type { LabDefinition } from './types';

// This file stays `.ts` (not `.tsx`) so it can be the single aggregation
// point without pulling JSX syntax into it; icons are built with
// `createElement` instead of JSX for that reason.
const stubIcon = createElement(
	'svg',
	{ viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
	createElement('rect', { x: 2, y: 2, width: 12, height: 12, rx: 2, strokeDasharray: '2 2' }),
);

const svgIcon = createElement(
	'svg',
	{ viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
	createElement('path', { d: 'M2 12.5V3.5a1 1 0 0 1 1-1h6l4 4v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z' }),
	createElement('path', { d: 'M9 2.5V6a1 1 0 0 0 1 1h3.5' }),
);

const svgLab: LabDefinition = {
	id: 'svg',
	title: 'SVG Lab',
	blurb: 'Imports an SVG, inspects it, and previews SMIL/CSS animation in a sandboxed iframe.',
	icon: svgIcon,
	status: 'active',
	Component: SvgLab,
};

const sandboxLab: LabDefinition = {
	id: 'sandbox',
	title: 'Sandbox',
	blurb: 'Proves the labs shell can host and switch between multiple labs.',
	icon: stubIcon,
	status: 'stub',
	Component: SandboxLab,
};

const scratchLab: LabDefinition = {
	id: 'scratch',
	title: 'Scratch Lab',
	blurb: 'Reserved for a future experiment.',
	icon: stubIcon,
	status: 'stub',
	Component: ScratchLab,
};

/** Every lab registered in the app. Labs never import from each other — this file is the join point. */
export const LAB_REGISTRY: LabDefinition[] = [svgLab, sandboxLab, scratchLab];
