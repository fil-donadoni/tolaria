import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// CR 701.21a guard — a FILTERED sacrifice (a choice of which permanent to
// sacrifice) must route through the unified selection layer so no seam can
// silently auto-pick. Raw `removePermanentTo(…, "sacrifice")` is allowed ONLY at
// the sanctioned sites below: the single unified executor, and fixed-victim
// sacrifices (self / edict target / resolve-time interpreter choice) where there
// is no filtered choice to make. A NEW filtered auto-pick must be added to the
// unified layer, not the allowlist — this test fails on any other new site.
const convexRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Relative-to-`convex/` paths permitted to call
 *  removePermanentTo(…, "sacrifice") directly. Every entry is a fixed-victim
 *  site (no filtered choice) or the unified executor itself. */
const ALLOW = new Set<string>([
    // The one place a chosen filtered sacrifice is executed (CR 701.21a).
    "gre/sacrificeChoice.ts",
    // Fixed-victim sites: the effect names the permanent (self / target),
    // there is no "which one?" choice for the player to make.
    "game.ts", // fixed-self ability sacrifice, edict target
    "gre/state.ts", // ctx.sacrifice(id) primitive + rule-driven sacrifices
    "gre/effects/interpreter.ts", // resolve-time `sacrifice` Op (choice-driven)
    "gre/sba.ts", // state-based sacrifice (CR 704) — no choice
    // Bot ISMCTS search slice: a deterministic evaluation-only approximation
    // (lowest-mv pick), NOT the authoritative game action (game.ts routes the
    // real player choice through the unified layer). Out of scope for 701.21a.
    "gre/applyMove.ts",
]);

// Tolerate entries that vanish mid-walk. A parallel test worker
// (scripts/__tests__/json-to-cards.test.ts) creates and then removes a
// throwaway set directory under convex/cards/sets/ while this guard walks the
// same tree, so a name listed by readdirSync can be gone by the time we stat /
// recurse into it (ENOENT). Skip such entries rather than crashing — the guard
// only needs the committed .ts files, none of which are the transient dir.
function walk(dir: string): string[] {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return []; // directory removed mid-walk
    }
    return entries.flatMap((f) => {
        const p = join(dir, f);
        const stat = statSync(p, { throwIfNoEntry: false });
        if (!stat) return []; // entry removed between readdir and stat
        return stat.isDirectory() ? walk(p) : [p];
    });
}

describe("sacrifice routing guard (CR 701.21a)", () => {
    it("removePermanentTo(sacrifice) appears only at sanctioned sites", () => {
        const pattern = /removePermanentTo\([^;]*"sacrifice"/;
        const offenders: string[] = [];
        for (const file of walk(convexRoot)) {
            if (!file.endsWith(".ts")) continue;
            if (file.includes("__tests__")) continue;
            if (file.includes("_generated")) continue;
            const rel = file.slice(convexRoot.length + 1);
            const src = readFileSync(file, "utf8");
            if (pattern.test(src) && !ALLOW.has(rel)) {
                offenders.push(rel);
            }
        }
        expect(offenders).toEqual([]);
    });
});
