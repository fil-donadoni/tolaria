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

// A bare `min(...)` clamp with a numeric `dvh` term — the exact shape that
// let the viewport-height term collapse the tile below legibility. The
// negative lookbehind excludes a `max(..., min(...))`-wrapped occurrence
// (the `cardBase()` output, already floored) — JS regex lookbehind is
// unbounded, so this correctly skips any amount of text between `max(` and
// the `min(` it wraps, as long as there's no closing `)` in between.
const BARE_DVH_CLAMP = /(?<!max\([^()]*)min\([^()]*\d(\.\d+)?dvh\)/;

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
            const text = readFileSync(file, "utf8");
            if (BARE_DVH_CLAMP.test(text)) {
                offenders.push(relative(SRC_ROOT, file));
            }
        }
        expect(offenders).toEqual([]);
    });

    it("cardSizing.ts's own cardBase() output IS a max()-wrapped clamp, not a bare min() — sanity-checks the guard's own regex isn't just failing to match anything", () => {
        const sample = cardBase("7.5rem", "17vw", "9dvh");
        expect(BARE_DVH_CLAMP.test(sample)).toBe(false);
        expect(BARE_DVH_CLAMP.test(`min(7.5rem, 17vw, 9dvh)`)).toBe(true);
    });
});
