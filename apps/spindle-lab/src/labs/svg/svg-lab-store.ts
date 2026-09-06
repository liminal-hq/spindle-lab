// SVG Lab zustand store: the currently imported file and its feature report.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import { importSvg } from './import';
import type { SvgImportResult } from './types';

interface SvgLabState {
	result: SvgImportResult | null;
	loading: boolean;
	error: string | null;
	importFile: (path: string) => Promise<void>;
}

export const useSvgLabStore = create<SvgLabState>((set) => ({
	result: null,
	loading: false,
	error: null,
	importFile: async (path: string) => {
		set({ loading: true, error: null });
		try {
			const result = await importSvg(path);
			set({ result, loading: false });
		} catch (err) {
			set({ error: String(err), loading: false });
		}
	},
}));
