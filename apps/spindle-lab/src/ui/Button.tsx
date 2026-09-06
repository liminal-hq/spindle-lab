// Shared dumb button primitive, lab-agnostic.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'primary' | 'secondary';
}

export function Button({ variant = 'secondary', className, ...rest }: ButtonProps) {
	const classes = ['ui-button', `ui-button--${variant}`, className].filter(Boolean).join(' ');
	return <button className={classes} {...rest} />;
}
