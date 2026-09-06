// Tests for the labs registry invariants.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { LAB_REGISTRY } from './registry';

describe('LAB_REGISTRY', () => {
	it('is non-empty, so multi-lab navigation has something to navigate between', () => {
		expect(LAB_REGISTRY.length).toBeGreaterThanOrEqual(2);
	});

	it('has unique ids, since ids double as hash routes', () => {
		const ids = LAB_REGISTRY.map((lab) => lab.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('gives every lab a title, blurb, icon, and component', () => {
		for (const lab of LAB_REGISTRY) {
			expect(lab.title.length).toBeGreaterThan(0);
			expect(lab.blurb.length).toBeGreaterThan(0);
			expect(lab.icon).toBeTruthy();
			expect(lab.Component).toBeTypeOf('function');
		}
	});
});
