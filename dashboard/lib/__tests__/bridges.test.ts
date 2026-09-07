import { describe, it, expect } from "vitest";
import * as tabsBridge from "../../../scripts/dashboard/tabs.js";
import * as themeBridge from "../../../scripts/dashboard/theme.js";
import { switchView, viewFromParams, VIEWS, DEFAULT_VIEW } from "../view";
import { onThemeChange } from "../theme";

/**
 * The bridges (PRD #3148 S1).
 *
 * `scripts/dashboard/tabs.js` and `theme.js` are now one-line re-exports, and
 * the modules that import them — `shortcuts.js` (#2635) and `history-boot.js`
 * — are unlinted plain JavaScript (`eslint.config.js` scopes every rule to
 * `**\/*.{ts,tsx}`). So a re-export that dropped a name would not fail the type
 * check, would not fail lint, and would not fail any existing test: it would
 * throw at import time in a real browser, on the keyboard shortcut nobody runs
 * in CI.
 *
 * These assert IDENTITY, not merely presence. Two functions both named
 * `switchView` — the bridge re-exporting a stale copy — is the shape where a
 * tab click and a `1` keystroke drive different stores, which is precisely
 * what one authority is for.
 */

describe("the vanilla bridges re-export the store, not a copy", () => {
    it("tabs.js gives shortcuts.js exactly what it imports, and the same objects", () => {
        expect(tabsBridge.switchView).toBe(switchView);
        expect(tabsBridge.viewFromParams).toBe(viewFromParams);
        expect(tabsBridge.VIEWS).toBe(VIEWS);
        expect(tabsBridge.DEFAULT_VIEW).toBe(DEFAULT_VIEW);
    });

    it("theme.js gives history-boot.js the listener registry it imports", () => {
        expect(themeBridge.onThemeChange).toBe(onThemeChange);
    });

    it("the bridges export NO initialiser — a surviving initTabs/initTheme would run beside React and fight it for the DOM", () => {
        expect("initTabs" in tabsBridge).toBe(false);
        expect("initTheme" in themeBridge).toBe(false);
    });
});
