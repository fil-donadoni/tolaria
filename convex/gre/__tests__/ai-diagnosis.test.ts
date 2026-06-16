// AI diagnosis harness (Forge comparison effort).
//
// PURPOSE: take the concrete "the bot did something dumb" episodes and run them
// through the REAL ISMCTS search at escalating budgets, printing the
// DecisionTrace for each. The output tells us — per episode — whether the cause
// is EVALUATION (the bot prefers the bad move even with a huge budget), SEARCH
// BUDGET / EXPLORATION (the good move wins once iterations grow), or SEARCH
// HORIZON (the relevant event falls beyond the rollout horizon — since ADR 0015
// the bot's next turn boundary — so a losing line is scored as if no material
// was lost, its meanMargin staying ~flat vs passing).
//
// Read the printed tables, not just the pass/fail: each scenario logs, per root
// move, visits / meanReward / meanMargin and the key eval terms of the position
// it leads to. The `expect` at the end of each block documents the CORRECT
// choice — a failure is the bug reproduced, and the table above it is the
// evidence. This file is also the seed of the eval-regression suite: every
// future weight change must keep these expectations green.
//
// Run focused:  bun run test ai-diagnosis

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { searchWithTrace, type DecisionTrace } from "../search";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const GRIZZLY = getCardByName("Grizzly Bears").id; // 2/2
const HILL_GIANT = getCardByName("Hill Giant").id; // 3/3
const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;
const BRAINGEYSER = getCardByName("Braingeyser").id; // {X}{U}{U}: target player draws X

/** Iteration budgets, smallest → largest. medium (400) is what the bot plays at;
 *  the larger rungs isolate budget/exploration limits from structural ones. A
 *  generous timeMs keeps the iteration count the only variable. */
const BUDGET_LADDER = [50, 400, 1200, 5000, 20000] as const;
const SEED = 0xc0ffee;

/** Per-test timeout for the ladder-driven episodes. The full ladder runs
 *  ~27k iterations, and since ADR 0015 each rollout plays a FULL ROUND (longer
 *  than the old 8-ply horizon) — fewer iterations per second — so the top rung
 *  is genuinely heavy and can exceed the 5s default under parallel-suite load.
 *  This is a diagnostic harness, not a unit test; a generous ceiling keeps it
 *  reliable in CI without masking a real hang. */
const DIAGNOSIS_TIMEOUT_MS = 30_000;

/** Run `searchWithTrace` at every budget rung and print a compact table. Returns
 *  the trace from the LARGEST budget (the most-resolved verdict) for assertions. */
function diagnose(
    title: string,
    state: GameState,
    botId: string
): DecisionTrace {
    console.log(`\n=== ${title} ===`);
    let last: DecisionTrace | null = null;
    for (const iterations of BUDGET_LADDER) {
        const { trace } = searchWithTrace(
            state,
            botId,
            { iterations, timeMs: 60_000 },
            SEED
        );
        if (!trace) {
            console.log(`  [${iterations} it] no decision (forced/!deciding)`);
            continue;
        }
        last = trace;

        console.log(`  [${iterations} it] chose: ${trace.chosen}`);
        const rows = [...trace.candidates]
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 6)
            .map((c) => {
                const e = c.eval;
                return [
                    `    ${c.label.padEnd(34)}`,
                    `v=${String(c.visits).padStart(5)}`,
                    `R=${c.meanReward.toFixed(3)}`,
                    `M=${c.meanMargin.toFixed(1).padStart(6)}`,
                    `selfPwr=${e.self.power} oppHand=${e.opp.hand} oppPwr=${e.opp.power}`,
                ].join("  ");
            });

        console.log(rows.join("\n"));
    }
    if (!last) throw new Error(`${title}: search never returned a trace`);
    return last;
}

describe("AI diagnosis harness (Forge comparison)", () => {
    // -----------------------------------------------------------------------
    // Episode #2 — attacks a 2/2 into an untapped 3/3 with an empty hand.
    // A blocked Grizzly (2 power) dies to Hill Giant (3 toughness survives).
    // Correct play: do NOT attack. If "attack" wins at every budget AND its
    // meanMargin sits ~flat next to "no attack", combat damage is never reached
    // in rollout (HORIZON). If meanMargin is clearly worse yet it still wins,
    // it is a SELECTION/eval-weight issue.
    // -----------------------------------------------------------------------
    it(
        "episode #2: 2/2 into 3/3, empty hand — should not attack",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const grizzly = makeInstance(GRIZZLY, {
                id: "grizzly",
                controllerId: "p1",
                ownerId: "p1",
                isTapped: false,
                isSummoningSick: false,
            });
            const hillGiant = makeInstance(HILL_GIANT, {
                id: "hill",
                controllerId: "p2",
                ownerId: "p2",
                isTapped: false,
                isSummoningSick: false,
            });
            const state = makeState({
                phase: "DECLARE_ATTACKERS",
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                combat: {
                    attackerIds: [],
                    confirmed: false,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
                players: [
                    makePlayer("p1", { hand: [], battlefield: [grizzly] }),
                    makePlayer("p2", { battlefield: [hillGiant] }),
                ],
            });

            const trace = diagnose(
                "EP#2 Grizzly 2/2 into Hill Giant 3/3",
                state,
                "p1"
            );
            const attacked = trace.candidates.find(
                (c) =>
                    c.move.kind === "declare-attackers" &&
                    c.move.attackerIds.length > 0
            );
            const passed = trace.candidates.find(
                (c) =>
                    c.move.kind === "declare-attackers" &&
                    c.move.attackerIds.length === 0
            );
            // Documented-correct outcome: the no-attack line keeps more material.
            if (attacked && passed) {
                expect(passed.meanMargin).toBeGreaterThanOrEqual(
                    attacked.meanMargin
                );
            }
            // The chosen move must not throw the Grizzly away for nothing.
            expect(trace.chosen).not.toContain("grizzly");
        }
    );

    // -----------------------------------------------------------------------
    // Episode #3 — Braingeyser ({X}{U}{U}) cast targeting the OPPONENT, who
    // then draws cards (a gift). With 3 Islands the bot can afford X=1. Correct
    // play: target SELF (or, with no upside, not cast). If a "target p2"
    // candidate is chosen, or scores >= the "target p1" candidate, the search
    // is blind to who benefits from the draw.
    // -----------------------------------------------------------------------
    it(
        "episode #3: Braingeyser should not target the opponent",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const islands = [0, 1, 2].map((i) =>
                makeInstance(ISLAND, {
                    id: `island${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    isTapped: false,
                })
            );
            const brain = makeInstance(BRAINGEYSER, {
                id: "brain",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            // Both players need a library to draw from.
            const lib = (owner: string) =>
                [0, 1, 2, 3, 4].map((i) =>
                    makeInstance(FOREST, {
                        id: `${owner}-lib${i}`,
                        controllerId: owner,
                        ownerId: owner,
                        zone: "library",
                    })
                );
            const state = makeState({
                phase: "PRECOMBAT_MAIN",
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [
                    makePlayer("p1", {
                        hand: [brain],
                        battlefield: islands,
                        library: lib("p1"),
                    }),
                    makePlayer("p2", { library: lib("p2") }),
                ],
            });

            const trace = diagnose(
                "EP#3 Braingeyser target choice",
                state,
                "p1"
            );
            const targetsOpp = trace.candidates.filter(
                (c) =>
                    c.move.kind === "cast-spell" &&
                    c.move.targets.some(
                        (t) => t.type === "player" && t.id === "p2"
                    )
            );
            const targetsSelf = trace.candidates.filter(
                (c) =>
                    c.move.kind === "cast-spell" &&
                    c.move.targets.some(
                        (t) => t.type === "player" && t.id === "p1"
                    )
            );
            // Diagnostic: if targeting the opponent never scores above targeting
            // self, the eval at least sees the gift. Best opp vs best self:
            const bestOpp = Math.max(
                -Infinity,
                ...targetsOpp.map((c) => c.meanReward)
            );
            const bestSelf = Math.max(
                -Infinity,
                ...targetsSelf.map((c) => c.meanReward)
            );

            console.log(
                `  bestSelf R=${bestSelf.toFixed(3)}  bestOpp R=${bestOpp.toFixed(3)}`
            );
            // Documented-correct outcome: never hand the opponent free cards.
            expect(trace.chosen).not.toContain("→ p2");
        }
    );

    // -----------------------------------------------------------------------
    // Episode A — ACTION BIAS (root cause behind the X=0 waste-cast), now FIXED
    // by the turn-boundary rollout horizon (ADR 0015).
    //
    // The defect: under a fixed PLY horizon, a pass immediately handed
    // initiative to the opponent — whose modeled development depressed the
    // bot's leaf margin — while "do something on my own turn" kept the bot
    // acting and was scored BEFORE the reply. So a strictly-wasteful action
    // (Braingeyser X=0: draw 0, lose the card + 2 mana) outscored `pass` at the
    // budget the bot actually plays at (400). This was tracked as `it.fails`.
    //
    // With the turn-clock horizon every candidate is scored at the same
    // game-clock boundary (the bot's next turn), so the asymmetry is gone. The
    // bar is therefore the genuine one: the bot must NOT make the strictly-
    // wasteful X=0 cast, and `pass` must out-rank every X=0 line. (Casting
    // X=1 — drawing a real card for spare mana — is a legitimate improvement
    // and is what the bot now chooses; that is correct, not the bug.)
    // -----------------------------------------------------------------------
    it(
        "episode A: turn-boundary horizon removes the action bias — no X=0 waste-cast (ADR 0015)",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const islands = [0, 1, 2].map((i) =>
                makeInstance(ISLAND, {
                    id: `aisland${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    isTapped: false,
                })
            );
            const brain = makeInstance(BRAINGEYSER, {
                id: "abrain",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            const lib = (owner: string) =>
                [0, 1, 2, 3, 4].map((i) =>
                    makeInstance(FOREST, {
                        id: `a-${owner}-lib${i}`,
                        controllerId: owner,
                        ownerId: owner,
                        zone: "library",
                    })
                );
            const state = makeState({
                phase: "PRECOMBAT_MAIN",
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [
                    makePlayer("p1", {
                        hand: [brain],
                        battlefield: islands,
                        library: lib("p1"),
                    }),
                    makePlayer("p2", { library: lib("p2") }),
                ],
            });

            // Assert at the REAL play budget (DIFFICULTY_BUDGETS.medium = 400), per
            // ADR 0015 — NOT a huge budget. The horizon fix removes the *action
            // bias* at the budget the bot actually plays at; a residual eval blind
            // spot that only resurfaces at ~20k iterations (X=0 out-evaluating pass)
            // is the deferred eval work (ADR 0016), out of scope here.
            const { trace } = searchWithTrace(
                state,
                "p1",
                { iterations: 400, timeMs: 60_000 },
                SEED
            );
            if (!trace) throw new Error("episode A: search returned no trace");

            // The bot must not make the strictly-wasteful X=0 cast (draw 0 for a
            // card + 2 mana).
            expect(trace.chosen).not.toContain("X=0");

            // The action bias is gone: `pass` now out-rewards every X=0 line, which
            // it could not under the old ply horizon. (Under the bias, the neutral
            // X=0 action beat pass; that ordering is what we assert is reversed.)
            const pass = trace.candidates.find((c) => c.move.kind === "pass");
            const wasteX0 = trace.candidates.filter(
                (c) => c.move.kind === "cast-spell" && c.move.chosenX === 0
            );
            expect(pass).toBeDefined();
            for (const waste of wasteX0) {
                expect(pass!.meanReward).toBeGreaterThanOrEqual(
                    waste.meanReward
                );
            }
        }
    );
});
