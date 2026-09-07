// Tauri commands for the SVG Lab (docs/plan.md §5): import/inspection (M2),
// and the M5/M6 capture-session lifecycle, mux, and ffprobe verification.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::AppHandle;

use super::ffmpeg::{build_loop_command, build_mux_command, MuxOptions};
use super::import::{import_svg, SvgImportResult};
use super::probe::{probe_output, ProbeReport};
use super::session::{self, RenderRequest, RenderSession};
use crate::error::{Error, Result};
use crate::process::{run_command, run_ffmpeg_with_progress};

/// Mirrors docs/plan.md §5's `RenderResult`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    pub output_path: String,
    pub frame_count: u32,
    pub duration_secs: f64,
    pub ffmpeg_command: Vec<String>,
    pub log: String,
}

/// Reads and inspects an SVG file, inlining local raster references so the
/// returned text is a single self-contained source of truth for preview and
/// baking.
#[tauri::command]
pub fn svg_import(path: PathBuf) -> Result<SvgImportResult> {
    import_svg(&path)
}

/// Allocates a fresh capture session directory under `$APPCACHE/svg-lab/`
/// (docs/plan.md §4.6, §5). The frontend's `capture.ts` writes numbered PNGs
/// into the returned `frames_dir` itself, via `@tauri-apps/plugin-fs` -- no
/// Rust command is involved per frame.
#[tauri::command]
pub fn svg_render_session_begin(app: AppHandle, request: RenderRequest) -> Result<RenderSession> {
    session::begin_session(&app, request)
}

/// Requests cancellation of `session_id`'s shared flag (docs/plan.md §5).
/// The frontend capture loop stops on its own local state from the same user
/// action; this call is what the mux phase's ffmpeg runner checks if a
/// cancel arrives once muxing has started.
#[tauri::command]
pub fn svg_render_session_cancel(session_id: String) -> Result<()> {
    session::cancel_session(&session_id)
}

/// Removes `session_id`'s bookkeeping and, unless `keep_frames` is set, its
/// captured PNG sequence (docs/plan.md §5). Never removes an already-muxed
/// output living alongside the frames directory.
#[tauri::command]
pub fn svg_render_session_cleanup(session_id: String, keep_frames: bool) -> Result<()> {
    session::cleanup_session(&session_id, keep_frames)
}

/// Muxes a completed capture session's PNG sequence into a video, per
/// docs/plan.md §4.7/§5: builds the codec-specific ffmpeg argv, runs it with
/// streaming progress (`spindle-lab://render-progress`), and -- when
/// `loop_count > 1` -- follows up with the stream-copy loop-repetition pass.
#[tauri::command]
pub fn svg_render_session_mux(
    app: AppHandle,
    session_id: String,
    options: MuxOptions,
) -> Result<RenderResult> {
    let frames_dir = session::frames_dir(&session_id)?;
    let session_dir = session::session_dir(&session_id)?;
    let request = session::request(&session_id)?;
    let cancelled = session::cancellation_flag(&session_id)?;
    if cancelled.load(Ordering::SeqCst) {
        return Err(Error::Cancelled);
    }

    let capture_duration_secs =
        request.frame_count as f64 * request.fps_den as f64 / request.fps_num as f64;

    let output_path = options.output_path.clone().unwrap_or_else(|| {
        session_dir
            .join(format!("capture.{}", options.codec.extension()))
            .display()
            .to_string()
    });

    // Capture always produces exactly one loop's worth of frames regardless
    // of `loop_count` (docs/plan.md §4.5) -- looping is a cheap stream-copy
    // second pass over the single-loop mux, not re-encoded pixels. When
    // looping, the primary mux targets a temp file alongside the frames
    // rather than `output_path` directly.
    let single_loop_path = if options.loop_count > 1 {
        session_dir
            .join(format!("capture_loop.{}", options.codec.extension()))
            .display()
            .to_string()
    } else {
        output_path.clone()
    };

    let mux_command = build_mux_command(&frames_dir, &options, &single_loop_path);
    let mut log = run_ffmpeg_with_progress(
        &app,
        &session_id,
        "mux",
        &mux_command,
        Some(capture_duration_secs),
        &cancelled,
    )?;

    if options.loop_count > 1 {
        let loop_command = build_loop_command(&single_loop_path, options.loop_count, &output_path);
        log.push_str(&format!("\n$ {}\n", loop_command.join(" ")));
        let loop_log = run_command(&loop_command)?;
        log.push_str(&loop_log);
    }

    let duration_secs = capture_duration_secs * options.loop_count.max(1) as f64;

    Ok(RenderResult {
        output_path,
        frame_count: request.frame_count,
        duration_secs,
        ffmpeg_command: mux_command,
        log,
    })
}

/// Runs `ffprobe -show_streams -show_format` against `path` and returns a
/// small structured report (docs/plan.md §4.8, §5) -- the lab's actual
/// verification step for a mux, not decoration.
#[tauri::command]
pub fn svg_probe_output(path: String) -> Result<ProbeReport> {
    probe_output(&path)
}

/// Copies the muxed output at `source_path` to a user-chosen `dest_path`
/// (docs/plan.md §4.8's "Save as…"). A plain Rust command reading/writing
/// via `std::fs`, exactly like `svg_import` already does for an
/// arbitrary user-chosen path picked through the dialog plugin -- this
/// deliberately does not route through `@tauri-apps/plugin-fs` on the
/// frontend, since that would need a write-scope covering an arbitrary,
/// not-known-ahead-of-time destination rather than the fixed
/// `$APPCACHE/svg-lab/**` scope this lab's fs capability is deliberately
/// kept to (docs/plan.md §2's "stricter security posture").
#[tauri::command]
pub fn svg_render_save_as(source_path: String, dest_path: String) -> Result<()> {
    std::fs::copy(&source_path, &dest_path)?;
    Ok(())
}
