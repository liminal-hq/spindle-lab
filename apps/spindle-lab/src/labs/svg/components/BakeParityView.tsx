// Bake parity check: bakes the live preview's currently scrubbed frame
// through the SMIL/CSS bakers and rasterises it, so it can be compared
// directly against the live preview beside it. This is the M4 deliverable
// per docs/plan.md §6 -- "scrub anywhere, bake, and the two images agree"
// -- and the actual proof (or disproof) of the whole baking technique.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../ui/Button';
import { Panel } from '../../../ui/Panel';
import { bakeCssAtTime } from '../bake-css';
import { bakeSmilAtTime } from '../bake-smil';
import { rasteriseSvg } from '../rasterise';
import { useSvgLabStore } from '../svg-lab-store';
import { asSeekableSvgDocument, setPreviewPlaying } from '../transport';
import type { SvgImportResult } from '../types';
import './BakeParityView.css';

interface BakeParityViewProps {
	result: SvgImportResult;
	/** The sandboxed iframe's live `contentDocument`, from `SvgPreviewFrame`'s `onReady`. `null` until it first loads. */
	previewDoc: Document | null;
}

const DEFAULT_PREVIEW_DIMENSION = 400;
const MAX_PREVIEW_DIMENSION = 800;

/**
 * Picks a reasonable raster preview size for the parity check: the SVG's own
 * intrinsic size when known, else its viewBox size, else a flat default --
 * downscaled (never upscaled) so a large source SVG doesn't produce an
 * oversized canvas for what is just a visual spot-check (docs/plan.md §6's
 * "reasonable preview resolution").
 */
function choosePreviewSize(features: SvgImportResult['features']): {
	width: number;
	height: number;
} {
	const raw =
		features.intrinsicWidth != null && features.intrinsicHeight != null
			? { width: features.intrinsicWidth, height: features.intrinsicHeight }
			: features.viewBox != null
				? { width: features.viewBox[2], height: features.viewBox[3] }
				: { width: DEFAULT_PREVIEW_DIMENSION, height: DEFAULT_PREVIEW_DIMENSION };

	const scale = Math.min(1, MAX_PREVIEW_DIMENSION / Math.max(raw.width, raw.height, 1));
	return {
		width: Math.max(1, Math.round(raw.width * scale)),
		height: Math.max(1, Math.round(raw.height * scale)),
	};
}

export function BakeParityView({ result, previewDoc }: BakeParityViewProps) {
	const currentTimeSecs = useSvgLabStore((s) => s.currentTimeSecs);
	const isPlaying = useSvgLabStore((s) => s.isPlaying);
	const setPlaying = useSvgLabStore((s) => s.setPlaying);

	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [bakedAtSecs, setBakedAtSecs] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [baking, setBaking] = useState(false);
	// Mirrors `imageUrl` for revocation purposes only -- `handleBake` needs
	// the *previous* URL to revoke it, and reading state directly there would
	// risk a stale closure; the unmount cleanup below needs a ref for the
	// same reason effects can't see state from after they were set up.
	const imageUrlRef = useRef<string | null>(null);

	useEffect(() => {
		return () => {
			if (imageUrlRef.current != null) URL.revokeObjectURL(imageUrlRef.current);
		};
	}, []);

	async function handleBake() {
		if (previewDoc == null) {
			setError('Live preview is not ready yet.');
			return;
		}
		setBaking(true);
		setError(null);
		try {
			const t = currentTimeSecs;

			// Freeze the live preview at the scrubbed time before reading
			// anything off it. `bakeCssAtTime` does this itself when it runs,
			// but a SMIL-only SVG never touches the live document at all --
			// and leaving it mid-playback would make the side-by-side
			// comparison meaningless, since the live side would keep moving
			// after the baked side has already captured `t`.
			if (isPlaying) {
				setPlaying(false);
				setPreviewPlaying(asSeekableSvgDocument(previewDoc), false);
			}

			// Composition order for a mixed SVG (docs/plan.md's own worked
			// example is `mixed-smil-css.svg`): the CSS bake runs first,
			// against the live preview document, because it is the only step
			// here that reads real WAAPI/CSSOM state (`getAnimations()` /
			// `getComputedStyle()`) -- once that step is done there is no
			// live document left in the pipeline, only baked text, so it has
			// to go first if it is going to run at all. The SMIL bake is then
			// applied to the CSS-baked *text* rather than the original
			// source. This is safe, not just convenient: bake-smil.ts only
			// ever rewrites `begin`/`end`/`fill` on `<animate*>` elements and
			// never touches `style` attributes or element structure, and
			// bake-css.ts never touches `<animate*>` elements at all -- the
			// two transforms operate on entirely disjoint attributes and
			// neither adds, removes, or reorders elements. So although the
			// live-document dependency forces CSS to run first *in practice*,
			// the composition order is not actually load-bearing for
			// correctness -- running SMIL first on the original source and
			// then CSS against that intermediate text would produce the same
			// result, since the CSS bake's structural pairing only depends on
			// element order/type, which the SMIL bake never changes.
			let text = result.text;
			if (result.features.cssAnimationRuleCount > 0) {
				text = bakeCssAtTime(previewDoc, text, t);
			}
			if (result.features.smilAnimationCount > 0) {
				text = bakeSmilAtTime(text, t);
			}

			const { width, height } = choosePreviewSize(result.features);
			const blob = await rasteriseSvg(text, { width, height, background: '#ffffff' });
			const url = URL.createObjectURL(blob);

			if (imageUrlRef.current != null) URL.revokeObjectURL(imageUrlRef.current);
			imageUrlRef.current = url;
			setImageUrl(url);
			setBakedAtSecs(t);
		} catch (err) {
			setError(String(err));
		} finally {
			setBaking(false);
		}
	}

	return (
		<Panel title="Bake parity" className="bake-parity-view">
			<p className="bake-parity-view__blurb">
				Bakes the current frame through the SMIL/CSS bakers and rasterises it -- compare it against
				the live preview to check they agree.
			</p>
			<div className="bake-parity-view__controls">
				<Button variant="primary" onClick={handleBake} disabled={previewDoc == null || baking}>
					{baking ? 'Baking…' : 'Bake this frame'}
				</Button>
				<span className="bake-parity-view__readout">at {currentTimeSecs.toFixed(2)}s</span>
			</div>

			{error != null && (
				<div className="bake-parity-view__error" role="alert">
					{error}
				</div>
			)}

			<div className="bake-parity-view__result">
				{imageUrl != null ? (
					<>
						<img
							className="bake-parity-view__image"
							src={imageUrl}
							alt={`Baked frame at ${bakedAtSecs?.toFixed(2)}s`}
						/>
						<span className="bake-parity-view__caption">baked at {bakedAtSecs?.toFixed(2)}s</span>
					</>
				) : (
					<p className="bake-parity-view__placeholder">
						No baked frame yet -- scrub the preview, then bake.
					</p>
				)}
			</div>
		</Panel>
	);
}
