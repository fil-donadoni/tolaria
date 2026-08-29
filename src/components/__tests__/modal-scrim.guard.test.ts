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

/** Line and block comments removed from a `.tsx`/`.ts` source string, string
 *  and template-literal contents left untouched — a state-machine scan, not a
 *  regex, so a double-slash inside a quoted string or a URL (`"https://…"`)
 *  is never mistaken for a line comment. `design-tokens.test.ts`'s
 *  `stripComments` strips CSS block comments only; component sources also
 *  carry line comments, which is exactly where this guard's per-site check
 *  got fooled (review finding, #2731 round 1): a site whose real `className`
 *  had its `modal-scrim` token reverted to a bare `bg-black/50` still passed
 *  because an explanatory comment above it also said the words
 *  "modal-scrim". */
function stripCodeComments(source: string): string {
    let out = "";
    let i = 0;
    const n = source.length;
    while (i < n) {
        const two = source.slice(i, i + 2);
        if (two === "//") {
            while (i < n && source[i] !== "\n") i++;
            continue;
        }
        if (two === "/*") {
            const end = source.indexOf("*/", i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        const ch = source[i];
        if (ch === '"' || ch === "'" || ch === "`") {
            const quote = ch;
            out += ch;
            i++;
            while (i < n) {
                const c = source[i];
                out += c;
                i++;
                if (c === "\\") {
                    // Escaped char (e.g. `\"` or `\\`) — copy it verbatim and
                    // keep scanning; it never closes the string.
                    if (i < n) {
                        out += source[i];
                        i++;
                    }
                    continue;
                }
                if (c === quote) break;
            }
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

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
            // Mode / alt-cost / Phyrexian / additional-cost cast-time pickers
            // (issue #2731), joined by the mana-choice picker (issue #2920),
            // all delegate their popover shell to the shared `AnchoredPicker`
            // primitive, so the scrim now lives ONCE there instead of once
            // per picker file — none of the five contain the literal string
            // themselves any more.
            "components/ui/anchored-picker.tsx",
            // The bespoke controller phase sheet (ADR 0103 §5, issue #2731) —
            // it used to paint its own flat `bg-black/50` with no blur.
            "components/board/controller-phase-sheet.tsx",
        ];
        for (const site of SITES) {
            const src = readFileSync(join(SRC_ROOT, site), "utf8");
            // Comments stripped FIRST: a file can carry the literal string
            // `modal-scrim` only in an explanatory comment while its actual
            // `className` was reverted to a bare `bg-black/50` — the check
            // must fail in that case, not read the prose as the code.
            expect(
                stripCodeComments(src),
                `${site} must use modal-scrim in its actual code, not only in a comment`
            ).toContain("modal-scrim");
        }
    });

    it("stripCodeComments strips // and /* */ comments but leaves string/template contents — including a `//` inside a URL — untouched", () => {
        const source = [
            "// a leading line comment mentioning modal-scrim",
            'const url = "https://example.com/modal-scrim";',
            "/* a block comment mentioning modal-scrim */",
            'const cls = "real-modal-scrim-usage"; // trailing comment',
            "const tmpl = `also has // not a comment inside`;",
        ].join("\n");
        const stripped = stripCodeComments(source);
        expect(stripped).not.toContain("a leading line comment");
        expect(stripped).not.toContain("a block comment");
        expect(stripped).not.toContain("trailing comment");
        // The URL's `//` must survive — it is string content, not a comment.
        expect(stripped).toContain("https://example.com/modal-scrim");
        expect(stripped).toContain("real-modal-scrim-usage");
        expect(stripped).toContain("also has // not a comment inside");
    });
});
