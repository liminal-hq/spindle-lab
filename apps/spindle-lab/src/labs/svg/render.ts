// Wrappers around the SVG Lab capture-session/mux commands (docs/plan.md
// §5): session lifecycle, muxing, ffprobe verification, and the Rust-side
// "Save as…" copy.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { listenTyped } from '../../platform/events';
import type {
	MuxOptions,
	ProbeReport,
	RenderProgressEvent,
	RenderRequest,
	RenderResult,
	RenderSession,
} from './types';

/** Allocates a fresh capture session directory (docs/plan.md §4.6). */
export function beginRenderSession(request: RenderRequest): Promise<RenderSession> {
	return invoke<RenderSession>('svg_render_session_begin', { request });
}

/** Requests cancellation of a session's shared flag (docs/plan.md §5). */
export function cancelRenderSession(sessionId: string): Promise<void> {
	return invoke<void>('svg_render_session_cancel', { sessionId });
}

/** Removes a session's bookkeeping and, unless `keepFrames`, its captured PNGs. */
export function cleanupRenderSession(sessionId: string, keepFrames: boolean): Promise<void> {
	return invoke<void>('svg_render_session_cleanup', { sessionId, keepFrames });
}

/** Muxes a completed capture session's PNG sequence into a video (docs/plan.md §4.7). */
export function muxRenderSession(sessionId: string, options: MuxOptions): Promise<RenderResult> {
	return invoke<RenderResult>('svg_render_session_mux', { sessionId, options });
}

/** Runs `ffprobe` against a muxed output and returns a structured report (docs/plan.md §4.8). */
export function probeOutput(path: string): Promise<ProbeReport> {
	return invoke<ProbeReport>('svg_probe_output', { path });
}

/** Copies a muxed output to a user-chosen destination ("Save as…", docs/plan.md §4.8). */
export function saveRenderAs(sourcePath: string, destPath: string): Promise<void> {
	return invoke<void>('svg_render_save_as', { sourcePath, destPath });
}

/** Typed wrapper for `spindle-lab://render-progress` (docs/plan.md §5), following `platform/events.ts`'s pattern. */
export function listenForRenderProgress(
	handler: (payload: RenderProgressEvent) => void,
): Promise<UnlistenFn> {
	return listenTyped<RenderProgressEvent>('spindle-lab://render-progress', handler);
}
