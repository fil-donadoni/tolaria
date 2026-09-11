// The lowering sweep's own tests, plus the opt-in RUNNER (issue #3461).
//
// Two roles, the `harness.bot.test.ts` shape:
//
//  1. always-on unit tests — the message classifier, the allowlist-derived
//     residue, and DETERMINISM, which is the sweep's whole contract: a number
//     that moves between two runs of the same seeds orders nothing;
//  2. opt-in runner gated by `LOWERING_SWEEP`, invoked via
//     `bun run lowering-sweep`. Not a gate, holds no gate mutex, and
//     `test:bot` collects and skips it.

import { describe, it, expect } from "vitest";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup";
import {
    GAME_STATE_ALLOWLIST,
    PLAYER_STATE_ALLOWLIST,
} from "@convex/gre/scenarioBuilder";
import {
    droppedMessageClass,
    formatLoweringReport,
    observeDecision,
    runLoweringSweep,
    type LoweringSweepConfig,
} from "./loweringSweep";

describe("lowering sweep: dropped-message classes (issue #3461)", () => {
    it("collapses the interpolations two decisions differ by", () => {
        // The same message class, from two different boards: a different item
        // count, a different quoted phase, a different card name. Ranking the
        // raw text would file these as four separate causes.
        expect(
            droppedMessageClass(
                `stack: 3 item(s) — the spell/ability stack isn't spec-expressible (see the blade suite's "setup" steps for a response-window position instead)`
            )
        ).toBe(
            droppedMessageClass(
                `stack: 1 item(s) — the spell/ability stack isn't spec-expressible (see the blade suite's "setup" steps for a response-window position instead)`
            )
        );
        expect(
            droppedMessageClass(
                `Grizzly Bears (me): live-only state not captured (grantedUntilEot)`
            )
        ).toBe(
            droppedMessageClass(
                `Llanowar Elves (opp, graveyard): live-only state not captured (grantedUntilEot)`
            )
        );
        expect(
            droppedMessageClass(
                `me's mana pool: 2R 1G — not lowered (mana pool isn't spec-expressible)`
            )
        ).toBe(
            droppedMessageClass(
                `opp's mana pool: 1U — not lowered (mana pool isn't spec-expressible)`
            )
        );
    });

    it("keeps genuinely different causes apart", () => {
        // Masking must not be so aggressive that two distinct gaps merge —
        // a ranked table whose top row is "everything" orders nothing either.
        const classes = new Set(
            [
                `pendingCast: a spell payment is mid-flight — not lowered`,
                `pendingTarget: a target selection is mid-flight — not lowered`,
                `emblems: 2 — command-zone emblems aren't spec-expressible`,
                `madnessCastWindow: an open Madness cast window — not lowered`,
            ].map(droppedMessageClass)
        );
        expect(classes.size).toBe(4);
    });

    it("masks an engine constant but not an English word", () => {
        const phase = droppedMessageClass(
            `phase "DECLARE_BLOCKERS": buildStateFromScenario only re-seeds "combat" for phase "DECLARE_ATTACKERS" — loading this spec lands on DECLARE_BLOCKERS with NO combat object; use a blade "setup" step instead`
        );
        expect(phase).not.toContain("DECLARE_BLOCKERS");
        expect(phase).toContain("<CONST>");
        // `NO` and `spec` are not constants; the sentence must stay readable.
        expect(phase).toContain("with NO combat object");
    });
});

describe("lowering sweep: residue is derived, not copied (issue #3461)", () => {
    it("reports a GameState field no allowlist covers, without editing the sweep", () => {
        // The acceptance criterion in prose: a field added to `GameState`
        // tomorrow must appear here on its own. Simulated by adding one now.
        const state = makeState({
            players: [makePlayer("A"), makePlayer("B")],
            activePlayerId: "A",
            priorityPlayerId: "A",
        });
        expect(GAME_STATE_ALLOWLIST.has("someFutureField")).toBe(false);
        (state as unknown as Record<string, unknown>).someFutureField = {
            live: true,
        };

        const observation = observeDecision(state, "A", "Pass priority");
        expect(observation.residue.game).toContain("someFutureField");
        // …and an allowlisted field is NOT residue, or every decision would
        // report the whole state and the table would say nothing.
        expect(PLAYER_STATE_ALLOWLIST.has("life")).toBe(true);
        expect(observation.residue.player).not.toContain("life");
    });
});

describe("lowering sweep: determinism (issue #3461)", () => {
    it("prints the same table for the same seeds", () => {
        const config: LoweringSweepConfig = {
            deckA: "mono-red-burn",
            deckB: "mono-red-burn",
            games: 1,
            seed: 4242,
            iterations: 4,
        };
        const first = runLoweringSweep(config);
        const second = runLoweringSweep(config);
        expect(formatLoweringReport(second)).toBe(formatLoweringReport(first));
        // A sweep that observed nothing would pass the equality above while
        // measuring nothing at all.
        expect(first.decisions).toBeGreaterThan(0);
        expect(first.judgeable + sumRefusals(first.refusals)).toBe(
            first.decisions
        );
    }, 300_000);
});

function sumRefusals(refusals: Record<string, number>): number {
    return Object.values(refusals).reduce((total, n) => total + n, 0);
}

// `process` isn't in the browser-typed src tsconfig; read env off globalThis.
const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};
const RUN = ENV.LOWERING_SWEEP === "1";

describe.runIf(RUN)("lowering sweep (runner)", () => {
    it("sweeps N deterministic games and prints the ranked table", () => {
        const config: LoweringSweepConfig = {
            deckA: ENV.LOWERING_SWEEP_DECK_A ?? "mono-red-burn",
            deckB: ENV.LOWERING_SWEEP_DECK_B ?? "channel-fireball",
            games: Number(ENV.LOWERING_SWEEP_GAMES ?? "6"),
            seed: Number(ENV.LOWERING_SWEEP_SEED ?? "1"),
            iterations: Number(ENV.LOWERING_SWEEP_ITER ?? "60"),
        };
        const report = runLoweringSweep(config);
        console.log("\n" + formatLoweringReport(report) + "\n");
        expect(report.decisions).toBeGreaterThan(0);
    }, 3_600_000);
});
