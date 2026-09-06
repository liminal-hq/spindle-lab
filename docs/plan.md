# spindle-lab — v1 implementation plan

## 0. Summary of the opinionated calls

| Question                  | Decision                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo shape                | pnpm workspace + Cargo workspace, `apps/spindle-lab` + `crates/` (empty in v1), mirroring Spindle rather than haptics-lab                                      |
| Lab isolation             | Folder convention only (`src/labs/<id>/` + `src-tauri/src/labs/<id>/`). No plugin crates, no per-lab packages in v1                                            |
| Routing                   | Hand-rolled registry + `location.hash`, no router library (Spindle's own `ROUTES` map precedent; its `@tanstack/react-router` dep is unused)                   |
| State                     | zustand, one store per lab + one shell store                                                                                                                   |
| SMIL seek for **capture** | Declarative time-shift bake: rewrite `begin` by `−t`, force `end="0s" fill="freeze"`. Not `setCurrentTime` + serialize (that silently captures t=0 — see §4.2) |
| CSS seek for **capture**  | Live paused instance + `getAnimations()`/`getKeyframes()` → inline resolved computed values with `!important`, then `animation: none`                          |
| Live preview              | Sandboxed `<iframe sandbox="allow-same-origin">` (no `allow-scripts`), driven by `pauseAnimations()`/`setCurrentTime()`/`getAnimations()`                      |
| Rasterisation             | Baked standalone SVG → `Blob` → `new Image()` → `await img.decode()` → `drawImage` onto a fixed-size 2D canvas                                                 |
| Frame handoff             | JS writes numbered PNGs via `@tauri-apps/plugin-fs` into a Rust-allocated session dir. No base64, no stdin piping in v1                                        |
| Mux                       | Rust `Command::new("ffmpeg")` on system PATH (Spindle precedent), image2 demuxer, `-progress pipe:2` streaming                                                 |
| JS-driven SVG             | Detected and **refused** with a clear message in v1                                                                                                            |

---

## 1. Repo / workspace layout

```
spindle-lab/
├── AGENTS.md                     # copy Spindle's conventions verbatim + lab-specific rules
├── CLAUDE.md                     # short pointer to AGENTS.md + architecture summary
├── README.md
├── SPEC.md                       # what each lab does + what it proved/disproved
├── LICENSE                       # MIT, same as Spindle
├── package.json                  # workspace root: validate/format/lint/test scripts
├── pnpm-workspace.yaml           # packages: ['apps/*', 'crates/*/guest-js'] (2nd is future-proofing)
├── Cargo.toml                    # [workspace] members = ["apps/spindle-lab/src-tauri", "crates/*"]
├── Cargo.lock
├── rust-toolchain.toml           # channel = "1.93.0", components = rustfmt, clippy
├── nextest.toml                  # [profile.ci] junit
├── tsconfig.base.json            # copy Spindle's
├── .prettierrc / .prettierignore # tabs, singleQuote, printWidth 100 (Spindle's exact config)
├── eslint.config.js              # flat config, adapted from haptics-lab-app
├── .editorconfig / .nvmrc / .node-version
├── .gitignore
├── .github/workflows/ci.yml      # ghcr.io/liminal-hq/tauri-ci-desktop:latest container jobs
├── docs/
│   ├── plan.md                   # this document
│   ├── labs-shell.md             # how to add a lab (the ~30-line checklist)
│   └── svg-lab.md                # the technique write-up — this is the deliverable for Spindle
├── fixtures/svg/                 # committed test SVGs (see §7)
├── crates/                       # empty in v1; promotion target for fat lab logic
└── apps/spindle-lab/
    ├── package.json              # @liminal-hq/spindle-lab
    ├── index.html
    ├── vite.config.ts            # copy Spindle's (port 1420, vitest happy-dom, TAURI_DEV_HOST)
    ├── tsconfig.json / tsconfig.node.json
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx               # shell only: chrome + <ActiveLab />
    │   ├── design-system.css     # lifted from Spindle so the two apps feel related
    │   ├── App.css
    │   ├── shell/
    │   │   ├── registry.ts       # LAB_REGISTRY — the single aggregation point
    │   │   ├── types.ts          # LabDefinition
    │   │   ├── Sidebar.tsx       # renders from registry
    │   │   ├── Topbar.tsx
    │   │   ├── Statusbar.tsx     # ffmpeg/ffprobe status + active job
    │   │   ├── useHashRoute.ts
    │   │   └── shell-store.ts
    │   ├── ui/                   # shared dumb primitives: Button, NumberField, Select,
    │   │                         #   ProgressBar, Panel, FileDropZone, ErrorBanner
    │   ├── platform/
    │   │   ├── env.ts            # invoke('lab_env_check')
    │   │   └── events.ts         # typed listen() wrappers
    │   ├── labs/
    │   │   └── svg/
    │   │       ├── SvgLab.tsx            # page composition
    │   │       ├── svg-lab-store.ts      # zustand
    │   │       ├── types.ts
    │   │       ├── import.ts             # invoke wrappers for svg_import
    │   │       ├── timeline.ts           # PURE: duration derivation, frame-time schedule
    │   │       ├── bake-smil.ts          # PURE: SVG text + t -> baked SVG text
    │   │       ├── bake-css.ts           # computed-style inlining (DI'd getComputedStyle)
    │   │       ├── rasterise.ts          # baked SVG -> canvas -> PNG Blob
    │   │       ├── capture.ts            # the frame loop + cancellation + fs writes
    │   │       ├── components/
    │   │       │   ├── SvgPreviewFrame.tsx   # the sandboxed iframe + transport
    │   │       │   ├── TransportBar.tsx
    │   │       │   ├── ExportSettingsPanel.tsx
    │   │       │   ├── FeatureReportPanel.tsx
    │   │       │   ├── BakeParityView.tsx    # dev affordance: live vs baked side-by-side
    │   │       │   └── ResultPanel.tsx       # <video>, ffprobe report, reveal
    │   │       └── *.test.ts
    │   └── test/setup.ts
    └── src-tauri/
        ├── Cargo.toml
        ├── build.rs
        ├── tauri.conf.json
        ├── capabilities/default.json
        ├── icons/
        └── src/
            ├── main.rs
            ├── lib.rs            # plugin registration + generate_handler!
            ├── env.rs            # lab_env_check, tool resolution (PATH only)
            ├── process.rs        # run_ffmpeg_with_progress — ported from Spindle's process.rs
            ├── error.rs
            └── labs/
                ├── mod.rs
                └── svg/
                    ├── mod.rs
                    ├── commands.rs   # the #[tauri::command]s
                    ├── import.rs     # parse/inline/inspect the SVG file
                    ├── session.rs    # session dirs, lifecycle, cancellation flag
                    ├── ffmpeg.rs     # build_mux_command(spec) -> Vec<String>  (unit-tested)
                    └── probe.rs      # ffprobe JSON
```

**Adopt from Spindle without re-deriving:** Canadian English, Conventional Commits (never in PR titles), licence headers on new `.rs`/`.ts`/`.tsx` under `src/` only, no hard-wrapped markdown, never push unless asked, `## Summary` + `## Test plan` PR bodies.

**Adopt from haptics-lab-app:** flat ESLint config, and the "no barrel files" rule — with one carve-out: `src/shell/registry.ts` is the deliberate single aggregation point.

**Root scripts** (`pnpm validate` is the gate, exactly Spindle's shape):

```jsonc
"validate": "pnpm format:check && pnpm lint && pnpm test:js:ci && pnpm build && cargo fmt --all -- --check && cargo clippy --workspace --all-targets --locked -- -D warnings && pnpm test:rust:ci"
```

---

## 2. Tech stack decisions

- **Tauri v2 + React 19 + TS 5.8 + Vite 7** — given; match Spindle's versions so the two repos stay diff-comparable.
- **zustand** for state. Matches Spindle (`store/project-store.ts`, `store/app-settings-store.ts`). One store per lab keeps labs from leaking into each other.
- **No router.** Spindle ships `@tanstack/react-router` in `package.json` but `src/` never imports it — the real pattern is a `ROUTES` record + a `currentRoute` string. Do the same, but back it with `location.hash` so dev reloads land on the same lab.
- **No SVG/animation/canvas libraries.** The whole point is to prove the native technique. Zero third-party runtime deps in the SVG Lab.
- **No video library** (no ffmpeg.wasm, no mediabunny). System `ffmpeg` on PATH, same assumption as Spindle's build pipeline. Rationale: Spindle already declares `ffmpeg` under `bundle.linux.deb.depends` and shells out with `Command::new`; if the lab's findings get promoted into Spindle, they must run against the same binary. `ffmpeg.wasm` would be a different encoder with different colour handling and would invalidate the comparison.
- **Not a sidecar.** Spindle bundles sidecars only for `dvdauthor`/`spumux`/`genisoimage`/`mkisofs` (tools with no reliable distro story) and deliberately leaves ffmpeg to the system. Copy that split. Port Spindle's `resolve_tool` idea but drop the sidecar branch — PATH lookup only.
- **Tauri plugins:** `dialog`, `fs`, `opener`, `log`, `store`, `window-state`, `persisted-scope`. Skip `shell` (Rust does the spawning), skip `os`.
- **Security posture, deliberately stricter than Spindle:** `withGlobalTauri: false` and a real CSP (Spindle uses `csp: null` + `withGlobalTauri: true`). This app ingests arbitrary third-party SVG, which is a script-execution vector, so the global `__TAURI__` handle must not exist and the preview must be sandboxed.

```jsonc
// tauri.conf.json (key parts)
"productName": "Spindle Lab",
"identifier": "ca.liminalhq.spindle-lab",
"app": {
  "withGlobalTauri": false,
  "windows": [{ "title": "Spindle Lab", "width": 1360, "height": 900, "minWidth": 1024, "minHeight": 700 }],
  "security": {
    "csp": "default-src 'self'; img-src 'self' blob: data: asset: http://asset.localhost; media-src 'self' blob: asset: http://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost",
    "assetProtocol": { "enable": true, "scope": ["$APPCACHE/**"] }
  }
},
"bundle": {
  "linux": { "deb": { "depends": ["ffmpeg"] }, "rpm": { "recommends": ["(ffmpeg or ffmpeg-free)"] } },
  "category": "Video", "publisher": "Liminal HQ",
  "copyright": "Copyright 2026 Liminal HQ, Scott Morris"
}
```

Capability additions beyond `core:default`: `dialog:default`, `store:default`, `window-state:default`, `log:default`, `opener:default`, and scoped fs writes:

```jsonc
{ "identifier": "fs:allow-write-file",  "allow": [{ "path": "$APPCACHE/svg-lab/**" }] },
{ "identifier": "fs:allow-mkdir",       "allow": [{ "path": "$APPCACHE/svg-lab/**" }] },
{ "identifier": "fs:allow-read-file",   "allow": [{ "path": "$APPCACHE/svg-lab/**" }] }
```

---

## 3. Labs shell architecture

A lab is **a registry entry plus a folder**. Nothing else.

```ts
// src/shell/types.ts
export interface LabDefinition {
	id: string; // hash route segment, e.g. 'svg'
	title: string; // 'SVG Lab'
	blurb: string; // one line for the sidebar tooltip / empty state
	icon: React.ReactNode; // inline 16x16 svg, Spindle's ICONS style
	status: 'active' | 'stub'; // sidebar badge; keeps half-built labs honest
	Component: React.ComponentType;
}

// src/shell/registry.ts — the ONLY aggregation file in the repo
export const LAB_REGISTRY: LabDefinition[] = [svgLab, sandboxLab];
```

- `App.tsx` reads `useHashRoute()` → `#/svg` → looks up the registry → renders `<Topbar>` / `<Sidebar>` / `<main><lab.Component /></main>` / `<Statusbar>`. Unknown/empty hash → a landing page listing labs from the registry. This is Spindle's `App.tsx` shape with the route table swapped for the registry.
- **Shared chrome:** Topbar (app name + active lab title + any lab-provided right-side actions via a small `<Topbar.Slot>` portal), Sidebar (registry-driven), Statusbar (ffmpeg/ffprobe presence from `lab_env_check`, plus the active long-running job's label and percent). Shared UI primitives live in `src/ui/` and are lab-agnostic.
- **Per-lab:** everything else. A lab owns its zustand store, its Rust module, and its own CSS file. Labs never import from each other.
- **Rust side:** `src-tauri/src/labs/<id>/` with a `pub fn handlers()`-style convention is not worth it under Tauri's macro; instead `lib.rs` lists commands explicitly in `generate_handler!` grouped by lab with a comment banner. Command names are prefixed with the lab id (`svg_import`, `svg_render_*`) so the flat namespace stays legible.
- **Promotion path, documented in `docs/labs-shell.md` and deliberately not built:** when a lab's Rust exceeds roughly a thousand lines or needs its own dependency set, extract it to `crates/lab-<id>/` as a **plain library crate** (not a Tauri plugin), leaving thin `#[tauri::command]` wrappers in the app. Spindle's `tauri-plugin-spindle-project` shows what the plugin route costs — `build.rs`, `permissions/*.toml`, a `guest-js` package with its own build step wired into four `pre*` scripts. That overhead is not justified for experiments.

---

## 4. SVG Lab — end-to-end data flow

### 4.1 Import

`svg_import(path)` (Rust) does more than read the file:

1. Read the file as UTF-8; reject if the root element is not `<svg>`.
2. **Inline external resources** relative to the SVG's directory: `<image href="foo.png">` and `xlink:href` → `data:image/png;base64,…`. This is mandatory, not cosmetic — see the SVG-as-image restrictions in §4.3.
3. **Inspect and report**, returning a `SvgFeatureReport`:
   - `hasScript` — any `<script>`, or any `on*` event attribute → **blocking**: "Script-driven animation is not supported in this version."
   - `hasForeignObject` → **warning**: rendering may differ or be blank when rasterised.
   - `externalFontFaces` — `@font-face` with a non-`data:` `src` → **warning**: the webfont will not load during bake; text will fall back to a system font.
   - `unresolvedExternalRefs` — anything that could not be inlined → **warning**.
   - `smilAnimationCount`, `cssAnimationRuleCount` — drives the "which engine are we exercising" badge.
   - `intrinsicWidth` / `intrinsicHeight` / `viewBox` — parsed from the root attributes; if there is no `viewBox` and no `width`/`height`, flag it (arbitrary-resolution export is impossible without one).
4. Return `{ text, sourcePath, features, warnings }`. The **inlined text** is what the frontend uses from here on, for both preview and bake — one source of truth.

Rust does this rather than JS because it needs filesystem access to sibling assets, and because it keeps the fs capability scope tight (no read permission for arbitrary user paths in the frontend).

### 4.2 Live preview and scrubbing

Render the inlined SVG text into:

```html
<iframe
	sandbox="allow-same-origin"
	srcdoc="<!doctype html><html><body style='margin:0'>…svg…</body></html>"
/>
```

- `allow-same-origin` **without** `allow-scripts`: the parent can reach `iframe.contentDocument`, but any `<script>` in a malicious SVG cannot run. This is the correct isolation boundary for arbitrary imported content, and it is why `withGlobalTauri` is off.
- Playback is the browser's own — no reimplementation, per the brief.
- Transport controls operate on `contentDocument.documentElement` (an `SVGSVGElement`):
  - Play/pause → `unpauseAnimations()` / `pauseAnimations()`, and for CSS `doc.getAnimations().forEach(a => a.play()/a.pause())`.
  - Scrub → `svg.setCurrentTime(t)` **and** `doc.getAnimations().forEach(a => { a.currentTime = t * 1000; })` (WAAPI `currentTime` is milliseconds; `setCurrentTime` is seconds — an easy off-by-1000 to get wrong).
  - Step ±1 frame → same, with `t = i / fps`.

The user's stated seek APIs are correct and this is where they belong: **the preview**.

### 4.3 The critical correction: seek-then-serialise does _not_ capture the animated state

This needs to be called out because the obvious implementation is silently wrong.

SMIL does not mutate DOM attributes — it maintains a separate presentation value (the `animVal`/`baseVal` split). Likewise, CSS animations do not write to inline style. So `XMLSerializer().serializeToString(svg)` after `setCurrentTime(2.5)` returns **the t=0 document**. Feed that to an `<img>` and you get frame zero, N times. The bug is invisible on a static-looking SVG and produces a frozen video on everything else.

Two mechanisms fix it, each chosen where it is strongest.

**(a) SMIL — declarative time shift, computed by the browser's own SMIL engine.**

For target time `t`, on a _clone_ of the parsed document:

- For each SMIL element (`animate`, `animateTransform`, `animateMotion`, `set`, `animateColor`): rewrite each **offset-valued** `begin` clock value `b` to `b − t`. Leave syncbase (`other.end+1s`) and event begins alone — they resolve relative to the already-shifted bases, so a uniform shift propagates correctly.
- Set `end="0s"` and `fill="freeze"` on every animation element (taking `min(existing_end − t, 0)` where an explicit `end` exists).
- Serialise. Load into a detached `Image`.

At document time 0 the shifted animation is exactly `t` seconds into its active interval; `end="0s" fill="freeze"` makes it hold that value permanently. The result is **time-invariant** — decode latency, paint scheduling and `<img>` animation-advance behaviour cannot affect it. Animations whose shifted `begin` is > 0 are never active, so their base values show, which is the correct semantics for "t is before this animation starts".

This delegates all the hard interpolation (`keyTimes`, `calcMode="spline"`, `values` lists, `repeatCount`, `additive`/`accumulate`, `animateMotion` along a `<path>`, `d` morphing) to the engine. Nothing is reimplemented.

**(b) CSS `@keyframes` — resolved-value inlining.**

Attribute shifting does not work for CSS, but WAAPI hands us exactly what is needed on the _live paused_ instance:

1. Seek the live iframe document to `t` and pause everything.
2. For each `anim` in `doc.getAnimations()`: `target = anim.effect.target`, and `props = new Set(anim.effect.getKeyframes().flatMap(Object.keys))` minus `offset`/`easing`/`composite`.
3. For each such property, read `getComputedStyle(target)[prop]` — the resolved value **at t**, since the animation is paused there.
4. Write it onto the corresponding node in the clone with `setProperty(prop, value, 'important')`, then `setProperty('animation', 'none', 'important')` on that node.

Clone and live tree are structurally identical, so a paired index walk pairs the nodes reliably. This is more robust than `animation-delay: −t; animation-play-state: paused` arithmetic because `timing-function`, `direction`, `fill-mode` and iteration maths are already folded into the resolved value.

`bakeSvgAtTime()` applies (a) as a pure text→text transform and (b) as a DOM transform with `getComputedStyle` injected as a parameter, which makes both independently unit-testable.

### 4.4 Rasterisation

```
baked SVG string
  → root sizing: ensure viewBox (synthesise from width/height if absent);
                 set width/height to exact export pixels;
                 preserveAspectRatio="xMidYMid meet" when aspects differ
  → new Blob([text], { type: 'image/svg+xml;charset=utf-8' })
  → URL.createObjectURL(blob)
  → img = new Image(); img.src = url; await img.decode()
  → ctx = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: false })
  → ctx.clearRect(); if background !== 'transparent' { ctx.fillStyle = bg; ctx.fillRect(...) }
  → ctx.drawImage(img, 0, 0, W, H)
  → await new Promise(r => canvas.toBlob(r, 'image/png'))
  → URL.revokeObjectURL(url)
```

Gotchas, resolved:

- **Blob URL, not data URL.** Data URLs mean base64-encoding the whole SVG per frame, and some engines cap URL length. Blob URLs are same-origin so the canvas is not tainted; revoke every frame or memory climbs.
- **`img.decode()`, not `onload`.** `onload` can fire before the image is decodable, and `drawImage` then draws nothing. `decode()` also gives a real rejection to surface as an error.
- **External refs do not load.** SVG referenced by `<img>` runs in the "SVG image" sandbox: no scripts, no external resource fetches. This is exactly why §4.1 inlines images at import — a `<image href="logo.png">` that renders perfectly in the preview will be _blank_ in the bake if not inlined. This asymmetry between preview and bake is the single most likely source of "why doesn't my video match" bugs, which is what the parity view (§6, M4) exists to catch.
- **Fonts.** System font families resolve normally in SVG-as-image. Webfonts via external `@font-face` URLs do not. v1 warns; inlining fonts as base64 is deferred.
- **`<foreignObject>`** rendering in the image sandbox is inconsistent across engines. v1 warns rather than pretending.
- **Colour space.** Canvas is sRGB; the PNGs are untagged sRGB. Tag the ffmpeg output explicitly (`-color_primaries bt709 -color_trc bt709 -colorspace bt709`) rather than leaving it unspecified, following Spindle's `dvd_colour_flags` habit. Do not rely on the player guessing.
- **Sizing.** One reusable canvas at exact export dimensions; never multiply by `devicePixelRatio`. Enforce even width/height in the UI when the target is `yuv420p`.
- **Off the DOM.** The canvas and image are never inserted into the document — no layout, no paint, no compositing cost.

### 4.5 Duration and frame rate

`timeline.ts`, pure and unit-tested:

- **SMIL end time:** over all animation elements, `max(getStartTime() + getSimpleDuration() * repeatCount)`, with `getSimpleDuration()` throwing for indefinite durations (catch it) and `repeatCount="indefinite"` marking the timeline infinite. Read from the live paused instance.
- **CSS end time:** `max(anim.effect.getComputedTiming().endTime)` in ms; `iterations === Infinity` marks it infinite.
- **Derived suggestion:**
  - All finite → suggested duration = max end time.
  - Any infinite → suggested duration = LCM of the individual finite cycle durations (quantised to 1 ms, capped at 60 s); if no finite cycle exists, default to **5.0 s**.
- The UI shows the derived value with a "derived / overridden" indicator; the user can always type a duration.
- **Frame rate** is a rational `{ num, den }`, never a float. Presets: 23.976 (24000/1001), 24, 25 (PAL), 29.97 (30000/1001, NTSC), 30, 50, 59.94, 60, plus custom. Motion-menu presets sit at the top: `NTSC DVD 720×480 @ 29.97` and `PAL DVD 720×576 @ 25`.
- **Sampling schedule:**
  - `loopMode: 'seamless'` (default) → `N = round(duration × num / den)`, `t_i = i × duration / N` for `i ∈ [0, N)`. End-exclusive, so frame N would equal frame 0 and is correctly omitted — this is what makes the loop cut clean.
  - `loopMode: 'once'` → `N = floor(duration × num / den) + 1`, `t_i = i × den / num`. End-inclusive.
- **Loop count** is a mux-stage concern, not a capture concern: capture one loop, then `ffmpeg -stream_loop (n−1) -i loop.mp4 -c copy out.mp4`. Zero extra pixels, zero extra encode time.

### 4.6 Capture loop and frame handoff

```
svg_render_session_begin(request) -> { sessionId, framesDir, framePattern }
for i in 0..N:
  if cancelled -> break
  baked = bakeSvgAtTime(liveDoc, sourceText, t_i)
  png   = await rasterise(baked, W, H, background)
  await writeFile(`${framesDir}/frame_${pad(i,6)}.png`, new Uint8Array(await png.arrayBuffer()))
  if (i % 4 === 0) await new Promise(r => requestAnimationFrame(r))   // keep the UI live
  store.setCaptureProgress(i + 1, N)
svg_render_session_mux(sessionId, muxOptions) -> RenderResult
```

**Why fs-plugin writes rather than base64-over-invoke or stdin piping:**

- Base64 over `invoke` costs ~1.37× inflation plus JSON string escaping on both sides. At 1080p PNG (~1–4 MB/frame) × 300 frames that is over a gigabyte of string churn through the IPC bridge, and it stalls the webview's main thread. Rejected.
- Raw-body `invoke` (Tauri v2 `ArrayBuffer` → `tauri::ipc::Request` with `InvokeBody::Raw`, frame index carried in a header) avoids the inflation and is the right answer if fs scoping becomes painful. Document it as the fallback; do not build it in v1.
- Piping into a long-lived `ffmpeg` stdin still moves every byte over the same IPC bridge, so it does not fix the bottleneck — it only removes the disk write, and it costs a stateful child-process handle plus a much worse failure mode. Its real benefit (no intermediate files) is a _disadvantage_ for a lab, where inspecting `frame_000042.png` is a primary debugging tool.
- Loose PNGs also let a stalled or crashed run be resumed or muxed manually from a shell, which matters when the whole point is to characterise the technique.

Expected cost at 1080p: PNG encode dominates at roughly 30–80 ms/frame, so ~150 frames is a few seconds to ~15 s. Acceptable. A "raw RGBA" fast path (`getImageData` → `.raw` files → `ffmpeg -f rawvideo -pix_fmt rgba -s WxH`) is a documented deferred optimisation — much faster, but 8.3 MB/frame at 1080p.

### 4.7 Mux

Built by a pure, unit-tested `build_mux_command(spec) -> Vec<String>`, mirroring Spindle's `build_ffmpeg_transcode_command` pattern:

```
ffmpeg -y
  -framerate 30000/1001 -start_number 0 -i <framesDir>/frame_%06d.png
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p
  -color_primaries bt709 -color_trc bt709 -colorspace bt709
  -r 30000/1001 -movflags +faststart
  <output>.mp4
```

Codec presets exposed in v1:

| Preset                 | Args                                    | Use                                                      |
| ---------------------- | --------------------------------------- | -------------------------------------------------------- |
| H.264 MP4 (default)    | as above                                | general preview / sharing                                |
| Lossless FFV1 MKV      | `-c:v ffv1 -level 3 -g 1 -pix_fmt bgr0` | intermediate for further processing                      |
| Lossless QuickTime RLE | `-c:v qtrle -pix_fmt argb`              | alpha-preserving (paired with `background: transparent`) |

`-progress pipe:2` is injected by the runner and parsed for percentage, exactly as Spindle's `run_ffmpeg_command` does. **Port `apps/../executor/process.rs` structurally** — raw-byte stderr reads with lossy UTF-8 decode, block-aligned `out_time`/`speed` pairing, cancellation checked per line, throttled event emission. That code has real bug-fix history baked into its comments; reproducing it is cheaper than rediscovering it.

Loop repetition, when `loopCount > 1`, is a second pass: `ffmpeg -y -stream_loop <n-1> -i <loop> -c copy <out>`.

### 4.8 Result

- Play in-app: `<video src={convertFileSrc(outputPath)} loop autoPlay controls>` — needs `assetProtocol.scope: ["$APPCACHE/**"]` and the `media-src` CSP entry above.
- `svg_probe_output` runs `ffprobe -v error -show_streams -show_format -of json` and the panel shows codec, dimensions, `r_frame_rate`, `nb_frames`, duration and colour tags. For a lab this is the _verification_, not decoration — it is how you prove the output is actually 29.97 and actually bt709.
- "Save as…" copies out of the cache via the dialog plugin; "Reveal" uses `tauri-plugin-opener`.
- The exact ffmpeg argv is displayed and copyable. Same reasoning.

---

## 5. IPC command surface

```rust
// env.rs
#[tauri::command] fn lab_env_check() -> EnvReport;
// EnvReport { ffmpeg: ToolStatus, ffprobe: ToolStatus }
// ToolStatus { found: bool, path: Option<String>, version: Option<String> }

// labs/svg/commands.rs
#[tauri::command] fn svg_import(path: PathBuf) -> Result<SvgImportResult, Error>;
// SvgImportResult {
//   text: String, source_path: String,
//   intrinsic_width: Option<f64>, intrinsic_height: Option<f64>, view_box: Option<[f64; 4]>,
//   features: SvgFeatureReport, warnings: Vec<SvgWarning>, inlined_asset_count: usize,
// }

#[tauri::command] fn svg_render_session_begin(request: RenderRequest) -> Result<RenderSession, Error>;
// RenderRequest  { width: u32, height: u32, frame_count: u32, fps_num: u32, fps_den: u32, label: String }
// RenderSession  { session_id: String, frames_dir: String, frame_pattern: String }

#[tauri::command] fn svg_render_session_mux(session_id: String, options: MuxOptions)
    -> Result<RenderResult, Error>;
// MuxOptions  { codec: OutputCodec, fps_num, fps_den, loop_count: u32,
//               output_path: Option<String>, crf: Option<u32> }
// RenderResult { output_path: String, frame_count: u32, duration_secs: f64,
//                ffmpeg_command: Vec<String>, log: String }

#[tauri::command] fn svg_render_session_cancel(session_id: String) -> Result<(), Error>;
#[tauri::command] fn svg_render_session_cleanup(session_id: String, keep_frames: bool) -> Result<(), Error>;
#[tauri::command] fn svg_probe_output(path: String) -> Result<ProbeReport, Error>;
```

Frame writing is **not** a command — it is `@tauri-apps/plugin-fs`'s `writeFile` against `frames_dir`.

Events:

- `spindle-lab://render-progress` — `{ sessionId, phase: 'mux', percent, message, elapsedSecs, etaSecs }`, emitted from the ffmpeg runner (Spindle's `app.emit("spindle://build-progress", …)` pattern).
- Capture-phase progress never crosses the boundary; it is set directly on the zustand store from the loop.

`Error` is a `thiserror` enum serialising to a string, matching the plugin's `error.rs`.

---

## 6. Milestones

Each stage ends with something demoable and a green `pnpm validate`.

**M0 — Scaffold.** Workspace files, both toolchains pinned, prettier/eslint/tsconfig, `pnpm validate`, CI workflow against `ghcr.io/liminal-hq/tauri-ci-desktop:latest`, `AGENTS.md`/`CLAUDE.md`/`README.md`/`LICENSE`, licence headers.
_Demo:_ `pnpm validate` passes; `pnpm tauri dev` opens an empty window.

**M1 — Labs shell.** Registry, sidebar, topbar, statusbar, hash routing, landing page, `lab_env_check`, a `sandbox` stub lab so multi-lab navigation is real from day one.
_Demo:_ switch between two labs; statusbar shows ffmpeg found/missing with the resolved path and version.

**M2 — Import + live preview.** `svg_import` with resource inlining and the feature report; sandboxed iframe preview; `FeatureReportPanel` surfacing warnings; script-bearing SVGs blocked with a clear message.
_Demo:_ open a SMIL SVG and a CSS SVG from `fixtures/`, both animate; open a scripted one and get a refusal, not a broken export.

**M3 — Timeline + transport.** Duration derivation for both engines, `TransportBar` with play/pause/scrub/step, current-time readout in seconds and frames, fps selector.
_Demo:_ frame-step through an animation; the derived duration matches what the SVG actually does.

**M4 — Baker + parity view.** `bake-smil.ts`, `bake-css.ts`, `rasterise.ts`, with vitest fixtures for the pure transforms. `BakeParityView`: a "Bake this frame" button showing the rasterised PNG beside the live preview at the same `t`.
_Demo:_ scrub anywhere, bake, and the two images agree. **This is the milestone that proves or kills the whole technique** — the external-ref and font asymmetries from §4.4 show up here or nowhere.

**M5 — Capture.** `ExportSettingsPanel` (fps, duration, resolution + presets, loop mode, background), session begin, the frame loop with progress and cancel, frames on disk.
_Demo:_ capture produces N correctly-numbered PNGs; open the folder and flick through them.

**M6 — Mux + result.** `build_mux_command` with Rust unit tests, the ported ffmpeg runner with streaming progress, `svg_probe_output`, `ResultPanel` with in-app playback, argv display, save/reveal, cleanup.
_Demo:_ SVG in, MP4 out, looping in the app, with ffprobe confirming the frame rate.

**M7 — Polish + findings.** Settings persistence via the store plugin, loop-count second pass, lossless/alpha presets, error surfaces, and `docs/svg-lab.md` written up as the actual answer to "should Spindle do this?" — with measurements, failure modes and a recommendation.
_Demo:_ a DVD-preset bake at 720×480 @ 29.97 that a motion-menu pipeline could consume.

---

## 7. Fixtures

Commit small hand-written SVGs under `fixtures/svg/`, one per mechanism, since they are the test corpus for M4 and the demo material throughout:

`smil-transform.svg` (`animateTransform` rotate, infinite) · `smil-values.svg` (`values`/`keyTimes`/`calcMode="spline"`) · `smil-motion.svg` (`animateMotion` along a path) · `smil-path-morph.svg` (`attributeName="d"`) · `css-keyframes.svg` (`@keyframes` in an internal `<style>`) · `mixed-smil-css.svg` · `external-image.svg` (with a sibling PNG — exercises the inlining path) · `foreign-object.svg` (warning path) · `scripted.svg` (refusal path) · `no-viewbox.svg` (sizing error path).

---

## 8. MVP vs deferred

**In v1:**

- Labs shell with registry, sidebar navigation, hash routing, env status.
- SVG import with external-image inlining and a feature/warning report.
- Sandboxed live preview with native playback, pause, scrub, frame-step.
- Duration derivation for SMIL and CSS; rational fps with NTSC/PAL/film presets; seamless vs once loop sampling.
- Frame baking for **SMIL** (declarative time shift) and **CSS `@keyframes`** (resolved-value inlining).
- Canvas rasterisation at arbitrary resolution with transparent or solid background.
- PNG sequence capture to a session directory via the fs plugin, with progress and cancel.
- ffmpeg mux to H.264 MP4, FFV1 MKV, or QuickTime RLE, with streaming progress and the argv on screen.
- In-app playback of the result, ffprobe verification, save/reveal, session cleanup.
- `pnpm validate` gate: prettier, eslint, tsc, vitest, cargo fmt, clippy `-D warnings`, nextest.

**Explicitly deferred:**

- **JS-driven SVGs.** Detected and refused. A real-time `requestAnimationFrame` capture path is a materially different pipeline (non-deterministic, drops frames, needs a scripted iframe which reopens the security question). It is v2, if the demand appears.
- **Webfont inlining** (`@font-face` → base64) — warned about, not fixed.
- **`<foreignObject>`** — warned about, not supported.
- **Alpha end-to-end for compositing** — QuickTime RLE output exists, but there is no alpha-aware preview, no premultiplication handling, and no ProRes 4444.
- **MPEG-2 / DVD-legal output.** The obvious next step for Spindle relevance, and a natural v1.1 once M6 works: reuse Spindle's raster/SAR/colour-flag logic.
- **Audio bed** on the exported clip.
- **Batch processing** and CLI-mode rendering.
- **Raw RGBA fast capture path**, and raw-body-`invoke` frame handoff.
- **Native webview snapshot capture** (WebKitGTK `get_snapshot` / WKWebView `takeSnapshot` / WebView2 `CapturePreview`) as an alternative rasteriser — only worth building if M4's parity check fails in a way the baker cannot fix.
- **Promoting a lab to `crates/`** and any Tauri-plugin split.

---

## 9. Risks

| Risk                                                                                   | Mitigation                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seek-then-serialise silently captures t=0                                              | Addressed by design (§4.3); M4's parity view is the check that catches any regression                                                                                           |
| SMIL `end="0s" fill="freeze"` semantics differ across WebKitGTK / WKWebView / WebView2 | M4 fixture suite covers each SMIL construct; the parity view makes divergence visible immediately. If one engine misbehaves, the native-snapshot rasteriser is the escape hatch |
| External refs render in preview but vanish in the bake                                 | Inlined at import (§4.1) and warned about when un-inlinable; parity view surfaces the rest                                                                                      |
| PNG encode throughput                                                                  | Accept for v1 (seconds, not minutes); raw RGBA path documented as the optimisation                                                                                              |
| ffmpeg absent on the host                                                              | `lab_env_check` in the statusbar from M1; export disabled with an explanatory message rather than a spawn failure                                                               |
| ffmpeg absent in CI                                                                    | Unit-test `build_mux_command`'s argv only; any test that actually spawns ffmpeg is `#[ignore]`d                                                                                 |
| Arbitrary SVG as a script vector                                                       | `withGlobalTauri: false`, explicit CSP, sandboxed iframe without `allow-scripts`, script detection refuses at import                                                            |

---

### Critical files for implementation

Reference files in the sibling repos that the implementation should be read against:

- `/home/scott/source/liminal-hq/spindle/plugins/tauri-plugin-spindle-project/src/build/executor/process.rs` — the ffmpeg runner to port structurally (progress parsing, cancellation, lossy stderr decode)
- `/home/scott/source/liminal-hq/spindle/plugins/tauri-plugin-spindle-project/src/build/ffmpeg.rs` — the `build_*_command(...) -> Vec<String>` pattern and colour/rate flag conventions
- `/home/scott/source/liminal-hq/spindle/apps/spindle/src-tauri/tauri.conf.json` — bundle/ffmpeg-dependency, assetProtocol scope, and the security posture to tighten from
- `/home/scott/source/liminal-hq/spindle/apps/spindle/src/App.tsx` and `/home/scott/source/liminal-hq/spindle/apps/spindle/src/components/Sidebar.tsx` — the shell/route-table/sidebar pattern the labs registry replaces
- `/home/scott/source/liminal-hq/spindle/AGENTS.md` and `/home/scott/source/liminal-hq/spindle/package.json` — the conventions and the `pnpm validate` gate to reproduce
</content>
