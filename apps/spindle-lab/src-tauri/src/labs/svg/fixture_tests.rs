// End-to-end smoke coverage: runs `svg_import` against every fixture in
// `fixtures/svg/` (docs/plan.md §7) and checks the feature report each one
// is meant to exercise. This is the "manually exercise the import path"
// verification for M2, kept as permanent regression coverage rather than a
// one-off script.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::{Path, PathBuf};

use super::import::import_svg;

fn fixture(name: &str) -> PathBuf {
    Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/svg"
    ))
    .join(name)
}

#[test]
fn every_fixture_imports_without_error() {
    let fixtures = [
        "smil-transform.svg",
        "smil-values.svg",
        "smil-motion.svg",
        "smil-path-morph.svg",
        "css-keyframes.svg",
        "mixed-smil-css.svg",
        "external-image.svg",
        "foreign-object.svg",
        "scripted.svg",
        "no-viewbox.svg",
    ];
    for name in fixtures {
        let path = fixture(name);
        let result = import_svg(&path);
        assert!(
            result.is_ok(),
            "{name} failed to import: {:?}",
            result.err()
        );
    }
}

#[test]
fn smil_fixtures_are_detected_as_smil() {
    for name in [
        "smil-transform.svg",
        "smil-values.svg",
        "smil-motion.svg",
        "smil-path-morph.svg",
    ] {
        let result = import_svg(&fixture(name)).unwrap();
        assert!(
            result.features.smil_animation_count > 0,
            "{name} should contain at least one SMIL animation element"
        );
        assert_eq!(
            result.features.css_animation_rule_count, 0,
            "{name} has no CSS animation"
        );
        assert!(
            !result.features.has_script,
            "{name} should not be flagged as scripted"
        );
    }
}

#[test]
fn css_keyframes_fixture_is_detected_as_css_animation() {
    let result = import_svg(&fixture("css-keyframes.svg")).unwrap();
    assert!(result.features.css_animation_rule_count > 0);
    assert_eq!(result.features.smil_animation_count, 0);
}

#[test]
fn mixed_fixture_is_detected_as_both_engines() {
    let result = import_svg(&fixture("mixed-smil-css.svg")).unwrap();
    assert!(result.features.smil_animation_count > 0);
    assert!(result.features.css_animation_rule_count > 0);
}

#[test]
fn external_image_fixture_is_fully_inlined() {
    let result = import_svg(&fixture("external-image.svg")).unwrap();
    assert!(result.inlined_asset_count >= 1);
    assert!(result.features.unresolved_external_refs.is_empty());
    assert!(result.text.contains("data:image/png;base64,"));
    // The rewritten href/xlink:href value must no longer point at the
    // sibling file by name -- that would render blank in the eventual bake
    // (docs/plan.md §4.4). (The fixture's own comment mentions the filename
    // for documentation purposes, so check the attribute value specifically
    // rather than the whole text.)
    assert!(!result.text.contains("href=\"swatch.png\""));
}

#[test]
fn foreign_object_fixture_warns() {
    let result = import_svg(&fixture("foreign-object.svg")).unwrap();
    assert!(result.features.has_foreign_object);
    assert!(result.warnings.iter().any(|w| w.code == "foreign-object"));
}

#[test]
fn scripted_fixture_is_flagged_but_still_imports() {
    let result = import_svg(&fixture("scripted.svg")).unwrap();
    assert!(
        result.features.has_script,
        "scripted.svg should be detected as script-bearing"
    );
    // svg_import succeeds regardless -- refusing to preview is a UI-layer
    // decision (docs/plan.md §4.1 / the M2 task brief), not a command error.
}

#[test]
fn no_viewbox_fixture_warns_about_missing_sizing() {
    let result = import_svg(&fixture("no-viewbox.svg")).unwrap();
    assert!(result.features.intrinsic_width.is_none());
    assert!(result.features.intrinsic_height.is_none());
    assert!(result.features.view_box.is_none());
    assert!(result.warnings.iter().any(|w| w.code == "missing-sizing"));
}
