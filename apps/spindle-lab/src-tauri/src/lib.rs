// Configures the native Tauri runtime for the Spindle Lab desktop shell.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

mod env;
mod error;
mod labs;
mod process;

use env::lab_env_check;
use labs::svg::commands::{
    svg_import, svg_probe_output, svg_render_save_as, svg_render_session_begin,
    svg_render_session_cancel, svg_render_session_cleanup, svg_render_session_mux,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // Shell-wide commands
            lab_env_check,
            // SVG Lab commands (docs/plan.md §5) — import (M2), capture
            // session lifecycle + mux + ffprobe verification (M5/M6).
            svg_import,
            svg_render_session_begin,
            svg_render_session_mux,
            svg_render_session_cancel,
            svg_render_session_cleanup,
            svg_probe_output,
            svg_render_save_as,
        ])
        // Official Tauri v2 plugins
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_os::init());

    // Dev-only agent-driving bridge -- never compiled into the plugin list for
    // a release build, and off by default even in debug builds (opt in with
    // `SPINDLE_LAB_MCP_BRIDGE=1 pnpm tauri:debug`) since it opens a websocket
    // control channel into the running app. See the Cargo.toml comment above
    // this dependency for the full rationale.
    #[cfg(debug_assertions)]
    if std::env::var_os("SPINDLE_LAB_MCP_BRIDGE").is_some() {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
