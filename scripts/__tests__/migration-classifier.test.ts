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
    // #838 (delayedTrigger Op + ADR 0048, on top of #839's moveZone): Rocket
    // Launcher + Urza's Bauble migrated (−3 closures: 2 scheduling + 1
    // template body), and the delayed-body union + grammar-gap
    // pseudo-blockers keep the remaining scheduling closures truthfully
    // Op-blocked ($eventFieldCapture: Venom, Battering Ram, Nafs Asp,
    // Seraph, Krovikan Vampire; $listCapture: Venomous Breath).
    // #840 (pump Op): addTemporaryPTBuff is now a COVERED Op — the pump
    // cluster's closures moved from Op-blocked to FREE, and the ~59
    // cleanly-expressible ones were migrated away (total closures 842→783;
    // Op-blocked 583→497). The remaining FREE pump closures are the
    // aura-pumps (getAttachedTo — blocked on an attached-object selector, a
    // classifier read the tool counts as harmless) and count/colour/combat-
    // role-scaled pumps not expressible by the current value grammar.
    it("reports the committed baseline bucket totals", () => {
        expect(num(summary, /—\s+(\d+)\s+closures/)).toBe(783);
        expect(num(summary, /FREE \(migratable now\):\s+(\d+)/)).toBe(270);
        expect(num(summary, /of which AFK-ready:\s+(\d+)/)).toBe(245);
        expect(num(summary, /X-only blocked:\s+(\d+)/)).toBe(16);
        expect(num(summary, /Op-blocked:\s+(\d+)/)).toBe(497);
    });

    it("surfaces the demonstrated new-Op backlog (top blocker is the counters primitive)", () => {
        // pump SHIPPED (issue #840): addTemporaryPTBuff is now a COVERED Op
        // (it appears in the "Covered Ops" line, no longer in the backlog). The
        // most-blocking remaining primitive is addCounter (the `counters` Op) —
        // a stable, high-frequency signal that the Op backlog is being read.
        expect(summary).toMatch(/New-Op backlog/);
        expect(summary).toMatch(/addCounter/);
        expect(summary).toMatch(/Covered Ops[^\n]*addTemporaryPTBuff/);
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

    it("does NOT route an Op-blocked card (Sengir Vampire) to the FREE tranche", () => {
        // Sengir Vampire calls ctx.addCounter — blocked on the unshipped
        // `counters` Op, so it belongs to that Op's cluster issue, not the free
        // tranche. (Canary swapped from Giant Growth, which migrated once the
        // `pump` Op shipped — issue #840.)
        expect(free).not.toMatch(/Sengir Vampire/);
    });
});
