// Pure duration derivation and frame-time sampling for the SVG Lab timeline
// (docs/plan.md §4.5). Nothing here touches the DOM directly except reading
// attribute strings and (for CSS) calling the Web Animations API on a
// document handed in by the caller -- see the module doc comment below for
// why SMIL end-time derivation is a *static* heuristic rather than a live
// `getStartTime()`/`getSimpleDuration()` walk.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

/**
 * SMIL duration derivation: implementer's fork, per docs/plan.md §4.5.
 *
 * The plan's preferred approach is to read `getStartTime()` and
 * `getSimpleDuration()` off the live SVG animation elements -- the browser's
 * own SMIL engine has already resolved `keyTimes`/syncbase chains/etc, so
 * this is the most correct answer in a real browser.
 *
 * This project's vitest environment is `happy-dom` (see vite.config.ts's
 * `test.environment`). happy-dom's `SVGAnimationElement` (the base class for
 * `SVGAnimateElement`/`SVGAnimateTransformElement`/…) does not implement
 * `getStartTime()`/`getSimpleDuration()` at all -- not even as throwing
 * stubs, the methods are simply absent from the class -- and its
 * `SVGSVGElement.pauseAnimations()`/`unpauseAnimations()`/`setCurrentTime()`
 * are no-op stubs. A live-DOM implementation would therefore be entirely
 * unexercised by this project's test suite: it could not be unit tested at
 * all, only eyeballed through Playwright.
 *
 * So this module implements the **static heuristic exclusively**: it parses
 * `dur`/`begin`/`repeatCount`/`repeatDur` attribute strings directly. This
 * is deterministic, works identically under vitest and in a real WebKitGTK/
 * WKWebView/WebView2 preview, and covers every fixture under `fixtures/svg`
 * (all of which use plain numeric `dur`/`repeatCount` -- see
 * `smil-transform.svg`, `mixed-smil-css.svg`, etc). The known gap: syncbase
 * (`other.end+1s`) and event-based (`click.begin`) `begin` values are not
 * resolved and fall back to `begin = 0`, and unrecognised `dur` shapes are
 * treated as indefinite. Both are noted inline below; closing them would
 * mean re-implementing a chunk of the SMIL timing model, which is exactly
 * the work `getStartTime()` exists to avoid -- worth revisiting only if a
 * real-world SVG needs it.
 */

/** A rational frame rate -- never a float, so 29.97 stays exactly 30000/1001. */
export interface Fps {
	num: number;
	den: number;
}

export function fpsToFloat(fps: Fps): number {
	return fps.num / fps.den;
}

/** The plan's §4.5 rational-fps presets, film/NTSC/PAL first. */
export interface FpsPreset {
	label: string;
	fps: Fps;
}

export const FPS_PRESETS: FpsPreset[] = [
	{ label: '23.976 (24000/1001)', fps: { num: 24000, den: 1001 } },
	{ label: '24', fps: { num: 24, den: 1 } },
	{ label: '25 (PAL)', fps: { num: 25, den: 1 } },
	{ label: '29.97 (30000/1001, NTSC)', fps: { num: 30000, den: 1001 } },
	{ label: '30', fps: { num: 30, den: 1 } },
	{ label: '50', fps: { num: 50, den: 1 } },
	{ label: '59.94 (60000/1001)', fps: { num: 60000, den: 1001 } },
	{ label: '60', fps: { num: 60, den: 1 } },
];

export type LoopMode = 'seamless' | 'once';

/**
 * The outcome of deriving one animation's end time: either a finite end
 * time in seconds, or `finite: false` when the animation never ends on its
 * own (`repeatCount="indefinite"`, `iterations: Infinity`, an unresolvable
 * `dur`, …). `cycleDurationSeconds`, when known, is the length of a single
 * iteration -- used for the infinite-timeline LCM derivation below. It is
 * populated for finite entries too (their one and only "cycle") so the LCM
 * step can treat every animation uniformly.
 */
export interface AnimationEndTimeInfo {
	finite: boolean;
	endTimeSeconds?: number;
	cycleDurationSeconds?: number;
}

const SMIL_ANIMATION_LOCAL_NAMES = new Set([
	'animate',
	'animateTransform',
	'animateMotion',
	'animateColor',
	'set',
]);

/**
 * Parses a SMIL clock value string in the limited shape this heuristic
 * supports: a bare number (implicitly seconds), `"<n>s"`, or `"<n>ms"`.
 * Returns `null` for anything else (clock-value lists, `"12:00:00"`-style
 * wallclock forms, syncbase/event/repeat/accesskey values), letting the
 * caller decide the conservative fallback.
 */
function parseClockValueSeconds(raw: string): number | null {
	const trimmed = raw.trim();
	const match = /^(-?\d+(?:\.\d+)?)(ms|s)?$/.exec(trimmed);
	if (match == null) return null;
	const value = Number.parseFloat(match[1]);
	if (!Number.isFinite(value)) return null;
	return match[2] === 'ms' ? value / 1000 : value;
}

/**
 * Parses the first offset in a semicolon-separated `begin` list. SMIL
 * allows multiple begin times and syncbase/event forms; this heuristic only
 * resolves a plain leading offset and otherwise falls back to `0` (i.e.
 * "assume it starts at document begin"), which is the safest guess when the
 * real dependency graph cannot be resolved without a live SMIL engine.
 */
function parseBeginSeconds(raw: string | null): number {
	if (raw == null || raw.trim() === '') return 0;
	const first = raw.split(';')[0]?.trim() ?? '';
	const parsed = parseClockValueSeconds(first);
	return parsed ?? 0;
}

/** Derives one SMIL animation element's end-time contribution. */
function smilElementEndTime(el: Element): AnimationEndTimeInfo {
	const beginSeconds = parseBeginSeconds(el.getAttribute('begin'));

	const durAttr = el.getAttribute('dur');
	if (durAttr == null) {
		// No `dur` at all: SMIL's own default is an indefinite simple
		// duration for most elements. Conservative and simple: mark
		// infinite with no known cycle length.
		return { finite: false };
	}
	if (durAttr === 'indefinite' || durAttr === 'media') {
		return { finite: false };
	}
	const simpleDurationSeconds = parseClockValueSeconds(durAttr);
	if (simpleDurationSeconds == null || simpleDurationSeconds < 0) {
		// An unrecognised clock-value shape (e.g. wallclock or a list) --
		// cannot size it, so treat conservatively as indefinite.
		return { finite: false };
	}

	const repeatCountAttr = el.getAttribute('repeatCount');
	const repeatDurAttr = el.getAttribute('repeatDur');

	if (repeatCountAttr === 'indefinite' || repeatDurAttr === 'indefinite') {
		return { finite: false, cycleDurationSeconds: simpleDurationSeconds };
	}

	let repeatCount = 1;
	if (repeatCountAttr != null) {
		const parsed = Number.parseFloat(repeatCountAttr);
		if (Number.isFinite(parsed) && parsed > 0) repeatCount = parsed;
	}

	let activeDurationSeconds = simpleDurationSeconds * repeatCount;
	if (repeatDurAttr != null) {
		const repeatDurSeconds = parseClockValueSeconds(repeatDurAttr);
		if (repeatDurSeconds != null) {
			activeDurationSeconds = Math.min(activeDurationSeconds, repeatDurSeconds);
		}
	}

	return {
		finite: true,
		endTimeSeconds: beginSeconds + activeDurationSeconds,
		cycleDurationSeconds: activeDurationSeconds,
	};
}

/**
 * Walks every SMIL animation element under `root` (inclusive of `root`
 * itself, so a single `<animate>` fragment can be passed directly) and
 * returns one `AnimationEndTimeInfo` per element. See the module doc
 * comment above for why this is a static attribute-string heuristic rather
 * than a live `getStartTime()`/`getSimpleDuration()` walk.
 */
export function collectSmilAnimationEndTimes(
	root: ParentNode & Partial<Element>,
): AnimationEndTimeInfo[] {
	const results: AnimationEndTimeInfo[] = [];
	const rootEl = root as Partial<Element>;
	if (rootEl.localName != null && SMIL_ANIMATION_LOCAL_NAMES.has(rootEl.localName)) {
		results.push(smilElementEndTime(root as unknown as Element));
	}
	const selector = Array.from(SMIL_ANIMATION_LOCAL_NAMES).join(', ');
	for (const el of Array.from(root.querySelectorAll(selector))) {
		results.push(smilElementEndTime(el));
	}
	return results;
}

/**
 * CSS duration derivation (docs/plan.md §4.5): `document.getAnimations()` on
 * the live iframe document, reading each animation's `getComputedTiming()`.
 * Unlike the SMIL path, WAAPI is exercised against a genuinely live
 * document (the sandboxed preview iframe) rather than a detached/parsed
 * one, so there is no test-environment fallback to make here -- this
 * function is simply not unit-testable under happy-dom and is exercised
 * manually (Playwright) instead, per the M3 verification pass.
 */
export function collectCssAnimationEndTimes(doc: Document): AnimationEndTimeInfo[] {
	const getAnimations = doc.getAnimations?.bind(doc);
	if (getAnimations == null) return [];

	const results: AnimationEndTimeInfo[] = [];
	for (const anim of getAnimations()) {
		const effect = anim.effect;
		if (effect == null || typeof effect.getComputedTiming !== 'function') continue;
		const timing = effect.getComputedTiming();
		const iterations = timing.iterations ?? 1;
		const durationMs = typeof timing.duration === 'number' ? timing.duration : 0;
		const cycleDurationSeconds = durationMs / 1000;

		if (iterations === Infinity) {
			results.push({ finite: false, cycleDurationSeconds });
			continue;
		}
		const endTimeMs = typeof timing.endTime === 'number' ? timing.endTime : 0;
		results.push({
			finite: true,
			endTimeSeconds: endTimeMs / 1000,
			cycleDurationSeconds,
		});
	}
	return results;
}

function gcd(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y !== 0) {
		[x, y] = [y, x % y];
	}
	return x;
}

function lcm(a: number, b: number): number {
	if (a === 0 || b === 0) return 0;
	return (a / gcd(a, b)) * b;
}

const MAX_DERIVED_DURATION_SECONDS = 60;
const DEFAULT_DERIVED_DURATION_SECONDS = 5.0;

/**
 * The suggested duration derivation from docs/plan.md §4.5:
 *  - no animations at all -> the flat 5.0s default.
 *  - all finite -> the max end time.
 *  - any infinite -> the LCM of every determinable cycle duration
 *    (quantised to 1ms, capped at 60s); if no cycle duration is
 *    determinable at all (e.g. only an unresolvable `dur="indefinite"`),
 *    fall back to the same 5.0s default.
 */
export function deriveSuggestedDurationSeconds(infos: AnimationEndTimeInfo[]): number {
	if (infos.length === 0) return DEFAULT_DERIVED_DURATION_SECONDS;

	const anyInfinite = infos.some((info) => !info.finite);
	if (!anyInfinite) {
		const max = Math.max(...infos.map((info) => info.endTimeSeconds ?? 0));
		return max > 0 ? max : DEFAULT_DERIVED_DURATION_SECONDS;
	}

	const cycleDurationsMs = infos
		.map((info) => info.cycleDurationSeconds)
		.filter((seconds): seconds is number => seconds != null && seconds > 0)
		.map((seconds) => Math.round(seconds * 1000));

	if (cycleDurationsMs.length === 0) return DEFAULT_DERIVED_DURATION_SECONDS;

	let lcmMs = cycleDurationsMs[0];
	for (let i = 1; i < cycleDurationsMs.length; i++) {
		lcmMs = lcm(lcmMs, cycleDurationsMs[i]);
		if (lcmMs <= 0 || lcmMs > MAX_DERIVED_DURATION_SECONDS * 1000) {
			return MAX_DERIVED_DURATION_SECONDS;
		}
	}
	return Math.min(lcmMs, MAX_DERIVED_DURATION_SECONDS * 1000) / 1000;
}

/** Convenience: derives the suggested duration for a live preview document. */
export function deriveDocumentDurationSeconds(doc: Document): number {
	const smil = collectSmilAnimationEndTimes(doc.documentElement ?? doc);
	const css = collectCssAnimationEndTimes(doc);
	return deriveSuggestedDurationSeconds([...smil, ...css]);
}

/**
 * Frame-time sampling schedule (docs/plan.md §4.5). Needed by the M3
 * transport bar for frame-stepping and by the later M5 capture loop for
 * choosing the frames to bake -- both need the same `t_i <-> frame index`
 * conversion, so it lives here with the rest of the timeline math.
 */
export function computeFrameCount(durationSeconds: number, fps: Fps, loopMode: LoopMode): number {
	const rate = fpsToFloat(fps);
	if (loopMode === 'seamless') {
		return Math.round(durationSeconds * rate);
	}
	return Math.floor(durationSeconds * rate) + 1;
}

/**
 * The sample time for frame `index`, in seconds.
 *  - `'seamless'`: end-exclusive -- `t_i = i * duration / N` for `i` in
 *    `[0, N)`. Frame `N` would coincide with frame `0`, and is correctly
 *    never produced, which is what makes the loop cut clean.
 *  - `'once'`: end-inclusive -- `t_i = i * den / num` for `i` in `[0, N]`.
 */
export function frameTimeSeconds(
	index: number,
	durationSeconds: number,
	fps: Fps,
	loopMode: LoopMode,
): number {
	if (loopMode === 'seamless') {
		const count = computeFrameCount(durationSeconds, fps, loopMode);
		if (count <= 0) return 0;
		return (index * durationSeconds) / count;
	}
	return (index * fps.den) / fps.num;
}

/**
 * The inverse of `frameTimeSeconds`: the nearest frame index for a given
 * time `t`, used to keep the transport bar's frame readout and ±1-frame
 * stepping in sync with the current scrub position.
 */
export function frameIndexForTimeSeconds(
	t: number,
	durationSeconds: number,
	fps: Fps,
	loopMode: LoopMode,
): number {
	if (loopMode === 'seamless') {
		const count = computeFrameCount(durationSeconds, fps, loopMode);
		if (count <= 0 || durationSeconds <= 0) return 0;
		return Math.round((t / durationSeconds) * count);
	}
	return Math.round((t * fps.num) / fps.den);
}
