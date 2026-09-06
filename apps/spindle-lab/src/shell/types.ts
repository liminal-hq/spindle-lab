// Types for the labs shell registry.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { ComponentType, ReactNode } from 'react';

/** One entry in the labs registry: a hash route plus the lab's root component. */
export interface LabDefinition {
	/** Hash route segment, e.g. 'svg' for '#/svg'. */
	id: string;
	/** Sidebar and topbar display name, e.g. 'SVG Lab'. */
	title: string;
	/** One line for the sidebar tooltip and the landing page's empty state. */
	blurb: string;
	/** Inline 16x16 SVG icon, matching Spindle's icon style. */
	icon: ReactNode;
	/** Sidebar badge — keeps half-built labs honest about their state. */
	status: 'active' | 'stub';
	/** The lab's page composition component. */
	Component: ComponentType;
}
