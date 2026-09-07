// The SVG Lab: import + inspection (docs/plan.md §4.1), plus the M5/M6
// capture-session lifecycle, mux command construction, and ffprobe
// verification (§4.6-§4.8).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

pub mod commands;
mod ffmpeg;
#[cfg(test)]
mod fixture_tests;
mod import;
mod probe;
mod session;
