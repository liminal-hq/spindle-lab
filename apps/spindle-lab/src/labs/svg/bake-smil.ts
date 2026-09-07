// SMIL baking: the declarative time-shift transform from docs/plan.md §4.3(a).
//
// This is a pure text-in/text-out transform, deliberately -- it must run on
// a *detached* clone of the parsed document (the plan's own words), not the
// live preview, so it works identically in a unit test and in the real app.
// It does NOT execute SMIL itself: it rewrites `begin`/`end` attributes so
// that, when the *browser's own* SMIL engine loads the result at its native
// document time 0, every animation is frozen exactly where it would have
// been at the original target time `t`. See the module-level rationale in
// docs/plan.md §4.3 for why `XMLSerializer().serializeToString()` after
// `setCurrentTime(t)` on a live document does NOT work (SMIL keeps
// presentation state -- animVal/baseVal -- separate from DOM attributes, so
// that seek-then-serialise silently captures the t=0 document every time).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

const SMIL_ANIMATION_LOCAL_NAMES = new Set([
	'animate',
	'animateTransform',
	'animateMotion',
	'animateColor',
	'set',
]);

/**
 * Parses a single SMIL clock-value *offset* (the shape this rewrite
 * supports): a bare number (implicitly seconds), `"<n>s"`, or `"<n>ms"`.
 * Returns `null` for anything else -- syncbase (`id.end+1s`), event-based
 * (`click`, `foo.begin+1s`), wallclock (`wallclock(...)`), and repeat/
 * accesskey forms all fail this parse on purpose, which is what lets the
 * caller leave them untouched (see `shiftBeginValue` below).
 */
function parseOffsetSeconds(raw: string): number | null {
	const trimmed = raw.trim();
	const match = /^(-?\d+(?:\.\d+)?)(ms|s)?$/.exec(trimmed);
	if (match == null) return null;
	const value = Number.parseFloat(match[1]);
	if (!Number.isFinite(value)) return null;
	return match[2] === 'ms' ? value / 1000 : value;
}

/** Formats a seconds value back into a clock-value string, e.g. `-1.5s`. */
function formatSeconds(seconds: number): string {
	// Round to a sane precision so floating-point noise (e.g. 1.9999999999s)
	// does not leak into the serialised attribute.
	const rounded = Math.round(seconds * 1e6) / 1e6;
	return `${rounded}s`;
}

/**
 * Shifts one entry of a semicolon-separated `begin` (or `end`) list by `-t`.
 * Only offset-valued entries are rewritten; syncbase and event-based entries
 * are returned verbatim, per docs/plan.md §4.3(a): "a uniform shift on
 * offset values propagates correctly through them without needing to be
 * rewritten itself" -- e.g. `other.end+1s` still resolves relative to
 * `other`'s own (now-shifted) timeline.
 */
function shiftClockValueEntry(entry: string, t: number): string {
	const trimmed = entry.trim();
	const offsetSeconds = parseOffsetSeconds(trimmed);
	if (offsetSeconds == null) return entry;
	return formatSeconds(offsetSeconds - t);
}

/** Shifts every entry of a `begin`/`end` list (semicolon-separated) by `-t`. */
function shiftClockValueList(raw: string, t: number): string {
	return raw
		.split(';')
		.map((entry) => shiftClockValueEntry(entry, t))
		.join(';');
}

/**
 * A hair past document time 0. Empirically load-bearing: forcing `end="0s"`
 * exactly produces a zero-length interval sitting entirely at or before
 * document time 0 (`begin` is shifted negative), and Chromium/WebKitGTK's
 * SMIL engine drops that interval instead of freezing it -- the baked
 * output silently reverts to the SVG's unanimated base attribute values,
 * reproducing exactly the "every baked frame looks like t=0" failure mode
 * docs/plan.md §4.3 warns about, just one layer deeper than the seek-then-
 * serialise bug the plan calls out by name. Nudging `end` to a small
 * positive offset keeps the interval open for an instant after document
 * start, which every tested engine freezes correctly. The value is far
 * below one output-frame period (~33ms at 29.97fps) so it doesn't
 * meaningfully shift *which* instant gets captured.
 */
const FREEZE_EPSILON_SECONDS = 0.001;

/**
 * Bakes a single SMIL animation element in place: shifts `begin` (defaulting
 * the implicit `begin="0s"` case to just `"0s"` before shifting, since an
 * absent `begin` means "starts at document time 0"), then forces `end` to
 * `FREEZE_EPSILON_SECONDS` and `fill="freeze"` so the element is frozen just
 * after document time 0 -- which, thanks to the `begin` shift, is (within
 * `FREEZE_EPSILON_SECONDS`) exactly `t` seconds into its original active
 * interval.
 *
 * When the element already has an explicit `end`, docs/plan.md §4.3(a)
 * calls for `min(existing_end - t, 0)` (here, the epsilon rather than a
 * literal 0, for the reason above): an animation that was already scheduled
 * to end before `t` must stay ended (not get un-frozen back to life by the
 * unconditional forced `end`). An `end` list can itself contain
 * unresolvable (syncbase/event) entries; only offset-valued entries
 * contribute to the min, since only they carry an absolute meaning here.
 */
function bakeAnimationElement(el: Element, t: number): void {
	const beginAttr = el.getAttribute('begin');
	const shiftedBegin = shiftClockValueList(beginAttr ?? '0s', t);
	el.setAttribute('begin', shiftedBegin);

	const endAttr = el.getAttribute('end');
	let endSeconds = FREEZE_EPSILON_SECONDS;
	if (endAttr != null) {
		const offsetEnds = endAttr
			.split(';')
			.map((entry) => parseOffsetSeconds(entry.trim()))
			.filter((seconds): seconds is number => seconds != null)
			.map((seconds) => seconds - t);
		if (offsetEnds.length > 0) {
			endSeconds = Math.min(FREEZE_EPSILON_SECONDS, ...offsetEnds);
		}
	}
	el.setAttribute('end', formatSeconds(endSeconds));
	el.setAttribute('fill', 'freeze');
}

/**
 * Bakes every SMIL animation element in `svgText` to its frozen state at
 * time `t`, per docs/plan.md §4.3(a). Parses on a fresh `DOMParser` (this
 * runs outside any live iframe -- a detached document, exactly as the plan
 * calls for) and returns the re-serialised SVG text.
 *
 * Throws if `svgText` does not parse to a well-formed document (DOMParser
 * reports XML parse errors as an inline `<parsererror>` element rather than
 * throwing, so this checks for that explicitly and raises a real error the
 * caller can surface).
 */
export function bakeSmilAtTime(svgText: string, t: number): string {
	const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
	const parserError = doc.querySelector('parsererror');
	if (parserError != null) {
		throw new Error(
			`Failed to parse SVG for SMIL baking: ${parserError.textContent ?? 'unknown error'}`,
		);
	}

	const selector = Array.from(SMIL_ANIMATION_LOCAL_NAMES).join(', ');
	for (const el of Array.from(doc.querySelectorAll(selector))) {
		bakeAnimationElement(el, t);
	}

	return new XMLSerializer().serializeToString(doc);
}
