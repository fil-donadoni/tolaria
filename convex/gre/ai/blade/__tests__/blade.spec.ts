/**
 * Blade-scenario suite — the runnable suite (issue #1427, PRD #1423).
 *
 * NOT part of `bun run test`. Run it with:
 *   bun run test:blade           → `must` tier, real assertions, BLOCKING
 *   bun run test:blade:stretch   → `stretch` tier, report-only in CI (the
 *                                   `blade-stretch` job runs it with
 *                                   `continue-on-error: true`, so nothing it
 *                                   does blocks a merge). Every scenario's own
 *                                   verdict is printed, never asserted — with
 *                                   one exception: a `beyondBudget` entry's
 *                                   claim ("still fails at its declared
 *                                   budget") IS asserted here, so a bot
 *                                   improvement surfaces as a red stretch
 *                                   check plus a promotion hint, never as a
 *                                   red `must` check (issue #1517).
 *
 * The tier is selected by the `BLADE_TIER` env var (default `must`) so both
 * modes share one spec file and one config — see `vitest.blade.config.ts`.
 */

import { describe, expect, it } from "vitest";
import {
    BLADE_SCENARIOS,
    bladeScenariosForTier,
    describeBeyondBudget,
    runBladeScenario,
    type BladeScenario,
    type BladeTier,
} from "..";

const TIER = (process.env.BLADE_TIER ?? "must") as BladeTier;

if (TIER !== "must" && TIER !== "stretch") {
    throw new Error(
        `BLADE_TIER must be "must" or "stretch" (got "${process.env.BLADE_TIER}").`
    );
}

const scenarios = bladeScenariosForTier(TIER);

describe(`blade suite — registry integrity`, () => {
    it("every entry has a unique label", () => {
        const labels = BLADE_SCENARIOS.map((s) => s.label);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it("every entry uses an iterations budget, never wall-clock", () => {
        for (const s of BLADE_SCENARIOS) {
            expect(
                s.budget.iterations,
                `${s.label}: iterations must be positive`
            ).toBeGreaterThan(0);
            // A `timeMs` budget would make the chosen move machine-dependent.
            expect(
                Object.keys(s.budget),
                `${s.label}: budget must declare iterations only`
            ).toEqual(["iterations"]);
        }
    });

    it("no `must` entry claims to be beyond its budget (ADR 0070 §2)", () => {
        // A `must` entry passes at its declared, production-range budget by
        // definition. Recording a beyond-budget cause on one would mean the
        // blocking tier is green only above production — the exact thing the
        // budget rule exists to prevent.
        for (const s of BLADE_SCENARIOS) {
            if (s.tier !== "must") continue;
            expect(
                s.beyondBudget,
                `${s.label}: a beyond-budget entry belongs in the stretch tier`
            ).toBeUndefined();
        }
    });

    it("a beyond-budget entry classifies its cause with a budget it actually exceeds", () => {
        // Shape only — cheap, no search. Safe to run in BOTH the blocking
        // `must` job and the report-only `stretch` job. The behavior-
        // dependent part (does it really still fail at `budget`?) lives in
        // the stretch-tier loop below (issue #1517) — running a real ISMCTS
        // search here, unconditionally, is what let a bot IMPROVEMENT redden
        // the blocking job.
        for (const s of BLADE_SCENARIOS) {
            if (!s.beyondBudget) continue;
            expect(
                ["branching", "horizon", "hidden-information"],
                `${s.label}: unknown beyond-budget cause`
            ).toContain(s.beyondBudget.cause);
            expect(
                s.beyondBudget.passesAt.iterations,
                `${s.label}: passesAt must exceed the declared budget`
            ).toBeGreaterThan(s.budget.iterations);
            // The `note` is deliberately left unasserted. No mechanical check
            // distinguishes "names the missing knowledge" from 20+ characters
            // of filler, and the old `note.length > 20` only pretended to —
            // the honesty check below (stretch tier only) is what actually
            // enforces the claim, not a string length.
        }
    });

    it("every discriminating-pair entry names its partner (issue #1487)", () => {
        // A pair half is only meaningful WITH its partner: a bot that never
        // casts passes the forbidden half, one that always casts passes the
        // expected half. Naming the partner in the note makes deleting one
        // half obvious in the diff instead of silently gutting the other.
        const pair = BLADE_SCENARIOS.filter((s) =>
            s.label.startsWith("discriminating pair:")
        );
        expect(pair.length).toBeGreaterThanOrEqual(2);
        for (const s of pair) {
            const partner = pair.find(
                (o) => o !== s && s.note?.includes(o.label)
            );
            expect(
                partner,
                `${s.label}: its note must quote its partner entry's label`
            ).toBeDefined();
        }
    });
});

describe(`blade suite — ${TIER} tier`, () => {
    if (scenarios.length === 0) {
        it(`has no ${TIER} scenarios registered`, () => {
            expect(scenarios).toHaveLength(0);
        });
    }

    for (const scenario of scenarios) {
        it(scenario.label, () => {
            const result = runBladeScenario(scenario);
            if (TIER === "stretch") {
                // Report-only: a stretch entry documents a position the bot is
                // not expected to solve yet. Print the verdict, never fail.
                const verdict = result.ok ? "PASS" : "FAIL";
                const detail = result.ok
                    ? result.seeds
                          .map((s) => `seed ${s.seed}: ${s.moveDescription}`)
                          .join("; ")
                    : result.failureMessage;
                console.log(
                    `[blade:stretch] ${verdict} ${scenario.label} — ${detail}`
                );
                // ADR 0070 §2 — a beyond-budget entry names WHY it needs more
                // than production search, and the report prints that cause.
                // "needs more iterations" is never an accepted verdict; each
                // cause names a missing piece of bot knowledge instead.
                if (result.beyondBudget) {
                    console.log(
                        `[blade:stretch]   ↳ ${describeBeyondBudget(result.beyondBudget)}`
                    );
                }
                if (scenario.beyondBudget) {
                    // THE CLAIM ITSELF (issue #1487 review finding #2, moved
                    // off the blocking job by issue #1517). Reuses the
                    // `result` already computed above — no second search —
                    // and only ever runs here, in the report-only stretch
                    // job, never in the blocking must job.
                    //
                    // An entry the bot now solves at its declared budget
                    // means the stretch report would otherwise keep printing
                    // a FALSE "beyond budget [...]" verdict, destroying
                    // exactly the honesty the classification exists to
                    // provide — so surface it as a promotion signal, then
                    // assert the claim: at `budget`, the entry must
                    // genuinely FAIL. `continue-on-error` on the stretch job
                    // means this can go red here without ever blocking a
                    // merge. When it does, the BOT GOT BETTER — delete the
                    // entry's `beyondBudget` block (and consider promoting it
                    // to `must`); never relax this assertion or raise the
                    // budget to keep it green.
                    if (result.ok) {
                        console.log(
                            `[blade:stretch]   ↳ PROMOTION HINT — "${scenario.label}" now passes at its declared budget (${scenario.budget.iterations} iterations) — consider promoting it to \`must\` and deleting its \`beyondBudget\` block.`
                        );
                    }
                    expect(
                        result.ok,
                        `${scenario.label}: declares beyondBudget but PASSES at ${scenario.budget.iterations} iterations — the claim is stale, remove \`beyondBudget\``
                    ).toBe(false);
                }
                return;
            }
            expect(result.ok, result.failureMessage).toBe(true);
        });
    }
});

describe("blade suite — determinism (acceptance criterion, #1427)", () => {
    // The suite is only a metric if it is reproducible. Re-running an entry
    // with the same registry and the same seeds must produce the identical
    // chosen move — same machine, same run, and (because the base state, the
    // shuffle seed and the iteration budget are all fixed constants) any other
    // machine too.
    const probe: BladeScenario | undefined = scenarios[0] ?? BLADE_SCENARIOS[0];

    it("re-running a scenario yields the identical chosen move", () => {
        if (!probe) return;
        const first = runBladeScenario(probe);
        const second = runBladeScenario(probe);
        expect(second.seeds.map((s) => s.move)).toEqual(
            first.seeds.map((s) => s.move)
        );
        expect(second.ok).toBe(first.ok);
    });
});
