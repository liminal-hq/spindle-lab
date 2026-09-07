// Mux command construction for the SVG Lab capture pipeline (docs/plan.md
// §4.7): a pure, unit-tested `Vec<String>` builder mirroring the
// `build_ffmpeg_transcode_command`-style pattern in Spindle's
// `plugins/tauri-plugin-spindle-project/src/build/ffmpeg.rs`.
//
// The DVD-legal MPEG-2 preset (docs/plan.md's "DVD MPEG-2 export" section)
// ports its exact numbers from that same sibling project rather than
// reinventing them: `dvd_colour_flags()` for the colour tags and the
// motion-menu encode command documented in `docs/motion-menus.md`'s "Build
// Pipeline" section for the bitrate/GOP/mux constants.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::session::FRAME_PATTERN;
use crate::error::{Error, Result};

/// The four v1.1 mux targets (docs/plan.md's mux-target table): the original
/// three general-purpose presets, plus the DVD-legal MPEG-2 preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OutputCodec {
    H264Mp4,
    Ffv1Mkv,
    QtrleMov,
    Mpeg2Dvd,
}

impl OutputCodec {
    /// The file extension conventionally used for this preset's container.
    pub fn extension(self) -> &'static str {
        match self {
            OutputCodec::H264Mp4 => "mp4",
            OutputCodec::Ffv1Mkv => "mkv",
            OutputCodec::QtrleMov => "mov",
            OutputCodec::Mpeg2Dvd => "mpg",
        }
    }
}

/// DVD-Video's display-aspect-ratio signalling (docs/plan.md's DVD MPEG-2
/// section): the encoded pixel raster is always exactly 720x480 (NTSC) or
/// 720x576 (PAL) regardless of this value -- 4:3 vs 16:9 anamorphic
/// widescreen is a player-side display hint carried in the stream's DAR
/// metadata (ffmpeg's `-aspect` output flag), not a different raster size.
/// Harmless and meaningful for any container that supports it, so it is
/// threaded through every codec, not just `Mpeg2Dvd`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AspectRatio {
    FourThree,
    SixteenNine,
}

impl AspectRatio {
    fn ffmpeg_value(self) -> &'static str {
        match self {
            AspectRatio::FourThree => "4:3",
            AspectRatio::SixteenNine => "16:9",
        }
    }
}

/// Mirrors docs/plan.md §5's `MuxOptions`, extended with `aspect_ratio`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuxOptions {
    pub codec: OutputCodec,
    pub fps_num: u32,
    pub fps_den: u32,
    pub loop_count: u32,
    pub output_path: Option<String>,
    pub crf: Option<u32>,
    /// `None` means "don't force a DAR" -- the player derives it from the
    /// raster's own width:height.
    pub aspect_ratio: Option<AspectRatio>,
}

/// Default CRF for the H.264 preset when `MuxOptions.crf` is unset, per
/// docs/plan.md §4.7's worked example.
const DEFAULT_H264_CRF: u32 = 16;

/// The two TV systems DVD-Video supports. Determined from the mux request's
/// `fps_num`/`fps_den` rather than a redundant separate NTSC/PAL codec
/// variant -- the fps preset already distinguishes them (docs/plan.md's
/// `FPS_PRESETS` carries both 29.97/NTSC and 25/PAL entries).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DvdTvSystem {
    Ntsc,
    Pal,
}

impl DvdTvSystem {
    /// `-g` (GOP size): 18 for NTSC, 12 for PAL -- Spindle's own
    /// `build/menu_motion.rs` motion-menu encode command, ported verbatim
    /// (docs/motion-menus.md's "Build Pipeline" section).
    fn gop_size(self) -> u32 {
        match self {
            DvdTvSystem::Ntsc => 18,
            DvdTvSystem::Pal => 12,
        }
    }

    /// Mirrors Spindle's own `dvd_colour_flags()`
    /// (`plugins/tauri-plugin-spindle-project/src/build/ffmpeg.rs`):
    /// `smpte170m` for NTSC, `bt470bg` for PAL, applied identically to
    /// `-color_primaries`/`-color_trc`/`-colorspace`.
    fn colour_tag(self) -> &'static str {
        match self {
            DvdTvSystem::Ntsc => "smpte170m",
            DvdTvSystem::Pal => "bt470bg",
        }
    }
}

/// Resolves the TV system for a DVD-legal encode, or a clear
/// `InvalidDvdFrameRate` error for anything else -- DVD-Video has exactly
/// two legal frame rates, and silently picking one would produce a
/// spec-violating file.
fn dvd_tv_system_for_fps(fps_num: u32, fps_den: u32) -> Result<DvdTvSystem> {
    match (fps_num, fps_den) {
        (30000, 1001) => Ok(DvdTvSystem::Ntsc),
        (25, 1) => Ok(DvdTvSystem::Pal),
        _ => Err(Error::InvalidDvdFrameRate { fps_num, fps_den }),
    }
}

/// Validates that `(width, height)` is one of DVD-Video's two legal rasters.
/// This is the source-of-truth check (docs/plan.md's DVD MPEG-2 section
/// calls out that a frontend guard should exist too, but this is what
/// actually prevents a spec-violating file from being written).
fn validate_dvd_raster(width: u32, height: u32) -> Result<()> {
    match (width, height) {
        (720, 480) | (720, 576) => Ok(()),
        _ => Err(Error::InvalidDvdRaster { width, height }),
    }
}

fn fps_rational(num: u32, den: u32) -> String {
    format!("{num}/{den}")
}

/// Builds the image2-sequence-to-video mux command, per docs/plan.md §4.7:
///
/// ```text
/// ffmpeg -y
///   -framerate <num>/<den> -start_number 0 -i <framesDir>/frame_%06d.png
///   -c:v ... (per codec preset)
///   [-aspect 4:3|16:9]
///   <output>
/// ```
///
/// `width`/`height` are the capture session's export raster -- needed here
/// only to validate a DVD-legal request; every other codec ignores them,
/// since ffmpeg reads the actual pixel dimensions from the PNG sequence
/// itself. Returns `Err` for a `Mpeg2Dvd` request whose raster or frame rate
/// isn't DVD-legal, instead of silently emitting a spec-violating file.
///
/// The untagged-sRGB colour flags and the explicit output `-r`/
/// `-movflags +faststart` apply only to the H.264 path, per docs/plan.md's
/// own worked example -- FFV1 and QuickTime RLE are lossless intermediates
/// with no comparable player-compatibility concern to address. The DVD
/// MPEG-2 path carries its own DVD-mandated colour tags instead (see
/// `DvdTvSystem::colour_tag`).
pub fn build_mux_command(
    frames_dir: &Path,
    options: &MuxOptions,
    width: u32,
    height: u32,
    output_path: &str,
) -> Result<Vec<String>> {
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
                framerate.clone(),
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
        OutputCodec::Mpeg2Dvd => {
            validate_dvd_raster(width, height)?;
            let standard = dvd_tv_system_for_fps(options.fps_num, options.fps_den)?;
            let colour = standard.colour_tag();
            cmd.extend([
                "-c:v".to_string(),
                "mpeg2video".to_string(),
                "-b:v".to_string(),
                "4000k".to_string(),
                "-maxrate".to_string(),
                "7000k".to_string(),
                "-bufsize".to_string(),
                "1835k".to_string(),
                "-g".to_string(),
                standard.gop_size().to_string(),
                // Closed GOPs for a clean loop cut; scene-cut detection must
                // be disabled because ffmpeg's mpeg2video encoder can't
                // combine closed GOPs with scene-change-triggered GOP
                // breaks -- Spindle's own documented workaround
                // (docs/motion-menus.md), ported verbatim.
                "-flags".to_string(),
                "+cgop".to_string(),
                "-sc_threshold".to_string(),
                "1000000000".to_string(),
                "-color_primaries".to_string(),
                colour.to_string(),
                "-color_trc".to_string(),
                colour.to_string(),
                "-colorspace".to_string(),
                colour.to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-r".to_string(),
                framerate,
                // No `-c:a`/no audio input: this lab produces a video-only
                // clip (docs/plan.md's DVD MPEG-2 section) -- Spindle's own
                // build pipeline composes the audio bed separately when it
                // later re-encodes this as a background asset.
                "-f".to_string(),
                "dvd".to_string(),
                "-muxrate".to_string(),
                "10080000".to_string(),
            ]);
        }
    }

    if let Some(aspect_ratio) = options.aspect_ratio {
        cmd.push("-aspect".to_string());
        cmd.push(aspect_ratio.ffmpeg_value().to_string());
    }

    cmd.push(output_path.to_string());
    Ok(cmd)
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
            aspect_ratio: None,
        }
    }

    fn value_after<'a>(cmd: &'a [String], flag: &str) -> &'a str {
        cmd.iter()
            .skip_while(|a| a.as_str() != flag)
            .nth(1)
            .unwrap_or_else(|| panic!("expected {flag} in {cmd:?}"))
    }

    fn build(codec: OutputCodec, width: u32, height: u32, output: &str) -> Result<Vec<String>> {
        build_mux_command(&frames_dir(), &base_options(codec), width, height, output)
    }

    #[test]
    fn h264_command_has_framerate_start_number_and_input_pattern() {
        let cmd = build(OutputCodec::H264Mp4, 1920, 1080, "/tmp/out.mp4").unwrap();
        assert_eq!(cmd[0], "ffmpeg");
        assert_eq!(value_after(&cmd, "-framerate"), "30000/1001");
        assert_eq!(value_after(&cmd, "-start_number"), "0");
        let input = value_after(&cmd, "-i");
        assert!(input.ends_with("frame_%06d.png"), "got {input}");
    }

    #[test]
    fn h264_command_uses_libx264_and_default_crf() {
        let cmd = build(OutputCodec::H264Mp4, 1920, 1080, "/tmp/out.mp4").unwrap();
        assert!(cmd.contains(&"libx264".to_string()));
        assert_eq!(value_after(&cmd, "-crf"), "16");
        assert!(cmd.contains(&"yuv420p".to_string()));
    }

    #[test]
    fn h264_command_honours_crf_override() {
        let mut options = base_options(OutputCodec::H264Mp4);
        options.crf = Some(20);
        let cmd = build_mux_command(&frames_dir(), &options, 1920, 1080, "/tmp/out.mp4").unwrap();
        assert_eq!(value_after(&cmd, "-crf"), "20");
    }

    #[test]
    fn h264_command_tags_untagged_srgb_as_bt709() {
        let cmd = build(OutputCodec::H264Mp4, 1920, 1080, "/tmp/out.mp4").unwrap();
        assert_eq!(value_after(&cmd, "-color_primaries"), "bt709");
        assert_eq!(value_after(&cmd, "-color_trc"), "bt709");
        assert_eq!(value_after(&cmd, "-colorspace"), "bt709");
    }

    #[test]
    fn h264_command_sets_output_rate_and_faststart() {
        let cmd = build(OutputCodec::H264Mp4, 1920, 1080, "/tmp/out.mp4").unwrap();
        assert_eq!(value_after(&cmd, "-r"), "30000/1001");
        assert!(cmd.contains(&"+faststart".to_string()));
        assert_eq!(cmd.last().unwrap(), "/tmp/out.mp4");
    }

    #[test]
    fn ffv1_command_is_lossless_bgr0_without_h264_only_flags() {
        let cmd = build(OutputCodec::Ffv1Mkv, 1920, 1080, "/tmp/out.mkv").unwrap();
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
        let cmd = build(OutputCodec::QtrleMov, 1920, 1080, "/tmp/out.mov").unwrap();
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
        assert_eq!(OutputCodec::Mpeg2Dvd.extension(), "mpg");
    }

    #[test]
    fn mpeg2_dvd_ntsc_command_has_dvd_legal_bitrate_gop_and_colour() {
        let cmd = build(OutputCodec::Mpeg2Dvd, 720, 480, "/tmp/out.mpg").unwrap();
        assert!(cmd.contains(&"mpeg2video".to_string()));
        assert_eq!(value_after(&cmd, "-b:v"), "4000k");
        assert_eq!(value_after(&cmd, "-maxrate"), "7000k");
        assert_eq!(value_after(&cmd, "-bufsize"), "1835k");
        assert_eq!(value_after(&cmd, "-g"), "18");
        assert!(cmd.contains(&"+cgop".to_string()));
        assert_eq!(value_after(&cmd, "-sc_threshold"), "1000000000");
        assert_eq!(value_after(&cmd, "-color_primaries"), "smpte170m");
        assert_eq!(value_after(&cmd, "-color_trc"), "smpte170m");
        assert_eq!(value_after(&cmd, "-colorspace"), "smpte170m");
        assert_eq!(value_after(&cmd, "-pix_fmt"), "yuv420p");
        assert_eq!(value_after(&cmd, "-r"), "30000/1001");
        assert_eq!(value_after(&cmd, "-f"), "dvd");
        assert_eq!(value_after(&cmd, "-muxrate"), "10080000");
        assert!(!cmd.contains(&"-c:a".to_string()));
        assert_eq!(cmd.last().unwrap(), "/tmp/out.mpg");
    }

    #[test]
    fn mpeg2_dvd_pal_command_uses_pal_gop_and_colour() {
        let mut options = base_options(OutputCodec::Mpeg2Dvd);
        options.fps_num = 25;
        options.fps_den = 1;
        let cmd = build_mux_command(&frames_dir(), &options, 720, 576, "/tmp/out.mpg").unwrap();
        assert_eq!(value_after(&cmd, "-g"), "12");
        assert_eq!(value_after(&cmd, "-color_primaries"), "bt470bg");
        assert_eq!(value_after(&cmd, "-color_trc"), "bt470bg");
        assert_eq!(value_after(&cmd, "-colorspace"), "bt470bg");
        assert_eq!(value_after(&cmd, "-r"), "25/1");
    }

    #[test]
    fn mpeg2_dvd_rejects_a_non_dvd_legal_raster() {
        let err = build(OutputCodec::Mpeg2Dvd, 1280, 720, "/tmp/out.mpg").unwrap_err();
        match err {
            Error::InvalidDvdRaster { width, height } => {
                assert_eq!((width, height), (1280, 720));
            }
            other => panic!("expected InvalidDvdRaster, got {other:?}"),
        }
    }

    #[test]
    fn mpeg2_dvd_rejects_a_non_dvd_legal_frame_rate() {
        let mut options = base_options(OutputCodec::Mpeg2Dvd);
        options.fps_num = 30;
        options.fps_den = 1;
        let err = build_mux_command(&frames_dir(), &options, 720, 480, "/tmp/out.mpg").unwrap_err();
        match err {
            Error::InvalidDvdFrameRate { fps_num, fps_den } => {
                assert_eq!((fps_num, fps_den), (30, 1));
            }
            other => panic!("expected InvalidDvdFrameRate, got {other:?}"),
        }
    }

    #[test]
    fn aspect_flag_appears_when_set_and_is_absent_by_default() {
        let no_aspect = build(OutputCodec::H264Mp4, 1920, 1080, "/tmp/out.mp4").unwrap();
        assert!(!no_aspect.contains(&"-aspect".to_string()));

        let mut four_three = base_options(OutputCodec::H264Mp4);
        four_three.aspect_ratio = Some(AspectRatio::FourThree);
        let cmd =
            build_mux_command(&frames_dir(), &four_three, 1920, 1080, "/tmp/out.mp4").unwrap();
        assert_eq!(value_after(&cmd, "-aspect"), "4:3");

        let mut sixteen_nine = base_options(OutputCodec::Mpeg2Dvd);
        sixteen_nine.aspect_ratio = Some(AspectRatio::SixteenNine);
        let cmd =
            build_mux_command(&frames_dir(), &sixteen_nine, 720, 480, "/tmp/out.mpg").unwrap();
        assert_eq!(value_after(&cmd, "-aspect"), "16:9");
    }
}
