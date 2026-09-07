// Sandboxed live preview of an imported SVG (docs/plan.md §4.2). Playback is
// entirely the browser's own native SMIL/CSS animation engine -- no custom
// playback logic is implemented here.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useMemo, useRef } from 'react';
import './SvgPreviewFrame.css';

interface SvgPreviewFrameProps {
	/** The already-inlined SVG text from `svg_import` -- see docs/plan.md §4.1. */
	svgText: string;
	/**
	 * Called with the iframe's `contentDocument` once it (re)loads, and with
	 * `null` on unmount. `allow-same-origin` (see below) is what makes this
	 * document reachable at all; TransportBar (M3) uses it to drive
	 * play/pause/scrub against the live SMIL and WAAPI engines.
	 */
	onReady?: (doc: Document | null) => void;
}

/**
 * Renders `svgText` inside a sandboxed iframe. `allow-same-origin` without
 * `allow-scripts` is the load-bearing security boundary here (docs/plan.md
 * §9, last risk row): the parent can still reach `iframe.contentDocument`
 * for the transport controls added in M3, but any `<script>` smuggled into
 * the imported SVG cannot execute. Do not add `allow-scripts`.
 */
export function SvgPreviewFrame({ svgText, onReady }: SvgPreviewFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);

	const srcDoc = useMemo(
		() =>
			[
				'<!doctype html>',
				'<html>',
				'<head>',
				'<style>',
				'html, body { margin: 0; height: 100%; display: flex; align-items: center; justify-content: center; background: #ffffff; }',
				// An imported SVG frequently has no width/height attribute (only a
				// viewBox, or neither -- see the "missing-sizing" warning). Giving
				// it an explicit 100% box here is load-bearing: `max-width`/
				// `max-height` alone leave a sizeless replaced element at 0x0 in
				// this flex layout, so the preview renders nothing at all.
				'svg { width: 100%; height: 100%; }',
				'</style>',
				'</head>',
				`<body>${svgText}</body>`,
				'</html>',
			].join(''),
		[svgText],
	);

	return (
		<iframe
			ref={iframeRef}
			className="svg-preview-frame"
			title="SVG preview"
			sandbox="allow-same-origin"
			srcDoc={srcDoc}
			onLoad={() => onReady?.(iframeRef.current?.contentDocument ?? null)}
		/>
	);
}
