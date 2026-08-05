// Issue #2056 DoD: "All four card-size sites route through the shared
// floor; no literal `9dvh` / `9.5dvh` clamp survives outside src/index.css
// (grep proves it)." This is that grep, made permanent so a future card-size
// site can't quietly reintroduce the un-floored `min(...)` literal that
// collapsed tiles to 27.3px at 852x303.
//
// `src/index.css`'s own `--card-w: min(8rem, 10vw, 9.5dvh)` (the board's
// global, deliberately out of scope — the board has its own orientation
// machinery that depends on cards shrinking with height) is a `.css` file,
// outside this scan's `.ts`/`.tsx` glob, so it's excluded by construction.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cardBase } from "../cardSizing";

const SRC_ROOT = join(__dirname, "..", "..");

// The board is explicitly out of scope for issue #2056 (ADR-level: its
// landscape machinery depends on cards shrinking with height) — excluded
// from the scan, not merely un-migrated.
const EXCLUDED_DIRS = [join(SRC_ROOT, "components", "board")];

// A bare `min(...)` clamp with a numeric viewport-height term (`vh`, `dvh`,
// `svh`, or `lvh`) — the exact shape that let the viewport-height term
// collapse the tile below legibility. Two things this must NOT require,
// because a real-world review found both wrong in an earlier version of this
// regex: (1) the viewport-height term does not have to be the LAST argument
// — `min(9dvh, 7.5rem, 17vw)` collapses the tile exactly the same as
// `min(7.5rem, 17vw, 9dvh)`, so `[^()]*` surrounds the unit term on BOTH
// sides, not just before it; (2) it is not `dvh`-only — `vh`/`svh`/`lvh`
// collapse the same way and must all be caught. The negative lookbehind
// excludes a `max(..., min(...))`-wrapped occurrence (the `cardBase()`
// output, already floored) — JS regex lookbehind is unbounded, so this
// correctly skips any amount of text between `max(` and the `min(` it wraps,
// as long as there's no closing `)` in between.
const BARE_DVH_CLAMP =
    /(?<!max\([^()]*)min\([^()]*\d(\.\d+)?(dvh|svh|lvh|vh)[^()]*\)/;

/**
 * Strip comments before scanning, so PROSE about a clamp is never read as a
 * shipped clamp. Without this the guard forced every author who wanted to
 * DISCUSS the un-floored shape (in a comment explaining why some other
 * literal is fine) to euphemise it instead — which is how
 * `lib/shellLayout.ts` ended up unable to name the two fractional-viewport
 * literals it exempts. The sibling guard added by issue #2274
 * (`shell-height-claims.guard.test.tsx`) already scans this way; this is the
 * same treatment, not a new idea.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (EXCLUDED_DIRS.includes(full)) continue;
        const stat = statSync(full);
        if (stat.isDirectory()) {
            collectSourceFiles(full, out);
        } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
            // Test files are excluded: several of THIS guard's own sibling
            // tests deliberately hold the literal `min(7.5rem, 17vw, 9dvh)`
            // string (the pre-fix shape) to assert the regex still catches
            // it — that's fixture text, not a shipped clamp.
            out.push(full);
        }
    }
    return out;
}

describe("card-size clamp — no un-floored dvh literal survives (issue #2056)", () => {
    it("every .ts/.tsx source file under src/ (excluding src/components/board) is free of a bare min(...dvh) clamp", () => {
        const offenders: string[] = [];
        for (const file of collectSourceFiles(SRC_ROOT)) {
            const text = stripComments(readFileSync(file, "utf8"));
            if (BARE_DVH_CLAMP.test(text)) {
                offenders.push(relative(SRC_ROOT, file));
            }
        }
        expect(offenders).toEqual([]);
    });

    it("scans CODE, not prose — a clamp QUOTED in a comment is not a shipped clamp, but the same literal in a code line still is", () => {
        // The half that matters is the second one: stripping comments must not
        // also swallow the code the guard exists to read. `shellLayout.ts`
        // holds the first shape today (it names the fractional-viewport
        // literals it deliberately exempts) — revert `stripComments` and this
        // guard goes red on it.
        expect(
            BARE_DVH_CLAMP.test(
                stripComments(
                    "// h-[min(30rem,60vh)] is a FRACTION, not a bad clamp"
                )
            )
        ).toBe(false);
        expect(
            BARE_DVH_CLAMP.test(
                stripComments(
                    'const w = "min(7.5rem, 17vw, 9dvh)"; // the collapsing shape'
                )
            )
        ).toBe(true);
    });

    it("cardSizing.ts's own cardBase() output IS a max()-wrapped clamp, not a bare min() — sanity-checks the guard's own regex isn't just failing to match anything", () => {
        const sample = cardBase("7.5rem", "17vw", "9dvh");
        expect(BARE_DVH_CLAMP.test(sample)).toBe(false);
        expect(BARE_DVH_CLAMP.test(`min(7.5rem, 17vw, 9dvh)`)).toBe(true);
    });

    // A prior version of this regex required the viewport-height term to be
    // the LAST argument (`min\([^()]*\d(\.\d+)?dvh\)`), which meant a
    // reordered clamp — `min(9dvh, 7.5rem, 17vw)` — matched nothing and the
    // guard stayed green while shipping the exact bug it exists to catch.
    // Reviewer-proven mutation: reordering a real call site's arguments left
    // the old regex green. These pin the widened behaviour.
    it("catches the viewport-height term in ANY position, not only last", () => {
        expect(BARE_DVH_CLAMP.test("min(9dvh, 7.5rem, 17vw)")).toBe(true);
        expect(BARE_DVH_CLAMP.test("min(7.5rem, 9dvh, 17vw)")).toBe(true);
        expect(BARE_DVH_CLAMP.test("min(7.5rem, 17vw, 9dvh)")).toBe(true);
    });

    it("catches vh/svh/lvh, not only dvh", () => {
        expect(BARE_DVH_CLAMP.test("min(7.5rem, 17vw, 9vh)")).toBe(true);
        expect(BARE_DVH_CLAMP.test("min(7.5rem, 17vw, 9svh)")).toBe(true);
        expect(BARE_DVH_CLAMP.test("min(7.5rem, 17vw, 9lvh)")).toBe(true);
        expect(BARE_DVH_CLAMP.test("min(9svh, 7.5rem, 17vw)")).toBe(true);
    });

    it("still does not false-positive on a max()-wrapped clamp regardless of the viewport-height term's position inside the min()", () => {
        expect(
            BARE_DVH_CLAMP.test("max(4.5rem, min(9dvh, 7.5rem, 17vw))")
        ).toBe(false);
        expect(
            BARE_DVH_CLAMP.test("max(4.5rem, min(7.5rem, 9svh, 17vw))")
        ).toBe(false);
    });
});
