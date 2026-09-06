// Shell-wide zustand store: environment status shown in the statusbar.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import { checkEnv, type EnvReport } from '../platform/env';

interface ShellState {
	envReport: EnvReport | null;
	envLoading: boolean;
	envError: string | null;
	refreshEnv: () => Promise<void>;
}

export const useShellStore = create<ShellState>((set) => ({
	envReport: null,
	envLoading: false,
	envError: null,
	refreshEnv: async () => {
		set({ envLoading: true, envError: null });
		try {
			const envReport = await checkEnv();
			set({ envReport, envLoading: false });
		} catch (err) {
			set({ envError: String(err), envLoading: false });
		}
	},
}));
