// Typed wrapper around Tauri's event listener API.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Subscribes to a backend event with a typed payload.
 *
 * Returns the same unlisten-promise shape as `@tauri-apps/api/event`'s `listen`,
 * so callers can `unlisten.then((fn) => fn())` in a `useEffect` cleanup.
 */
export function listenTyped<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
	return listen<T>(event, (e) => handler(e.payload));
}
