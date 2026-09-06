// LAB_REGISTRY — the single aggregation point for every lab in the app.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { createElement } from 'react';
import { SandboxLab } from '../labs/sandbox/SandboxLab';
import { ScratchLab } from '../labs/scratch/ScratchLab';
import type { LabDefinition } from './types';

// This file stays `.ts` (not `.tsx`) so it can be the single aggregation
// point without pulling JSX syntax into it; icons are built with
// `createElement` instead of JSX for that reason.
const stubIcon = createElement(
	'svg',
	{ viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
	createElement('rect', { x: 2, y: 2, width: 12, height: 12, rx: 2, strokeDasharray: '2 2' }),
);

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
export const LAB_REGISTRY: LabDefinition[] = [sandboxLab, scratchLab];
