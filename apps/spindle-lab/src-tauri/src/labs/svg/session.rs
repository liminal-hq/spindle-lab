// Session directory lifecycle for the SVG Lab capture/mux pipeline
// (docs/plan.md §4.6, §5): allocates a per-session frames directory under
// the OS cache dir, tracks a cancellation flag shared across the capture
// (frontend loop, cancelled via `svg_render_session_cancel`) and mux (this
// process's ffmpeg runner) phases, and cleans up afterwards.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// The frame filename pattern handed to both the frontend capture loop
/// (`capture.ts`'s `frameFileName`) and ffmpeg's image2 demuxer
/// (`ffmpeg.rs`'s `build_mux_command`) -- 6-digit zero-padded, per
/// docs/plan.md §4.6/§4.7.
pub const FRAME_PATTERN: &str = "frame_%06d.png";

/// Mirrors docs/plan.md §5's `RenderRequest`. `width`/`height` describe the
/// export raster (consumed by the frontend's own rasteriser, not by Rust);
/// this module only needs `frame_count`/`fps_num`/`fps_den` to compute the
/// capture's expected duration for mux progress percentages.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    // Round-tripped for the frontend's own use (the export raster it
    // rasterises to, and a human-readable session label) but not read on
    // the Rust side -- kept on the struct so both sides share the one
    // `RenderRequest` shape from docs/plan.md §5's IPC surface.
    #[allow(dead_code)]
    pub width: u32,
    #[allow(dead_code)]
    pub height: u32,
    pub frame_count: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    #[allow(dead_code)]
    pub label: String,
}

/// Mirrors docs/plan.md §5's `RenderSession`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSession {
    pub session_id: String,
    pub frames_dir: String,
    pub frame_pattern: String,
}

struct SessionEntry {
    /// The session's own directory (`frames_dir`'s parent) -- where the
    /// muxed output lands by default, so it survives a frames-only cleanup.
    dir: PathBuf,
    frames_dir: PathBuf,
    request: RenderRequest,
    cancelled: Arc<AtomicBool>,
}

fn registry() -> &'static Mutex<HashMap<String, SessionEntry>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, SessionEntry>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn generate_session_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}-{}", std::process::id())
}

/// Allocates a fresh session directory under
/// `$APPCACHE/svg-lab/<session-id>/frames/` and registers a cancellation
/// flag for it.
pub fn begin_session(app: &AppHandle, request: RenderRequest) -> Result<RenderSession> {
    let cache_dir = app.path().app_cache_dir()?;
    let session_id = generate_session_id();
    let dir = cache_dir.join("svg-lab").join(&session_id);
    let frames_dir = dir.join("frames");
    fs::create_dir_all(&frames_dir)?;

    let session = RenderSession {
        session_id: session_id.clone(),
        frames_dir: frames_dir.display().to_string(),
        frame_pattern: FRAME_PATTERN.to_string(),
    };

    registry().lock().unwrap().insert(
        session_id,
        SessionEntry {
            dir,
            frames_dir,
            request,
            cancelled: Arc::new(AtomicBool::new(false)),
        },
    );

    Ok(session)
}

/// Sets the shared cancellation flag for `session_id`. Checked by the mux
/// phase's ffmpeg runner between stderr lines; the frontend capture loop
/// stops on the very same user action from its own local state, since the
/// capture loop never crosses back into Rust between frames (docs/plan.md
/// §5: "Capture-phase progress never crosses the boundary").
pub fn cancel_session(session_id: &str) -> Result<()> {
    let registry = registry().lock().unwrap();
    let entry = registry
        .get(session_id)
        .ok_or_else(|| Error::SessionNotFound(session_id.to_string()))?;
    entry.cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

/// Removes the session's bookkeeping and, unless `keep_frames` is set, its
/// on-disk frame directory -- but never the session directory itself, so a
/// muxed output already written there (the default `svg_render_session_mux`
/// output location) survives a frames-only cleanup.
pub fn cleanup_session(session_id: &str, keep_frames: bool) -> Result<()> {
    let entry = registry()
        .lock()
        .unwrap()
        .remove(session_id)
        .ok_or_else(|| Error::SessionNotFound(session_id.to_string()))?;
    if !keep_frames {
        let _ = fs::remove_dir_all(&entry.frames_dir);
    }
    Ok(())
}

pub fn frames_dir(session_id: &str) -> Result<PathBuf> {
    let registry = registry().lock().unwrap();
    registry
        .get(session_id)
        .map(|entry| entry.frames_dir.clone())
        .ok_or_else(|| Error::SessionNotFound(session_id.to_string()))
}

pub fn session_dir(session_id: &str) -> Result<PathBuf> {
    let registry = registry().lock().unwrap();
    registry
        .get(session_id)
        .map(|entry| entry.dir.clone())
        .ok_or_else(|| Error::SessionNotFound(session_id.to_string()))
}

pub fn request(session_id: &str) -> Result<RenderRequest> {
    let registry = registry().lock().unwrap();
    registry
        .get(session_id)
        .map(|entry| entry.request.clone())
        .ok_or_else(|| Error::SessionNotFound(session_id.to_string()))
}

pub fn cancellation_flag(session_id: &str) -> Result<Arc<AtomicBool>> {
    let registry = registry().lock().unwrap();
    registry
        .get(session_id)
        .map(|entry| entry.cancelled.clone())
        .ok_or_else(|| Error::SessionNotFound(session_id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_request() -> RenderRequest {
        RenderRequest {
            width: 10,
            height: 10,
            frame_count: 1,
            fps_num: 30,
            fps_den: 1,
            label: "test".to_string(),
        }
    }

    /// Seeds the registry directly, bypassing `begin_session` (which needs a
    /// live `AppHandle` to resolve `$APPCACHE` -- not constructible outside
    /// a running Tauri app, so that half is verified manually via the
    /// Playwright + `pnpm tauri dev` pass instead). Every test uses its own
    /// `generate_session_id()`-derived id so the shared static registry
    /// never collides across tests.
    fn seed(session_id: &str) {
        registry().lock().unwrap().insert(
            session_id.to_string(),
            SessionEntry {
                dir: PathBuf::from("/tmp/spindle-lab-session-test").join(session_id),
                frames_dir: PathBuf::from("/tmp/spindle-lab-session-test")
                    .join(session_id)
                    .join("frames"),
                request: test_request(),
                cancelled: Arc::new(AtomicBool::new(false)),
            },
        );
    }

    #[test]
    fn generate_session_id_is_unique() {
        let a = generate_session_id();
        let b = generate_session_id();
        assert_ne!(a, b);
    }

    #[test]
    fn cancel_session_sets_the_shared_flag() {
        let id = format!("cancel-{}", generate_session_id());
        seed(&id);

        let flag = cancellation_flag(&id).unwrap();
        assert!(!flag.load(Ordering::SeqCst));

        cancel_session(&id).unwrap();
        assert!(
            flag.load(Ordering::SeqCst),
            "cancel_session should set the flag cancellation_flag() sees"
        );

        cleanup_session(&id, true).unwrap();
    }

    #[test]
    fn cancel_session_on_unknown_id_errors() {
        assert!(matches!(
            cancel_session("definitely-not-a-real-session-id"),
            Err(Error::SessionNotFound(_))
        ));
    }

    #[test]
    fn cleanup_session_removes_the_registry_entry() {
        let id = format!("cleanup-{}", generate_session_id());
        seed(&id);

        cleanup_session(&id, true).unwrap();

        assert!(matches!(frames_dir(&id), Err(Error::SessionNotFound(_))));
        assert!(matches!(request(&id), Err(Error::SessionNotFound(_))));
    }

    #[test]
    fn cleanup_session_on_unknown_id_errors() {
        assert!(matches!(
            cleanup_session("definitely-not-a-real-session-id", true),
            Err(Error::SessionNotFound(_))
        ));
    }

    #[test]
    fn frames_dir_and_session_dir_and_request_reflect_the_seeded_entry() {
        let id = format!("lookup-{}", generate_session_id());
        seed(&id);

        assert_eq!(
            frames_dir(&id).unwrap(),
            PathBuf::from("/tmp/spindle-lab-session-test")
                .join(&id)
                .join("frames")
        );
        assert_eq!(
            session_dir(&id).unwrap(),
            PathBuf::from("/tmp/spindle-lab-session-test").join(&id)
        );
        assert_eq!(request(&id).unwrap().frame_count, 1);

        cleanup_session(&id, true).unwrap();
    }
}
