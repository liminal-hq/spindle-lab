// Subprocess execution for ffmpeg, with streaming `-progress pipe:2` output,
// per-line cancellation checks, and throttled progress events
// (docs/plan.md §4.7, §5).
//
// Structurally ported from Spindle's own
// `plugins/tauri-plugin-spindle-project/src/build/executor/process.rs`
// (`run_ffmpeg_command`) and `build/ffmpeg_progress.rs` -- that code has real
// bug-fix history baked into its comments (the raw-byte stderr reads and
// lossy UTF-8 decode so non-UTF-8 metadata never crashes the reader loop,
// and the block-aligned `out_time`/`speed` pairing so the percent/ETA
// computed for one `-progress` block never mixes in the previous block's
// values), so it is reproduced here rather than rediscovered.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::io::BufRead;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};

/// Minimum interval between throttled `spindle-lab://render-progress` emissions.
const PROGRESS_THROTTLE_MS: u128 = 500;

/// Payload for `spindle-lab://render-progress`, per docs/plan.md §5.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProgressEvent {
    pub session_id: String,
    pub phase: String,
    pub percent: Option<f64>,
    pub message: Option<String>,
    pub elapsed_secs: Option<f64>,
    pub eta_secs: Option<f64>,
}

/// Runs an ffmpeg command with streaming stderr progress and cancellation
/// support, emitting throttled `spindle-lab://render-progress` events as it
/// goes. `args[0]` is expected to be `"ffmpeg"`; the caller's argv is exactly
/// what actually runs, plus an injected `-progress pipe:2` immediately before
/// the final (output path) argument.
pub fn run_ffmpeg_with_progress(
    app: &AppHandle,
    session_id: &str,
    phase: &str,
    args: &[String],
    duration_secs: Option<f64>,
    cancelled: &AtomicBool,
) -> Result<String> {
    if args.is_empty() {
        return Err(Error::Ffmpeg("empty ffmpeg command".to_string()));
    }

    let mut cmd_args: Vec<&str> = args.iter().map(String::as_str).collect();
    let insert_pos = if cmd_args.len() > 1 {
        cmd_args.len() - 1
    } else {
        cmd_args.len()
    };
    cmd_args.insert(insert_pos, "pipe:2");
    cmd_args.insert(insert_pos, "-progress");

    let mut child = Command::new(cmd_args[0])
        .args(&cmd_args[1..])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            Error::Ffmpeg(format!(
                "Failed to run {}: {err}. Ensure it is installed and on the PATH.",
                args[0]
            ))
        })?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::Ffmpeg("failed to capture ffmpeg stderr".to_string()))?;

    let mut reader = std::io::BufReader::new(stderr);
    let mut stderr_buf = String::new();
    let job_start = Instant::now();
    let mut last_emit = Instant::now();
    let mut last_out_time: Option<f64> = None;
    let mut last_speed: Option<f64> = None;
    let mut raw_line = Vec::new();

    // Read stderr as raw bytes and decode lossily so non-UTF-8 metadata in
    // ffmpeg's own log output never turns into an error that leaks the
    // child process (see Spindle's process.rs, same rationale).
    loop {
        raw_line.clear();
        let bytes_read = reader.read_until(b'\n', &mut raw_line).unwrap_or(0);
        if bytes_read == 0 {
            break; // EOF
        }

        if cancelled.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::Cancelled);
        }

        let line = String::from_utf8_lossy(&raw_line);
        let line = line.trim_end_matches('\n').trim_end_matches('\r');

        // ffmpeg's `-progress` output writes one key=value pair per line, in
        // a fixed order per block: ..., out_time, ..., speed,
        // progress=continue|end. Remember out_time/speed as they arrive and
        // only act once `progress=` closes the block, so the percent/ETA
        // computed below always pairs same-block values.
        if let Some(value) = extract_progress_value(line, "out_time") {
            last_out_time = parse_out_time_secs(value);
        }
        if let Some(value) = extract_progress_value(line, "speed") {
            last_speed = parse_speed(value);
        }

        if extract_progress_value(line, "progress").is_some() {
            if let Some(elapsed) = last_out_time {
                let percent = step_percent(elapsed, duration_secs);
                let eta = last_speed.and_then(|speed| eta_secs(elapsed, duration_secs, speed));

                if last_emit.elapsed().as_millis() >= PROGRESS_THROTTLE_MS {
                    let _ = app.emit(
                        "spindle-lab://render-progress",
                        RenderProgressEvent {
                            session_id: session_id.to_string(),
                            phase: phase.to_string(),
                            percent,
                            message: None,
                            elapsed_secs: Some(job_start.elapsed().as_secs_f64()),
                            eta_secs: eta,
                        },
                    );
                    last_emit = Instant::now();
                }
            }
        }

        let trimmed = line.trim();
        if !trimmed.is_empty() {
            if !stderr_buf.is_empty() {
                stderr_buf.push('\n');
            }
            stderr_buf.push_str(trimmed);
        }
    }

    let status = child
        .wait()
        .map_err(|err| Error::Ffmpeg(format!("failed waiting for {}: {err}", args[0])))?;

    let stdout = child
        .stdout
        .map(|mut s| {
            let mut buf = String::new();
            use std::io::Read;
            let _ = s.read_to_string(&mut buf);
            buf
        })
        .unwrap_or_default();

    if status.success() {
        let _ = app.emit(
            "spindle-lab://render-progress",
            RenderProgressEvent {
                session_id: session_id.to_string(),
                phase: phase.to_string(),
                percent: Some(100.0),
                message: Some("done".to_string()),
                elapsed_secs: Some(job_start.elapsed().as_secs_f64()),
                eta_secs: Some(0.0),
            },
        );
        let mut combined = String::new();
        if !stdout.trim().is_empty() {
            combined.push_str(&stdout);
        }
        if !stderr_buf.trim().is_empty() {
            if !combined.is_empty() {
                combined.push('\n');
            }
            combined.push_str(&stderr_buf);
        }
        Ok(combined)
    } else {
        let mut msg = format!("{} exited with status {status}", args[0]);
        if !stderr_buf.trim().is_empty() {
            msg.push('\n');
            msg.push_str(&stderr_buf);
        }
        Err(Error::Ffmpeg(msg))
    }
}

/// Runs a command to completion without progress streaming -- used for the
/// loop-repetition second pass (docs/plan.md §4.5/§4.7, a `-c copy` remux
/// that finishes in a fraction of a second) and for `ffprobe`. Returns only
/// stdout on success (not stdout+stderr combined, unlike the ffmpeg progress
/// runner above) so `ffprobe`'s `-of json` output -- which this same
/// function backs -- comes back as clean, directly parseable JSON.
pub fn run_command(args: &[String]) -> Result<String> {
    if args.is_empty() {
        return Err(Error::Ffmpeg("empty command".to_string()));
    }

    let output = Command::new(&args[0])
        .args(&args[1..])
        .output()
        .map_err(|err| {
            Error::Ffmpeg(format!(
                "Failed to run {}: {err}. Ensure it is installed and on the PATH.",
                args[0]
            ))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        let mut msg = format!("{} exited with status {}", args[0], output.status);
        if !stderr.trim().is_empty() {
            msg.push('\n');
            msg.push_str(&stderr);
        }
        Err(Error::Ffmpeg(msg))
    }
}

// --- progress line parsing, ported from Spindle's build/ffmpeg_progress.rs ---

fn parse_out_time_secs(value: &str) -> Option<f64> {
    let value = value.trim();
    // Negative sentinel values like `-0:00:00.000000` mean "no data yet".
    if value.starts_with('-') {
        return None;
    }
    let mut parts = value.splitn(3, ':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    let total = hours * 3600.0 + minutes * 60.0 + seconds;
    if total >= 0.0 {
        Some(total)
    } else {
        None
    }
}

fn extract_progress_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let line = line.trim();
    if line.starts_with(key) && line.as_bytes().get(key.len()) == Some(&b'=') {
        Some(&line[key.len() + 1..])
    } else {
        None
    }
}

fn step_percent(elapsed_secs: f64, duration_secs: Option<f64>) -> Option<f64> {
    let dur = duration_secs.filter(|&d| d > 0.0)?;
    let pct = (elapsed_secs / dur) * 100.0;
    Some(pct.clamp(0.0, 100.0))
}

/// Parses a `speed` value from ffmpeg's `-progress` output, e.g. `2.3x`.
/// ffmpeg emits `N/A` before the encode has produced any timed output, and
/// `0x` momentarily at the very start -- both treated as "no usable speed
/// yet" since they can't drive an ETA estimate.
fn parse_speed(value: &str) -> Option<f64> {
    let value = value.trim().trim_end_matches('x');
    let speed: f64 = value.parse().ok()?;
    if speed > 0.0 {
        Some(speed)
    } else {
        None
    }
}

fn eta_secs(out_time_secs: f64, duration_secs: Option<f64>, speed: f64) -> Option<f64> {
    let dur = duration_secs.filter(|&d| d > 0.0)?;
    if speed <= 0.0 {
        return None;
    }
    let remaining_source_secs = (dur - out_time_secs).max(0.0);
    Some(remaining_source_secs / speed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_out_time_basic() {
        assert_eq!(parse_out_time_secs("00:01:23.456000"), Some(83.456));
    }

    #[test]
    fn parse_out_time_negative_sentinel() {
        assert_eq!(parse_out_time_secs("-0:00:00.000000"), None);
    }

    #[test]
    fn parse_out_time_garbage() {
        assert_eq!(parse_out_time_secs("not-a-time"), None);
    }

    #[test]
    fn extract_progress_value_matches() {
        assert_eq!(
            extract_progress_value("out_time=00:01:23.456000", "out_time"),
            Some("00:01:23.456000")
        );
    }

    #[test]
    fn extract_progress_value_partial_key_does_not_match() {
        // "out_time_us" should not match "out_time".
        assert_eq!(
            extract_progress_value("out_time_us=123456", "out_time"),
            None
        );
    }

    #[test]
    fn step_percent_clamps_over_100() {
        assert_eq!(step_percent(110.0, Some(100.0)), Some(100.0));
    }

    #[test]
    fn step_percent_none_without_duration() {
        assert_eq!(step_percent(50.0, None), None);
    }

    #[test]
    fn parse_speed_not_available() {
        assert_eq!(parse_speed("N/A"), None);
    }

    #[test]
    fn parse_speed_zero_is_not_usable() {
        assert_eq!(parse_speed("0x"), None);
    }

    #[test]
    fn eta_secs_normal() {
        // 50s into a 100s source at 2x speed -> 50s of source remaining / 2x = 25s.
        assert_eq!(eta_secs(50.0, Some(100.0), 2.0), Some(25.0));
    }

    #[test]
    fn eta_secs_none_for_zero_speed() {
        assert_eq!(eta_secs(50.0, Some(100.0), 0.0), None);
    }

    // Deliberately does not spawn a real ffmpeg process (docs/plan.md §9:
    // "ffmpeg absent in CI" -> unit-test argv/parsing only). This only
    // exercises the missing-binary error path, which needs no ffmpeg
    // installation to reproduce.
    #[test]
    fn run_command_reports_a_clear_error_for_a_missing_binary() {
        let err = run_command(&["definitely-not-a-real-binary".to_string()]).unwrap_err();
        assert!(matches!(err, Error::Ffmpeg(_)));
    }

    // `run_ffmpeg_with_progress` itself needs a live `AppHandle` to call
    // `app.emit(...)`, which is not constructible outside a running Tauri
    // app -- so, like `rasterise.ts`'s impure half on the frontend, its
    // spawn/emit/cancellation behaviour is verified manually (this
    // milestone's Playwright + `pnpm tauri dev` pass) rather than unit
    // tested here. Its pure progress-parsing helpers above are fully
    // covered without needing a process or an app at all.
}
