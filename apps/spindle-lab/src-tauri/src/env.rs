// Resolves ffmpeg/ffprobe on PATH and reports their status for the statusbar.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvReport {
    pub ffmpeg: ToolStatus,
    pub ffprobe: ToolStatus,
}

/// Reports whether ffmpeg/ffprobe resolve on PATH, with their resolved path and
/// version string when found. PATH-only — no sidecar fallback, per
/// docs/plan.md §2 (ffmpeg is a system dependency here, same as Spindle).
#[tauri::command]
pub fn lab_env_check() -> EnvReport {
    EnvReport {
        ffmpeg: check_tool("ffmpeg"),
        ffprobe: check_tool("ffprobe"),
    }
}

fn check_tool(name: &str) -> ToolStatus {
    match resolve_on_path(name) {
        Some(path) => {
            let version = detect_version(&path);
            ToolStatus {
                found: true,
                path: Some(path.display().to_string()),
                version,
            }
        }
        None => ToolStatus {
            found: false,
            path: None,
            version: None,
        },
    }
}

/// Walks PATH directories looking for the named binary.
fn resolve_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    std::env::split_paths(&path_var)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// Runs the tool with a version flag and returns the first non-empty output line.
///
/// Tries both flag styles and both stdout/stderr, since tools disagree on both
/// (ffmpeg prints its version banner to stdout; some tools prefer stderr).
fn detect_version(path: &Path) -> Option<String> {
    for flag in ["-version", "--version"] {
        let Ok(output) = Command::new(path).arg(flag).output() else {
            continue;
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let text = if stdout.trim().is_empty() {
            &stderr
        } else {
            &stdout
        };
        if let Some(line) = text.lines().find(|line| !line.trim().is_empty()) {
            return Some(line.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // Does not assume ffmpeg/ffprobe are actually installed, since CI may not
    // have them (see docs/plan.md §9 risks) — only checks the found/path/version
    // invariant holds either way.
    #[test]
    fn tool_status_is_internally_consistent() {
        for status in [
            check_tool("ffmpeg"),
            check_tool("ffprobe"),
            check_tool("definitely-not-a-real-tool"),
        ] {
            if status.found {
                assert!(
                    status.path.is_some(),
                    "a found tool should have a resolved path"
                );
            } else {
                assert!(
                    status.path.is_none(),
                    "an unresolved tool should not report a path"
                );
                assert!(
                    status.version.is_none(),
                    "an unresolved tool should not report a version"
                );
            }
        }
    }

    #[test]
    fn resolve_on_path_returns_none_for_bogus_name() {
        assert!(resolve_on_path("definitely-not-a-real-tool-name").is_none());
    }
}
