// Tauri commands for the SVG Lab (docs/plan.md §5). Only `svg_import` exists
// in M2; render/mux commands land in later milestones.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::PathBuf;

use super::import::{import_svg, SvgImportResult};
use crate::error::Result;

/// Reads and inspects an SVG file, inlining local raster references so the
/// returned text is a single self-contained source of truth for preview and
/// (in later milestones) baking.
#[tauri::command]
pub fn svg_import(path: PathBuf) -> Result<SvgImportResult> {
    import_svg(&path)
}
