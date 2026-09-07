// Shared error type for lab commands that need to report failures to the frontend.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

/// Serialises to a plain string over IPC, matching Spindle's plugin error convention.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error("JSON serialisation error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("XML parsing error: {0}")]
    Xml(#[from] quick_xml::Error),

    #[error("{0}")]
    InvalidSvg(String),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    #[error("ffmpeg error: {0}")]
    Ffmpeg(String),

    #[error("Render cancelled by user.")]
    Cancelled,

    #[error("Unknown render session '{0}'.")]
    SessionNotFound(String),

    #[error(
        "DVD-legal MPEG-2 requires exactly 720x480 (NTSC) or 720x576 (PAL); got {width}x{height}."
    )]
    InvalidDvdRaster { width: u32, height: u32 },

    #[error(
        "DVD-legal MPEG-2 requires 29.97fps (30000/1001, NTSC) or 25fps (PAL); got {fps_num}/{fps_den}."
    )]
    InvalidDvdFrameRate { fps_num: u32, fps_den: u32 },
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
