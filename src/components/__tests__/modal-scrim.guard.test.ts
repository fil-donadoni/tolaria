// #1891 — the ONE modal scrim treatment. Every full-screen modal scrim must
// use the shared `modal-scrim` utility (`src/index.css`: scrim color + heavy
// backdrop blur + an opaque-ish fallback where `backdrop-filter` is
// unsupported). Before this guard, scrim styling drifted per file: the
// library-order picker and the trigger-order prompt shipped a bare
// translucent `bg-scrim` with NO blur — on a phone the live board (stack
// panel, cards, prompts) bled through and the picker was unreadable — while
// other overlays each picked their own blur strength (`xs`, `sm`).
//
// The sweep reads component SOURCE (jsdom loads no CSS, so a rendered-style
// assertion is impossible here) and fails on any bare `bg-scrim` left in a
// component — the drift this class of bug grows back from. The utility's own
// definition is asserted alongside so the class the components rely on
// actually exists and keeps its heavy blur.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const moduleUrl = import.meta.url;
const SRC_ROOT = new URL("../..", moduleUrl).pathname;

/** Recursively collect component/source files under src/, skipping tests. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...sourceFiles(full));
        } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

describe("modal scrim carries the heavy blur (#1891)", () => {
    it("no component uses a bare `bg-scrim` — the shared `modal-scrim` utility is the only scrim spelling", () => {
        const offenders = sourceFiles(join(SRC_ROOT, "components")).filter(
            (file) => readFileSync(file, "utf8").includes("bg-scrim")
        );
        expect(offenders).toEqual([]);
    });

    it("the `modal-scrim` utility exists in index.css with a heavy blur and an unsupported-backdrop-filter fallback", () => {
        const css = readFileSync(join(SRC_ROOT, "index.css"), "utf8");
        const utility = css.match(/\.modal-scrim\s*\{[^}]*\}/g);
        expect(utility, ".modal-scrim utility missing").not.toBeNull();
        const [main] = utility!;
        expect(main).toContain("var(--color-scrim)");
        // Heavy blur: at least 12px on both the standard and -webkit- names.
        const blurs = [
            ...main!.matchAll(/backdrop-filter:\s*blur\((\d+)px\)/g),
        ];
        expect(blurs.length).toBeGreaterThanOrEqual(2);
        for (const b of blurs) expect(Number(b[1])).toBeGreaterThanOrEqual(12);
        // Fallback: when backdrop-filter is unsupported the blur no-ops, so
        // the scrim itself must darken to restore contrast.
        expect(css).toMatch(
            /@supports\s+not\s*\(\s*\(backdrop-filter[\s\S]*?\.modal-scrim\s*\{[^}]*rgb\(0 0 0 \/ 0\.8/
        );
    });

    it("every known full-screen overlay site uses the shared utility", () => {
        // The seven sites the #1891 sweep migrated — a rename or a new copy
        // that drops back to ad-hoc scrim styling fails here by name.
        const SITES = [
            "components/board/library-order/library-order-picker.tsx",
            "components/board/trigger-order-prompt.tsx",
            "components/board/random-reveal-overlay.tsx",
            "components/board/reveal-notification-overlay.tsx",
            "components/cards/card-preview.tsx",
            "components/ui/dialog.tsx",
            "components/ui/action-sheet.tsx",
            // Anchored choice popovers (review finding): their full-screen
            // click-catcher had NO scrim at all — the board bled through the
            // open picker exactly like the bare-`bg-scrim` overlays did.
            "components/board/mana-choice-picker.tsx",
            "components/cards/phyrexian-picker.tsx",
        ];
        for (const site of SITES) {
            const src = readFileSync(join(SRC_ROOT, site), "utf8");
            expect(src, `${site} must use modal-scrim`).toContain(
                "modal-scrim"
            );
        }
    });
});
