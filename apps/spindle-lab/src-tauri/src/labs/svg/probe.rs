// ffprobe JSON inspection of a muxed output file (docs/plan.md §4.8, §5) --
// for a lab this is the *verification*, not decoration: it's how you prove
// the output is actually the requested frame rate and actually tagged
// bt709, not merely that ffmpeg exited zero.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::process::run_command;

/// A small structured summary of `ffprobe -show_streams -show_format`'s
/// output, per docs/plan.md §4.8/§5 -- the fields the `ResultPanel` shows to
/// prove the mux did what was requested.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProbeReport {
    pub codec_name: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub r_frame_rate: Option<String>,
    pub nb_frames: Option<String>,
    pub duration_secs: Option<f64>,
    pub format_name: Option<String>,
    pub color_primaries: Option<String>,
    pub color_transfer: Option<String>,
    pub color_space: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
    format: Option<FfprobeFormat>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    nb_frames: Option<String>,
    color_primaries: Option<String>,
    color_transfer: Option<String>,
    color_space: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

/// Runs `ffprobe -v error -show_streams -show_format -of json` against
/// `path` and parses the first video stream plus the container's format
/// block into `ProbeReport`.
pub fn probe_output(path: &str) -> Result<ProbeReport> {
    let args = vec![
        "ffprobe".to_string(),
        "-v".to_string(),
        "error".to_string(),
        "-show_streams".to_string(),
        "-show_format".to_string(),
        "-of".to_string(),
        "json".to_string(),
        path.to_string(),
    ];
    let output = run_command(&args)?;
    parse_ffprobe_json(&output)
}

fn parse_ffprobe_json(json: &str) -> Result<ProbeReport> {
    let parsed: FfprobeOutput = serde_json::from_str(json)
        .map_err(|err| Error::Ffmpeg(format!("failed to parse ffprobe output: {err}")))?;

    let video_stream = parsed
        .streams
        .into_iter()
        .find(|s| s.codec_type.as_deref() == Some("video"));

    let duration_secs = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_ref())
        .and_then(|d| d.parse::<f64>().ok());

    Ok(ProbeReport {
        codec_name: video_stream.as_ref().and_then(|s| s.codec_name.clone()),
        width: video_stream.as_ref().and_then(|s| s.width),
        height: video_stream.as_ref().and_then(|s| s.height),
        r_frame_rate: video_stream.as_ref().and_then(|s| s.r_frame_rate.clone()),
        nb_frames: video_stream.as_ref().and_then(|s| s.nb_frames.clone()),
        duration_secs,
        format_name: parsed.format.and_then(|f| f.format_name),
        color_primaries: video_stream
            .as_ref()
            .and_then(|s| s.color_primaries.clone()),
        color_transfer: video_stream.as_ref().and_then(|s| s.color_transfer.clone()),
        color_space: video_stream.and_then(|s| s.color_space),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Parses a hand-written, representative ffprobe payload rather than
    // spawning a real `ffprobe` process (docs/plan.md §9: unit-test parsing
    // only, since ffmpeg/ffprobe may not be present in CI).
    #[test]
    fn parses_a_representative_ffprobe_json_payload() {
        let json = r#"{
          "streams": [
            {
              "codec_type": "audio",
              "codec_name": "aac"
            },
            {
              "codec_type": "video",
              "codec_name": "h264",
              "width": 320,
              "height": 240,
              "r_frame_rate": "30000/1001",
              "nb_frames": "60",
              "color_primaries": "bt709",
              "color_transfer": "bt709",
              "color_space": "bt709"
            }
          ],
          "format": {
            "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
            "duration": "2.002000"
          }
        }"#;

        let report = parse_ffprobe_json(json).unwrap();
        assert_eq!(report.codec_name.as_deref(), Some("h264"));
        assert_eq!(report.width, Some(320));
        assert_eq!(report.height, Some(240));
        assert_eq!(report.r_frame_rate.as_deref(), Some("30000/1001"));
        assert_eq!(report.nb_frames.as_deref(), Some("60"));
        assert_eq!(report.duration_secs, Some(2.002));
        assert_eq!(report.color_primaries.as_deref(), Some("bt709"));
    }

    #[test]
    fn ignores_non_video_streams_when_picking_the_reported_stream() {
        let json = r#"{"streams": [{"codec_type": "audio", "codec_name": "aac"}], "format": {}}"#;
        let report = parse_ffprobe_json(json).unwrap();
        assert_eq!(report.codec_name, None);
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_ffprobe_json("not json").is_err());
    }
}
