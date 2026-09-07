// Shared dumb progress-bar primitive, lab-agnostic.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import './ProgressBar.css';

export interface ProgressBarProps {
	/** Current progress value, in the same units as `max`. */
	value: number;
	/** The value at which progress is complete. Defaults to 100 (i.e. `value` is a percent). */
	max?: number;
	/** A short label rendered above the bar, e.g. "Capturing frames 12 / 60". */
	label?: string;
}

export function ProgressBar({ value, max = 100, label }: ProgressBarProps) {
	return (
		<div className="ui-progress-bar">
			{label != null && <div className="ui-progress-bar__label">{label}</div>}
			<progress className="ui-progress-bar__track" value={value} max={max} />
		</div>
	);
}
