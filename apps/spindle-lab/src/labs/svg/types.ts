// Mirrors the Rust `svg_import` response shape (src-tauri/src/labs/svg/import.rs).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

/** A single non-fatal warning surfaced by `svg_import`. */
export interface SvgWarning {
	code: string;
	message: string;
}

/** Feature/security inspection of an imported SVG (docs/plan.md §4.1). */
export interface SvgFeatureReport {
	/** Any `<script>` element or `on*` event attribute anywhere in the tree. Blocking in the UI. */
	hasScript: boolean;
	hasForeignObject: boolean;
	externalFontFaces: string[];
	unresolvedExternalRefs: string[];
	smilAnimationCount: number;
	cssAnimationRuleCount: number;
	intrinsicWidth: number | null;
	intrinsicHeight: number | null;
	viewBox: [number, number, number, number] | null;
}

/** The result of `svg_import`: the inlined SVG text plus its feature report. */
export interface SvgImportResult {
	text: string;
	sourcePath: string;
	features: SvgFeatureReport;
	warnings: SvgWarning[];
	inlinedAssetCount: number;
}
