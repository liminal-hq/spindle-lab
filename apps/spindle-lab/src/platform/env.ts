// Wrapper around the `lab_env_check` command: reports whether ffmpeg/ffprobe are on PATH.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { invoke } from '@tauri-apps/api/core';

export interface ToolStatus {
	found: boolean;
	path: string | null;
	version: string | null;
}

export interface EnvReport {
	ffmpeg: ToolStatus;
	ffprobe: ToolStatus;
}

/** Asks the Rust side to resolve ffmpeg/ffprobe on PATH and report their status. */
export function checkEnv(): Promise<EnvReport> {
	return invoke<EnvReport>('lab_env_check');
}
