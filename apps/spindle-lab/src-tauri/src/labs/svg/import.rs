// Parses, inspects, and lightly rewrites an imported SVG file (docs/plan.md §4.1).
//
// Uses `quick-xml`'s event-based reader/writer rather than a full DOM crate:
// this module is read-mostly inspection plus light rewriting of `href`/
// `xlink:href` attribute values, which does not need a mutable tree.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::fs;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;
use quick_xml::writer::Writer;
use quick_xml::XmlVersion;
use serde::Serialize;

use crate::error::{Error, Result};

/// A single non-fatal warning surfaced in the UI, following Spindle's
/// `AssetWarning { code, message }` convention.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgWarning {
    pub code: String,
    pub message: String,
}

/// Feature/security inspection of an imported SVG. `has_script` is
/// security-relevant: any `<script>` element or `on*` event attribute
/// anywhere in the tree, not just at the top level.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgFeatureReport {
    pub has_script: bool,
    pub has_foreign_object: bool,
    pub external_font_faces: Vec<String>,
    pub unresolved_external_refs: Vec<String>,
    pub smil_animation_count: usize,
    pub css_animation_rule_count: usize,
    pub intrinsic_width: Option<f64>,
    pub intrinsic_height: Option<f64>,
    pub view_box: Option<[f64; 4]>,
}

/// The result of `svg_import`: the inlined SVG text plus its feature report.
/// `text` is the single source of truth for preview and (in later
/// milestones) baking -- see docs/plan.md §4.1.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgImportResult {
    pub text: String,
    pub source_path: String,
    pub features: SvgFeatureReport,
    pub warnings: Vec<SvgWarning>,
    pub inlined_asset_count: usize,
}

/// Reads `path`, inlines local raster references, and returns the inspected,
/// rewritten document. `hasScript: true` is reported but is not itself an
/// error -- refusing to preview a scripted SVG is a UI-layer decision.
pub fn import_svg(path: &Path) -> Result<SvgImportResult> {
    let raw = fs::read_to_string(path)?;
    let dir = path.parent().unwrap_or_else(|| Path::new("."));

    let mut inspector = Inspector::default();
    let text = rewrite_and_inspect(&raw, dir, &mut inspector)?;

    let mut warnings = Vec::new();
    if inspector.has_foreign_object {
        warnings.push(SvgWarning {
            code: "foreign-object".to_string(),
            message:
                "Contains a <foreignObject>; rendering may differ or be blank when rasterised."
                    .to_string(),
        });
    }
    let external_font_faces = find_external_font_faces(&inspector.css_buffer);
    for font in &external_font_faces {
        warnings.push(SvgWarning {
            code: "external-font-face".to_string(),
            message: format!(
                "External font face '{font}' will not load during bake; text will fall back to a system font."
            ),
        });
    }
    for reference in &inspector.unresolved_external_refs {
        warnings.push(SvgWarning {
            code: "unresolved-external-ref".to_string(),
            message: format!("Could not inline external reference '{reference}'."),
        });
    }
    if inspector.intrinsic_width.is_none()
        && inspector.intrinsic_height.is_none()
        && inspector.view_box.is_none()
    {
        warnings.push(SvgWarning {
            code: "missing-sizing".to_string(),
            message: "No viewBox and no width/height on the root <svg>; arbitrary-resolution export is impossible without one.".to_string(),
        });
    }

    let css_animation_rule_count = count_css_animation_rules(&inspector.css_buffer);

    Ok(SvgImportResult {
        text,
        source_path: path.display().to_string(),
        features: SvgFeatureReport {
            has_script: inspector.has_script,
            has_foreign_object: inspector.has_foreign_object,
            external_font_faces,
            unresolved_external_refs: inspector.unresolved_external_refs,
            smil_animation_count: inspector.smil_animation_count,
            css_animation_rule_count,
            intrinsic_width: inspector.intrinsic_width,
            intrinsic_height: inspector.intrinsic_height,
            view_box: inspector.view_box,
        },
        warnings,
        inlined_asset_count: inspector.inlined_asset_count,
    })
}

/// Accumulates feature-report state across the single reader/writer pass.
#[derive(Default)]
struct Inspector {
    has_script: bool,
    has_foreign_object: bool,
    smil_animation_count: usize,
    inlined_asset_count: usize,
    unresolved_external_refs: Vec<String>,
    intrinsic_width: Option<f64>,
    intrinsic_height: Option<f64>,
    view_box: Option<[f64; 4]>,
    /// Concatenated text content of every `<style>` element plus every
    /// `style="..."` attribute value, analysed afterwards for `@font-face`
    /// and `@keyframes` rules.
    css_buffer: String,
    root_seen: bool,
}

/// Walks `raw` once, rewriting inlinable `<image>` references and recording
/// everything `SvgFeatureReport` needs, and returns the rewritten document.
fn rewrite_and_inspect(raw: &str, dir: &Path, inspector: &mut Inspector) -> Result<String> {
    let mut reader = Reader::from_str(raw);
    let mut writer = Writer::new(Vec::new());
    let mut in_style = false;
    let mut style_depth = 0i32;
    let mut depth = 0i32;

    loop {
        match reader.read_event()? {
            Event::Eof => break,
            Event::Start(start) => {
                depth += 1;
                let is_root = !inspector.root_seen;
                let new_start = process_element(&start, dir, inspector, is_root)?;
                if is_root {
                    inspector.root_seen = true;
                    ensure_root_is_svg(&new_start)?;
                }
                if new_start.local_name().into_inner() == "style" {
                    in_style = true;
                    style_depth = depth;
                }
                writer.write_event(Event::Start(new_start))?;
            }
            Event::Empty(start) => {
                let is_root = !inspector.root_seen;
                let new_start = process_element(&start, dir, inspector, is_root)?;
                if is_root {
                    inspector.root_seen = true;
                    ensure_root_is_svg(&new_start)?;
                }
                writer.write_event(Event::Empty(new_start))?;
            }
            Event::End(end) => {
                if in_style && depth == style_depth {
                    in_style = false;
                }
                depth -= 1;
                writer.write_event(Event::End(end.into_owned()))?;
            }
            Event::Text(text) => {
                if in_style {
                    inspector.css_buffer.push_str(&text.xml10_content());
                    inspector.css_buffer.push('\n');
                }
                writer.write_event(Event::Text(text.into_owned()))?;
            }
            Event::CData(cdata) => {
                if in_style {
                    inspector.css_buffer.push_str(&cdata.xml10_content());
                    inspector.css_buffer.push('\n');
                }
                writer.write_event(Event::CData(cdata.into_owned()))?;
            }
            other => {
                writer.write_event(other.into_owned())?;
            }
        }
    }

    if !inspector.root_seen {
        return Err(Error::InvalidSvg("root element is not <svg>".to_string()));
    }

    let bytes = writer.into_inner();
    String::from_utf8(bytes)
        .map_err(|err| Error::InvalidSvg(format!("rewritten SVG was not valid UTF-8: {err}")))
}

fn ensure_root_is_svg(start: &BytesStart<'_>) -> Result<()> {
    if start.local_name().into_inner() != "svg" {
        return Err(Error::InvalidSvg("root element is not <svg>".to_string()));
    }
    Ok(())
}

/// Inspects one Start/Empty element's tag and attributes, inlining local
/// `<image>` references and returning the (possibly rewritten) element.
fn process_element(
    start: &BytesStart<'_>,
    dir: &Path,
    inspector: &mut Inspector,
    is_root: bool,
) -> Result<BytesStart<'static>> {
    let name = start.name().into_inner().to_string();
    let local = start.local_name().into_inner();

    if local == "script" {
        inspector.has_script = true;
    }
    if local == "foreignObject" {
        inspector.has_foreign_object = true;
    }
    if matches!(
        local,
        "animate" | "animateTransform" | "animateMotion" | "animateColor" | "set"
    ) {
        inspector.smil_animation_count += 1;
    }
    let is_image = local == "image";

    let mut new_start = BytesStart::new(name);

    for attr in start.attributes() {
        let attr = attr.map_err(quick_xml::Error::from)?;
        let attr_local = attr.key.local_name().into_inner();

        if is_event_handler_attribute(attr_local) {
            inspector.has_script = true;
        }

        if attr_local == "style" {
            let value = attr.normalized_value(XmlVersion::Implicit1_0)?;
            inspector.css_buffer.push_str(&value);
            inspector.css_buffer.push('\n');
        }

        if is_root {
            let key = attr.key.into_inner();
            if key == "width" || key == "height" || key == "viewBox" {
                let value = attr.normalized_value(XmlVersion::Implicit1_0)?;
                match key {
                    "width" => inspector.intrinsic_width = parse_length(&value),
                    "height" => inspector.intrinsic_height = parse_length(&value),
                    "viewBox" => inspector.view_box = parse_view_box(&value),
                    _ => unreachable!(),
                }
            }
        }

        if is_image && attr_local == "href" {
            let value = attr.normalized_value(XmlVersion::Implicit1_0)?;
            if is_local_reference(&value) {
                match try_inline_image(&value, dir) {
                    Some(data_uri) => {
                        inspector.inlined_asset_count += 1;
                        new_start.push_attribute((attr.key.into_inner(), data_uri.as_str()));
                        continue;
                    }
                    None => {
                        inspector.unresolved_external_refs.push(value.to_string());
                    }
                }
            }
        }

        new_start.push_attribute(attr);
    }

    Ok(new_start.into_owned())
}

/// Any `on*` attribute (`onload`, `onclick`, `onbegin`, `onrepeat`, …) is
/// treated as script-bearing -- SMIL and SVG both define event attributes
/// beyond the familiar HTML set, so this checks the shape rather than an
/// enumerated list.
fn is_event_handler_attribute(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() > 2
        && bytes[0].eq_ignore_ascii_case(&b'o')
        && bytes[1].eq_ignore_ascii_case(&b'n')
        && bytes[2].is_ascii_alphabetic()
}

/// True when `value` is neither a `data:` URI, an internal fragment
/// reference (`#id`), nor an absolute URL with a scheme -- i.e. a candidate
/// for local-file inlining.
fn is_local_reference(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return false;
    }
    if trimmed.len() >= 5 && trimmed[..5].eq_ignore_ascii_case("data:") {
        return false;
    }
    if let Some(colon) = trimmed.find(':') {
        let scheme = &trimmed[..colon];
        // A real URL scheme is at least two characters (RFC 3986); a
        // single letter before a colon is almost always a Windows drive
        // letter in a local path, not a scheme.
        let looks_like_scheme = scheme.len() > 1
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.');
        if looks_like_scheme {
            return false;
        }
    }
    true
}

/// Reads and base64-encodes a local raster image relative to `dir`, or
/// `None` if the extension is unsupported or the file cannot be read.
fn try_inline_image(value: &str, dir: &Path) -> Option<String> {
    let mime = mime_from_extension(value)?;
    let resolved = dir.join(value);
    let bytes = fs::read(resolved).ok()?;
    let encoded = BASE64.encode(bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

fn mime_from_extension(value: &str) -> Option<&'static str> {
    let ext = Path::new(value).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Parses a CSS length such as `"800"`, `"800px"`, or `"100%"` into its
/// leading numeric value; the unit is ignored, matching this milestone's
/// need to merely detect *whether* sizing information is present.
fn parse_length(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    let end = trimmed
        .find(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E')))
        .unwrap_or(trimmed.len());
    trimmed[..end].parse::<f64>().ok()
}

fn parse_view_box(value: &str) -> Option<[f64; 4]> {
    let parts: Vec<f64> = value
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|s| !s.is_empty())
        .map(str::parse::<f64>)
        .collect::<std::result::Result<Vec<f64>, _>>()
        .ok()?;
    if parts.len() == 4 {
        Some([parts[0], parts[1], parts[2], parts[3]])
    } else {
        None
    }
}

/// Counts individual rule blocks (e.g. `0%`, `50%, 75%`, `to`) across every
/// `@keyframes` block found in `css`. A heuristic brace-balancing scan, not
/// a real CSS parser -- see docs/plan.md §4.1, which calls a reasonable
/// heuristic count sufficient here.
fn count_css_animation_rules(css: &str) -> usize {
    let mut count = 0;
    let mut search_from = 0;
    while let Some(rel) = css[search_from..].find("@keyframes") {
        let start = search_from + rel;
        let Some(open_rel) = css[start..].find('{') else {
            break;
        };
        let open = start + open_rel;
        match balanced_block_end(css, open) {
            Some(close) => {
                let block = &css[open + 1..close];
                count += block.matches('{').count();
                search_from = close + 1;
            }
            None => break,
        }
    }
    count
}

/// Finds `@font-face` blocks in `css` and returns the `src` URLs that are
/// not already `data:` URIs.
fn find_external_font_faces(css: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = css[search_from..].find("@font-face") {
        let start = search_from + rel;
        let Some(open_rel) = css[start..].find('{') else {
            break;
        };
        let open = start + open_rel;
        match balanced_block_end(css, open) {
            Some(close) => {
                let block = &css[open + 1..close];
                for url in extract_urls(block) {
                    if !url.to_ascii_lowercase().starts_with("data:") {
                        result.push(url);
                    }
                }
                search_from = close + 1;
            }
            None => break,
        }
    }
    result
}

/// Given the byte index of an opening `{`, returns the index of its
/// matching closing `}` by tracking brace depth.
fn balanced_block_end(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0i32;
    for (offset, ch) in text[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(open + offset);
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_urls(css: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = css[search_from..].find("url(") {
        let start = search_from + rel + "url(".len();
        let Some(end_rel) = css[start..].find(')') else {
            break;
        };
        let end = start + end_rel;
        let raw = css[start..end]
            .trim()
            .trim_matches(|c| c == '\'' || c == '"');
        if !raw.is_empty() {
            out.push(raw.to_string());
        }
        search_from = end + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(dir: &Path, name: &str, contents: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn rejects_non_svg_root() {
        let dir = tempdir();
        let path = write_temp(dir.path(), "not-svg.svg", "<html><body/></html>");
        let err = import_svg(&path).unwrap_err();
        assert!(matches!(err, Error::InvalidSvg(_)));
    }

    #[test]
    fn detects_script_element() {
        let dir = tempdir();
        let path = write_temp(
            dir.path(),
            "scripted.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>"#,
        );
        let result = import_svg(&path).unwrap();
        assert!(result.features.has_script);
    }

    #[test]
    fn detects_event_handler_attribute() {
        let dir = tempdir();
        let path = write_temp(
            dir.path(),
            "onload.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="doEvil()"><rect onclick="doEvil()" width="1" height="1"/></svg>"#,
        );
        let result = import_svg(&path).unwrap();
        assert!(result.features.has_script);
    }

    #[test]
    fn detects_foreign_object() {
        let dir = tempdir();
        let path = write_temp(
            dir.path(),
            "fo.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject></svg>"#,
        );
        let result = import_svg(&path).unwrap();
        assert!(result.features.has_foreign_object);
        assert!(result.warnings.iter().any(|w| w.code == "foreign-object"));
    }

    #[test]
    fn flags_missing_sizing_info() {
        let dir = tempdir();
        let path = write_temp(
            dir.path(),
            "no-size.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>"#,
        );
        let result = import_svg(&path).unwrap();
        assert!(result.features.intrinsic_width.is_none());
        assert!(result.features.intrinsic_height.is_none());
        assert!(result.features.view_box.is_none());
        assert!(result.warnings.iter().any(|w| w.code == "missing-sizing"));
    }

    #[test]
    fn parses_view_box_and_intrinsic_size() {
        let dir = tempdir();
        let path = write_temp(
            dir.path(),
            "sized.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="1" height="1"/></svg>"#,
        );
        let result = import_svg(&path).unwrap();
        assert_eq!(result.features.intrinsic_width, Some(200.0));
        assert_eq!(result.features.intrinsic_height, Some(100.0));
        assert_eq!(result.features.view_box, Some([0.0, 0.0, 200.0, 100.0]));
        assert!(!result.warnings.iter().any(|w| w.code == "missing-sizing"));
    }

    #[test]
    fn counts_smil_animation_elements() {
        let dir = tempdir();
        let path = write_temp(
            dir.path(),
            "smil.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
                <rect width="1" height="1">
                    <animate attributeName="x" from="0" to="10" dur="1s"/>
                    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s"/>
                </rect>
            </svg>"#,
        );
        let result = import_svg(&path).unwrap();
        assert_eq!(result.features.smil_animation_count, 2);
    }

    #[test]
    fn counts_css_keyframe_rules_and_flags_external_font() {
        let dir = tempdir();
        let path = write_temp(
            dir.path(),
            "css.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
                <style>
                    @font-face { font-family: 'Ext'; src: url('fonts/ext.woff2') format('woff2'); }
                    @keyframes spin { 0% { transform: rotate(0deg); } 50%, 75% { opacity: 0.5; } 100% { transform: rotate(360deg); } }
                </style>
                <rect width="1" height="1" style="animation: spin 1s linear infinite;"/>
            </svg>"#,
        );
        let result = import_svg(&path).unwrap();
        assert_eq!(result.features.css_animation_rule_count, 3);
        assert_eq!(result.features.external_font_faces, vec!["fonts/ext.woff2"]);
        assert!(result
            .warnings
            .iter()
            .any(|w| w.code == "external-font-face"));
    }

    #[test]
    fn inlines_local_raster_image_and_leaves_data_uri_alone() {
        let dir = tempdir();
        // A 1x1 transparent PNG.
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let mut file = fs::File::create(dir.path().join("swatch.png")).unwrap();
        file.write_all(png_bytes).unwrap();

        let path = write_temp(
            dir.path(),
            "external-image.svg",
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
                <image xlink:href="swatch.png" width="10" height="10"/>
                <image href="data:image/png;base64,QUJD" width="1" height="1"/>
                <image href="missing.png" width="1" height="1"/>
            </svg>"#,
        );
        let result = import_svg(&path).unwrap();
        assert_eq!(result.inlined_asset_count, 1);
        assert!(result.text.contains("data:image/png;base64,"));
        assert!(!result.text.contains("swatch.png"));
        // The already-data: reference must be left untouched.
        assert!(result.text.contains("data:image/png;base64,QUJD"));
        assert_eq!(
            result.features.unresolved_external_refs,
            vec!["missing.png"]
        );
        assert!(result
            .warnings
            .iter()
            .any(|w| w.code == "unresolved-external-ref"));
    }

    /// Minimal temp-dir helper: no dev-dependency on `tempfile` exists yet
    /// in this crate, and these tests only need a scratch directory that
    /// cleans itself up.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn tempdir() -> TempDir {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "spindle-lab-svg-import-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }
}
