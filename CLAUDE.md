# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Spindle Lab is a desktop laboratory app for prototyping techniques before they land in [Spindle](https://github.com/liminal-hq/spindle), the DVD/Blu-ray authoring studio, built with Tauri v2, React, and Rust. See `AGENTS.md` for the authoritative contributor conventions — most importantly: **Canadian English** spelling everywhere; **Conventional Commits** for commit messages but **never in PR titles**; the licence/copyright header on new source files; and **no pushes unless explicitly asked**. `docs/plan.md` is the authoritative, reviewed implementation plan (repo layout, tech stack decisions, milestone list); `SPEC.md` describes what each shipped lab actually proved.

## Architecture — the labs shell

A **lab** is a registry entry plus a folder, nothing else. `src/shell/registry.ts` exports `LAB_REGISTRY`, the single aggregation point listing every `LabDefinition` (id, title, blurb, icon, `status: 'active' | 'stub'`, and the lab's root component). `App.tsx` reads the current `location.hash` via `src/shell/useHashRoute.ts`, looks the id up in the registry, and renders shared chrome (`Topbar`, `Sidebar`, `Statusbar`, all in `src/shell/`) around the active lab's component; an unknown or empty hash renders a landing page listing the labs from the registry.

Each lab owns its own zustand store, its own Rust module under `src-tauri/src/labs/<id>/`, and its own CSS — labs never import from each other. Rust commands are prefixed with the lab id (e.g. `svg_import`) and listed explicitly in `lib.rs`'s `generate_handler!`, grouped by lab with a comment banner; there is no per-lab plugin split (see `docs/plan.md` §3 for why). Shared, lab-agnostic UI primitives live in `src/ui/`; shared platform wrappers (env checks, typed event listeners) live in `src/platform/`.

## Commands

```bash
pnpm validate        # the full CI gate: format:check, lint, test:js:ci, build (tsc), cargo fmt/clippy -D warnings, cargo nextest — must pass before opening/updating a PR
pnpm test:js         # vitest only
pnpm test:rust       # cargo nextest only
pnpm dev             # web app in dev mode
pnpm tauri dev       # desktop shell
```

If host Rust tooling is unavailable, run commands in the `ghcr.io/liminal-hq/tauri-dev-desktop:latest` container against the checked-out workspace (see `AGENTS.md` → Local Tooling).

Keep this file and `AGENTS.md` in sync: when a convention changes there, update the summary here in the same PR.
