// Configures the native Tauri runtime for the Spindle Lab desktop shell.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

mod env;
// Scaffolding for future lab commands (see docs/plan.md §5) — nothing returns
// an `Error` yet, so it is otherwise dead code until the first lab needs it.
#[allow(dead_code)]
mod error;
mod labs;

use env::lab_env_check;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // Shell-wide commands
            lab_env_check,
            // Labs: none registered yet — the SVG Lab's `svg_*` commands land in M2.
        ])
        // Official Tauri v2 plugins
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
