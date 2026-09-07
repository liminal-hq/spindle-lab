// Mux command construction for the SVG Lab capture pipeline (docs/plan.md
// §4.7): a pure, unit-tested `Vec<String>` builder mirroring the
// `build_ffmpeg_transcode_command`-style pattern in Spindle's
// `plugins/tauri-plugin-spindle-project/src/build/ffmpeg.rs`.
//
// Deliberately out of scope for this milestone (docs/plan.md §8): DVD-legal
// MPEG-2 output, colour-flag handling beyond the flat untagged-sRGB tagging
// below, and any Spindle-specific raster/SAR treatment. Those are a natural
// v1.1 once this milestone's plain capture-to-video path is proven, reusing
// Spindle's own `dvd_colour_flags`/scale-pad-setsar logic rather than
// reimplementing it here.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::session::FRAME_PATTERN;

/// The three v1 mux targets from docs/plan.md §4.7's table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OutputCodec {
    H264Mp4,
    Ffv1Mkv,
    QtrleMov,
}

impl OutputCodec {
    /// The file extension conventionally used for this preset's container.
    pub fn extension(self) -> &'static str {
        match self {
            OutputCodec::H264Mp4 => "mp4",
            OutputCodec::Ffv1Mkv => "mkv",
            OutputCodec::QtrleMov => "mov",
        }
    }
}

/// Mirrors docs/plan.md §5's `MuxOptions`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuxOptions {
    pub codec: OutputCodec,
    pub fps_num: u32,
    pub fps_den: u32,
    pub loop_count: u32,
    pub output_path: Option<String>,
    pub crf: Option<u32>,
}

/// Default CRF for the H.264 preset when `MuxOptions.crf` is unset, per
/// docs/plan.md §4.7's worked example.
const DEFAULT_H264_CRF: u32 = 16;

fn fps_rational(num: u32, den: u32) -> String {
    format!("{num}/{den}")
}

/// Builds the image2-sequence-to-video mux command, per docs/plan.md §4.7:
///
/// ```text
/// ffmpeg -y
///   -framerate <num>/<den> -start_number 0 -i <framesDir>/frame_%06d.png
///   -c:v ... (per codec preset)
///   <output>
/// ```
///
/// The untagged-sRGB colour flags and the explicit output `-r`/
/// `-movflags +faststart` apply only to the H.264 path, per docs/plan.md's
/// own worked example -- FFV1 and QuickTime RLE are lossless intermediates
/// with no comparable player-compatibility concern to address.
pub fn build_mux_command(
    frames_dir: &Path,
    options: &MuxOptions,
    output_path: &str,
) -> Vec<String> {
    let input_pattern = frames_dir.join(FRAME_PATTERN).display().to_string();
    let framerate = fps_rational(options.fps_num, options.fps_den);

    let mut cmd = vec![
        "ffmpeg".to_string(),
        "-y".to_string(),
        "-framerate".to_string(),
        framerate.clone(),
        "-start_number".to_string(),
        "0".to_string(),
        "-i".to_string(),
        input_pattern,
    ];

    match options.codec {
        OutputCodec::H264Mp4 => {
            let crf = options.crf.unwrap_or(DEFAULT_H264_CRF);
            cmd.extend([
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "slow".to_string(),
                "-crf".to_string(),
                crf.to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-color_primaries".to_string(),
                "bt709".to_string(),
                "-color_trc".to_string(),
                "bt709".to_string(),
                "-colorspace".to_string(),
                "bt709".to_string(),
                "-r".to_string(),
                framerate,
                "-movflags".to_string(),
                "+faststart".to_string(),
            ]);
        }
        OutputCodec::Ffv1Mkv => {
            cmd.extend([
                "-c:v".to_string(),
                "ffv1".to_string(),
                "-level".to_string(),
                "3".to_string(),
                "-g".to_string(),
                "1".to_string(),
                "-pix_fmt".to_string(),
                "bgr0".to_string(),
            ]);
        }
        OutputCodec::QtrleMov => {
            cmd.extend([
                "-c:v".to_string(),
                "qtrle".to_string(),
                "-pix_fmt".to_string(),
                "argb".to_string(),
            ]);
        }
    }

    cmd.push(output_path.to_string());
    cmd
}

/// Builds the loop-repetition second pass, per docs/plan.md §4.5/§4.7:
/// `ffmpeg -y -stream_loop <n-1> -i <loop> -c copy <out>`. Capture always
/// produces exactly one loop's worth of frames regardless of `loop_count` --
/// the caller only runs this pass at all when `loop_count > 1`.
pub fn build_loop_command(
    loop_input_path: &str,
    loop_count: u32,
    output_path: &str,
) -> Vec<String> {
    vec![
        "ffmpeg".to_string(),
        "-y".to_string(),
        "-stream_loop".to_string(),
        loop_count.saturating_sub(1).to_string(),
        "-i".to_string(),
        loop_input_path.to_string(),
        "-c".to_string(),
        "copy".to_string(),
        output_path.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn frames_dir() -> PathBuf {
        PathBuf::from("/tmp/spindle-lab-test/frames")
    }

    fn base_options(codec: OutputCodec) -> MuxOptions {
        MuxOptions {
            codec,
            fps_num: 30000,
            fps_den: 1001,
            loop_count: 1,
            output_path: None,
            crf: None,
        }
    }

    fn value_after<'a>(cmd: &'a [String], flag: &str) -> &'a str {
        cmd.iter()
            .skip_while(|a| a.as_str() != flag)
            .nth(1)
            .unwrap_or_else(|| panic!("expected {flag} in {cmd:?}"))
    }

    #[test]
    fn h264_command_has_framerate_start_number_and_input_pattern() {
        let cmd = build_mux_command(
            &frames_dir(),
            &base_options(OutputCodec::H264Mp4),
            "/tmp/out.mp4",
        );
        assert_eq!(cmd[0], "ffmpeg");
        assert_eq!(value_after(&cmd, "-framerate"), "30000/1001");
        assert_eq!(value_after(&cmd, "-start_number"), "0");
        let input = value_after(&cmd, "-i");
        assert!(input.ends_with("frame_%06d.png"), "got {input}");
    }

    #[test]
    fn h264_command_uses_libx264_and_default_crf() {
        let cmd = build_mux_command(
            &frames_dir(),
            &base_options(OutputCodec::H264Mp4),
            "/tmp/out.mp4",
        );
        assert!(cmd.contains(&"libx264".to_string()));
        assert_eq!(value_after(&cmd, "-crf"), "16");
        assert!(cmd.contains(&"yuv420p".to_string()));
    }

    #[test]
    fn h264_command_honours_crf_override() {
        let mut options = base_options(OutputCodec::H264Mp4);
        options.crf = Some(20);
        let cmd = build_mux_command(&frames_dir(), &options, "/tmp/out.mp4");
        assert_eq!(value_after(&cmd, "-crf"), "20");
    }

    #[test]
    fn h264_command_tags_untagged_srgb_as_bt709() {
        let cmd = build_mux_command(
            &frames_dir(),
            &base_options(OutputCodec::H264Mp4),
            "/tmp/out.mp4",
        );
        assert_eq!(value_after(&cmd, "-color_primaries"), "bt709");
        assert_eq!(value_after(&cmd, "-color_trc"), "bt709");
        assert_eq!(value_after(&cmd, "-colorspace"), "bt709");
    }

    #[test]
    fn h264_command_sets_output_rate_and_faststart() {
        let cmd = build_mux_command(
            &frames_dir(),
            &base_options(OutputCodec::H264Mp4),
            "/tmp/out.mp4",
        );
        assert_eq!(value_after(&cmd, "-r"), "30000/1001");
        assert!(cmd.contains(&"+faststart".to_string()));
        assert_eq!(cmd.last().unwrap(), "/tmp/out.mp4");
    }

    #[test]
    fn ffv1_command_is_lossless_bgr0_without_h264_only_flags() {
        let cmd = build_mux_command(
            &frames_dir(),
            &base_options(OutputCodec::Ffv1Mkv),
            "/tmp/out.mkv",
        );
        assert!(cmd.contains(&"ffv1".to_string()));
        assert!(cmd.contains(&"bgr0".to_string()));
        assert_eq!(value_after(&cmd, "-level"), "3");
        assert_eq!(value_after(&cmd, "-g"), "1");
        assert!(!cmd.contains(&"-crf".to_string()));
        assert!(!cmd.contains(&"-movflags".to_string()));
        assert!(!cmd.contains(&"-color_primaries".to_string()));
        assert_eq!(cmd.last().unwrap(), "/tmp/out.mkv");
    }

    #[test]
    fn qtrle_command_is_alpha_preserving_argb_without_h264_only_flags() {
        let cmd = build_mux_command(
            &frames_dir(),
            &base_options(OutputCodec::QtrleMov),
            "/tmp/out.mov",
        );
        assert!(cmd.contains(&"qtrle".to_string()));
        assert!(cmd.contains(&"argb".to_string()));
        assert!(!cmd.contains(&"-crf".to_string()));
        assert!(!cmd.contains(&"-color_primaries".to_string()));
        assert_eq!(cmd.last().unwrap(), "/tmp/out.mov");
    }

    #[test]
    fn loop_command_uses_stream_loop_n_minus_1_and_stream_copy() {
        let cmd = build_loop_command("/tmp/loop.mp4", 3, "/tmp/out.mp4");
        assert_eq!(cmd[0], "ffmpeg");
        assert_eq!(value_after(&cmd, "-stream_loop"), "2");
        assert!(cmd.contains(&"copy".to_string()));
        assert_eq!(cmd.last().unwrap(), "/tmp/out.mp4");
    }

    #[test]
    fn loop_command_with_count_one_still_builds_a_zero_repeat_command() {
        // The caller (commands.rs) only invokes this when loop_count > 1;
        // this just documents build_loop_command's own saturating behaviour
        // at the boundary rather than panicking.
        let cmd = build_loop_command("/tmp/loop.mp4", 1, "/tmp/out.mp4");
        assert_eq!(value_after(&cmd, "-stream_loop"), "0");
    }

    #[test]
    fn extension_matches_each_preset_container() {
        assert_eq!(OutputCodec::H264Mp4.extension(), "mp4");
        assert_eq!(OutputCodec::Ffv1Mkv.extension(), "mkv");
        assert_eq!(OutputCodec::QtrleMov.extension(), "mov");
    }
}
