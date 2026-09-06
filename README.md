# Spindle Lab

Spindle Lab is a desktop laboratory app for prototyping and de-risking techniques before they land in [Spindle](https://github.com/liminal-hq/spindle), Liminal HQ's DVD/Blu-ray authoring studio. It is built with the same stack — Tauri v2, React, and Rust — so findings translate directly.

## The labs concept

A **lab** is a small, self-contained experiment: a folder of frontend code, an optional Rust module, and one entry in a registry. Each lab exists to answer a specific technical question — "can we bake an animated SVG into a video frame-accurately using only native browser APIs?" is the first one — and to leave behind a written answer in `SPEC.md` once it ships. Labs never depend on each other, and a lab that turns out not to be worth pursuing can simply be deleted without touching anything else.

The **labs shell** (`src/shell/`) is the only shared machinery: a registry, a sidebar, a topbar, a statusbar, and hash-based routing between labs. See `docs/plan.md` for the full architecture and `AGENTS.md` for the ~30-line checklist to add a new lab.

## Status

This is early scaffolding. No lab has shipped findings yet — see `SPEC.md`.

## Quickstart

```bash
pnpm install
pnpm dev          # web app only, in the browser
pnpm tauri dev    # desktop shell, opens a native window
pnpm validate     # the full CI gate — run before opening a PR
```

Requires Node 24.14.0, pnpm 10.32.1, and a Rust 1.93.0 toolchain (see `rust-toolchain.toml`). `ffmpeg`/`ffprobe` should be on `PATH` for labs that mux video; the app reports their status in the statusbar regardless.

## Layout

pnpm workspace + Cargo workspace:

- `apps/spindle-lab` — the Tauri app: React frontend in `src/`, Rust shell in `src-tauri/`
- `crates/` — empty in v1; the promotion target for a lab's Rust logic if it outgrows the app (see `docs/plan.md` §3)
- `fixtures/` — small, committed test assets used by labs and their tests
- `docs/plan.md` — the implementation plan this repo was built from

## Licence

MIT — see `LICENSE`.
