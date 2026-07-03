import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Smoke test for the resolve()→effects[] migration classifier
// (`scripts/migration-classifier.mjs`, PRD #795 / #826, playbook #809). The
// classifier is the single source of truth for the bulk-migration worklist,
// so a regression in it must fail like any other script (prior art:
// scripts/__tests__/json-to-cards.test.ts, list-to-cards.test.ts).
//
// This asserts EXTERNAL behaviour — the census bucket totals, the FREE ⊎
// X-only ⊎ Op-blocked partition invariant, and the routing of a known card —
// never the parser internals (balanced-brace extraction, the fold table).
// The exact totals are a committed baseline snapshot: they drift DOWN as Ops
// ship and cards migrate (the whole point of the tool), so a migration PR that
// moves a card between buckets updates the number here — the check exists to
// catch an accidental regression (e.g. the parser silently returning 0), not
// to freeze the catalogue.

const SCRIPT = join(process.cwd(), "scripts", "migration-classifier.mjs");

function run(...args: string[]): string {
    return execFileSync("bun", [SCRIPT, ...args], { encoding: "utf-8" });
}

/** Pulls the integer following a summary label out of the classifier's
 *  default (summary) stdout. */
function num(summary: string, label: RegExp): number {
    const m = summary.match(label);
    expect(m, `label ${label} not found in classifier output`).not.toBeNull();
    return Number(m![1]);
}

describe("migration classifier — census buckets (PRD #826)", () => {
    const summary = run();

    it("parses the whole catalogue without crashing and reports a closure total", () => {
        const total = num(summary, /—\s+(\d+)\s+closures/);
        expect(total).toBeGreaterThan(0);
    });

    it("buckets partition the closure total (FREE ⊎ X-only ⊎ Op-blocked = total)", () => {
        const total = num(summary, /—\s+(\d+)\s+closures/);
        const free = num(summary, /FREE \(migratable now\):\s+(\d+)/);
        const xOnly = num(summary, /X-only blocked:\s+(\d+)/);
        const opBlocked = num(summary, /Op-blocked:\s+(\d+)/);
        // Every closure lands in exactly one bucket — the classifier's core
        // contract (a closure is FREE, X-only, or Op-blocked, never two).
        expect(free + xOnly + opBlocked).toBe(total);
    });

    it("AFK-ready (has-test) free cards never exceed the free total", () => {
        const free = num(summary, /FREE \(migratable now\):\s+(\d+)/);
        const ready = num(summary, /of which AFK-ready:\s+(\d+)/);
        const needTest = num(summary, /need test first:\s+(\d+)/);
        expect(ready).toBeLessThanOrEqual(free);
        expect(ready + needTest).toBe(free);
    });

    // Committed baseline snapshot (bun scripts/migration-classifier.mjs at
    // #826 authoring time). Update DOWNWARD as migration proceeds.
    it("reports the committed baseline bucket totals", () => {
        expect(num(summary, /—\s+(\d+)\s+closures/)).toBe(900);
        expect(num(summary, /FREE \(migratable now\):\s+(\d+)/)).toBe(265);
        expect(num(summary, /of which AFK-ready:\s+(\d+)/)).toBe(242);
        expect(num(summary, /X-only blocked:\s+(\d+)/)).toBe(15);
        expect(num(summary, /Op-blocked:\s+(\d+)/)).toBe(620);
    });

    it("surfaces the demonstrated new-Op backlog (top blocker is the pump primitive)", () => {
        // The most-blocking primitive is addTemporaryPTBuff (the `pump` Op) —
        // a stable, high-frequency signal that the Op backlog is being read.
        expect(summary).toMatch(/New-Op backlog/);
        expect(summary).toMatch(/addTemporaryPTBuff/);
    });
});

describe("migration classifier — known-card routing (PRD #826)", () => {
    const free = run("--free");

    it("routes a draw spell (Night's Whisper) to the FREE tranche", () => {
        // Night's Whisper's effect is draw + lose-life — every clause maps onto
        // an existing Op (`draw`, `loseLife`), so it is migratable now with no
        // new engine code. (Canary: this asserts a specific still-resolve() card
        // lands in FREE; when it eventually migrates, swap for another
        // existing-Op-only card that has not yet been migrated.)
        expect(free).toMatch(/Night's Whisper/);
    });

    it("does NOT route an Op-blocked card (Giant Growth) to the FREE tranche", () => {
        // Giant Growth calls ctx.addTemporaryPTBuff — blocked on the unshipped
        // `pump` Op, so it belongs to that Op's cluster issue, not the free
        // tranche.
        expect(free).not.toMatch(/Giant Growth/);
    });
});
