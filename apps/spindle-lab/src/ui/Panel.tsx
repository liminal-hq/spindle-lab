// Shared dumb panel/card primitive, lab-agnostic.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { HTMLAttributes, ReactNode } from 'react';
import './Panel.css';

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
	title?: ReactNode;
}

export function Panel({ title, children, className, ...rest }: PanelProps) {
	const classes = ['ui-panel', className].filter(Boolean).join(' ');
	return (
		<div className={classes} {...rest}>
			{title != null && <div className="ui-panel__title">{title}</div>}
			<div className="ui-panel__body">{children}</div>
		</div>
	);
}
