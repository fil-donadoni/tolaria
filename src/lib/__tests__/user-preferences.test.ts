// Shared vocabulary for the Settings surface (issue #2595): defaults and the
// `applyDocumentPreferences` mechanism that publishes density/motion onto
// `<html>` as `[data-density]`/`[data-motion]` — the "switch the tokens
// live" half of the acceptance criteria (`src/index.css` reads these).
import { describe, it, expect } from "vitest";
import {
    applyDocumentPreferences,
    DEFAULT_DENSITY_PREFERENCE,
    DEFAULT_MOTION_PREFERENCE,
    DEFAULT_PREVIEW_PREFERENCE,
    DENSITY_PREFERENCE_OPTIONS,
    MOTION_PREFERENCE_OPTIONS,
    PREVIEW_PREFERENCE_OPTIONS,
} from "../user-preferences";

describe("applyDocumentPreferences", () => {
    it("writes density and motion onto the given root's dataset", () => {
        const root = { dataset: {} as DOMStringMap };
        applyDocumentPreferences(root, "compact", "reduced");
        expect(root.dataset.density).toBe("compact");
        expect(root.dataset.motion).toBe("reduced");
    });

    it("overwrites a previously-applied preference (a Settings change takes effect live)", () => {
        const root = { dataset: {} as DOMStringMap };
        applyDocumentPreferences(root, "roomy", "system");
        applyDocumentPreferences(root, "compact", "reduced");
        expect(root.dataset.density).toBe("compact");
        expect(root.dataset.motion).toBe("reduced");
    });
});

describe("defaults", () => {
    it("match the app's previous hard-coded values, so a user who never opens Settings sees no change", () => {
        expect(DEFAULT_DENSITY_PREFERENCE).toBe("roomy");
        expect(DEFAULT_MOTION_PREFERENCE).toBe("system");
        expect(DEFAULT_PREVIEW_PREFERENCE).toBe("computed");
    });
});

describe("option lists", () => {
    it("every default value is present among its own option list", () => {
        expect(DENSITY_PREFERENCE_OPTIONS.map((o) => o.value)).toContain(
            DEFAULT_DENSITY_PREFERENCE
        );
        expect(MOTION_PREFERENCE_OPTIONS.map((o) => o.value)).toContain(
            DEFAULT_MOTION_PREFERENCE
        );
        expect(PREVIEW_PREFERENCE_OPTIONS.map((o) => o.value)).toContain(
            DEFAULT_PREVIEW_PREFERENCE
        );
    });
});
