// CSS `@keyframes` baking: resolved-value inlining from docs/plan.md §4.3(b).
//
// Unlike SMIL (bake-smil.ts), there is no attribute to rewrite -- CSS
// animations never mutate DOM/style attributes either, so the fix here is
// different: read the *computed*, already-resolved value off a live, paused
// instance (WAAPI has already folded timing-function/direction/fill-mode/
// iteration maths into that value), then write it as an inline `!important`
// style onto the corresponding node in a detached clone of the original
// source text, and kill the `animation` shorthand there so it can't
// re-animate away from the value we just froze.
//
// This deliberately takes the live preview document as a parameter (rather
// than parsing its own) because CSS animations only exist as `Animation`
// objects once a browser's style/animation engine has actually run them --
// there is nothing to derive them from by parsing text alone, unlike SMIL.
// `getComputedStyle` is dependency-injected for the same reason timeline.ts
// keeps its CSS duration path DOM-only rather than trying to fake it: this
// repo's vitest environment (happy-dom) does not implement CSS-driven
// `Animation` creation or meaningful computed-style resolution for animated
// SVG presentation properties, so the unit tests below exercise the pairing
// and inlining logic against a hand-built fake `liveDoc`/`getComputedStyle`
// rather than a real animated document. Real correctness is established by
// the Playwright parity pass described in the M4 report.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { asSeekableSvgDocument, seekPreviewTo, setPreviewPlaying } from './transport';

/** The per-property keyframe keys that describe timing, not an animatable CSS property. */
const NON_PROPERTY_KEYFRAME_KEYS = new Set(['offset', 'easing', 'composite']);

/**
 * `getComputedStyle` returns a live `CSSStyleDeclaration`, which TypeScript
 * only exposes via `getPropertyValue`/named accessors for known properties
 * -- not the dynamic bracket access `computed[prop]` the plan calls for
 * (`prop` here is a runtime string from `getKeyframes()`). This narrows to
 * exactly what's needed and lets tests supply a plain object instead of a
 * real `CSSStyleDeclaration`.
 */
export type ComputedStyleLike = { [property: string]: string | undefined };
export type GetComputedStyleFn = (target: Element) => ComputedStyleLike;

const defaultGetComputedStyle: GetComputedStyleFn = (target) =>
	getComputedStyle(target) as unknown as ComputedStyleLike;

/**
 * Converts a WAAPI keyframe property name (the camelCase "IDL attribute"
 * form `getKeyframes()` returns, e.g. `backgroundColor`) to the kebab-case
 * form `CSSStyleDeclaration.setProperty` requires (`background-color`).
 * Single-word SVG presentation properties used by the fixtures (`r`,
 * `opacity`, `fill`) round-trip unchanged. The plan's §4.3(b) prose writes
 * this step as `setProperty(prop, value, 'important')` for brevity; doing
 * that literally with an unconverted camelCase name is a silent no-op on a
 * real `CSSStyleDeclaration` (`setProperty('backgroundColor', ...)` does not
 * set `background-color`), so this conversion is required for the technique
 * to actually work, not an embellishment.
 */
function toCssPropertyName(camelCase: string): string {
	return camelCase.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Every element under (and including) `root`, in document order. */
function elementsInDocumentOrder(root: Element): Element[] {
	return [root, ...Array.from(root.querySelectorAll('*'))];
}

/**
 * The minimal shape this module needs from a WAAPI `Animation`: an effect
 * with a `target` and `getKeyframes()`. Duck-typed (rather than the real
 * `Animation`/`KeyframeEffect` types) so hand-built fakes in tests don't
 * need to satisfy the full WAAPI interface -- only `anim.effect` is ever
 * read, and only `instanceof`-free duck checks are used on it below.
 */
interface LiveKeyframeEffectLike {
	target: Element | null;
	getKeyframes: () => Array<Record<string, unknown>>;
}
interface LiveAnimationLike {
	effect?: LiveKeyframeEffectLike | null;
}

function isKeyframeEffectLike(effect: unknown): effect is LiveKeyframeEffectLike {
	return effect != null && typeof (effect as LiveKeyframeEffectLike).getKeyframes === 'function';
}

/**
 * Bakes every CSS `@keyframes`/WAAPI animation running on `liveDoc` to its
 * resolved state at time `t`, per docs/plan.md §4.3(b):
 *
 * 1. Seek `liveDoc` to `t` and pause it (reusing transport.ts's own
 *    seek/pause primitives -- the same ones the transport bar uses -- so
 *    this is guaranteed to agree with what the live preview shows at `t`
 *    regardless of what state the caller left it in).
 * 2. For each `Animation` on `liveDoc`, collect the union of animated
 *    property names from its keyframes (minus `offset`/`easing`/
 *    `composite`), read each one's *computed* (i.e. already-resolved-at-t)
 *    value off the live target, and write it as an inline `!important`
 *    style onto the structurally-corresponding node in a freshly parsed
 *    clone of `sourceSvgText`, finishing with `animation: none !important`
 *    on that node so it can't drift back off the frozen value.
 *
 * Live target -> clone node pairing is a **paired index walk**: both trees
 * are structurally identical (the clone is parsed from the same source the
 * live document rendered), so the Nth element in document order on one side
 * is the Nth element in document order on the other. This is simpler and
 * more robust than trying to match by id/tag/attributes, which imported
 * SVGs are not guaranteed to have uniquely.
 */
export function bakeCssAtTime(
	liveDoc: Document,
	sourceSvgText: string,
	t: number,
	getComputedStyleFn: GetComputedStyleFn = defaultGetComputedStyle,
): string {
	const seekable = asSeekableSvgDocument(liveDoc);
	seekPreviewTo(seekable, t);
	setPreviewPlaying(seekable, false);

	const liveSvgRoot = liveDoc.querySelector('svg');
	const getAnimations = liveDoc.getAnimations?.bind(liveDoc);
	const animations = (getAnimations?.() ?? []) as unknown as LiveAnimationLike[];

	if (liveSvgRoot == null || animations.length === 0) {
		// Nothing to inline -- most likely a SMIL-only document, or one with
		// no animations at all. Return the source untouched rather than
		// paying for a pointless parse/serialise round trip.
		return sourceSvgText;
	}

	const cloneDoc = new DOMParser().parseFromString(sourceSvgText, 'image/svg+xml');
	const parserError = cloneDoc.querySelector('parsererror');
	if (parserError != null) {
		throw new Error(
			`Failed to parse SVG for CSS baking: ${parserError.textContent ?? 'unknown error'}`,
		);
	}
	const cloneSvgRoot = cloneDoc.documentElement;

	const liveElements = elementsInDocumentOrder(liveSvgRoot);
	const cloneElements = elementsInDocumentOrder(cloneSvgRoot);

	for (const anim of animations) {
		const effect = anim.effect;
		if (!isKeyframeEffectLike(effect) || effect.target == null) continue;

		const targetIndex = liveElements.indexOf(effect.target);
		if (targetIndex === -1) continue; // Not under the SVG root we paired against -- skip defensively.
		const cloneTarget = cloneElements[targetIndex];
		if (cloneTarget == null) continue;

		const propertyNames = new Set<string>();
		for (const keyframe of effect.getKeyframes()) {
			for (const key of Object.keys(keyframe)) {
				if (!NON_PROPERTY_KEYFRAME_KEYS.has(key)) propertyNames.add(key);
			}
		}
		if (propertyNames.size === 0) continue;

		const computed = getComputedStyleFn(effect.target);
		const cloneStyle = (cloneTarget as unknown as ElementCSSInlineStyle).style;
		for (const prop of propertyNames) {
			const value = computed[prop];
			if (value == null) continue;
			cloneStyle.setProperty(toCssPropertyName(prop), value, 'important');
		}
		cloneStyle.setProperty('animation', 'none', 'important');
	}

	return new XMLSerializer().serializeToString(cloneDoc);
}
