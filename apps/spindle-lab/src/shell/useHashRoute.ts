// Hand-rolled hash-based router: no router library, just location.hash.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';

function readHashRoute(): string {
	// location.hash is e.g. '#/svg'; strip the leading '#/' to get 'svg'.
	return window.location.hash.replace(/^#\/?/, '');
}

/** Tracks the current hash route segment, updating on `hashchange`. */
export function useHashRoute(): string {
	const [route, setRoute] = useState(readHashRoute);

	useEffect(() => {
		const handleHashChange = () => setRoute(readHashRoute());
		window.addEventListener('hashchange', handleHashChange);
		return () => window.removeEventListener('hashchange', handleHashChange);
	}, []);

	return route;
}

/** Navigates to a lab's hash route. */
export function navigateToLab(id: string): void {
	window.location.hash = `/${id}`;
}
