// Wrapper around the `svg_import` command: reads, inlines, and inspects an SVG file.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { invoke } from '@tauri-apps/api/core';
import type { SvgImportResult } from './types';

/** Asks the Rust side to read, inline, and inspect the SVG file at `path`. */
export function importSvg(path: string): Promise<SvgImportResult> {
	return invoke<SvgImportResult>('svg_import', { path });
}
