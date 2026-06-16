// AI diagnosis harness (Forge comparison effort).
//
// PURPOSE: take the concrete "the bot did something dumb" episodes and run them
// through the REAL ISMCTS search at escalating budgets, printing the
// DecisionTrace for each. The output tells us — per episode — whether the cause
// is EVALUATION (the bot prefers the bad move even with a huge budget), SEARCH
// BUDGET / EXPLORATION (the good move wins once iterations grow), or SEARCH
// HORIZON (combat damage falls beyond ROLLOUT_DEPTH so a losing attack is scored
// as if no material was lost — its meanMargin stays ~flat vs passing).
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
    it("episode #2: 2/2 into 3/3, empty hand — should not attack", () => {
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
    });

    // -----------------------------------------------------------------------
    // Episode #3 — Braingeyser ({X}{U}{U}) cast targeting the OPPONENT, who
    // then draws cards (a gift). With 3 Islands the bot can afford X=1. Correct
    // play: target SELF (or, with no upside, not cast). If a "target p2"
    // candidate is chosen, or scores >= the "target p1" candidate, the search
    // is blind to who benefits from the draw.
    // -----------------------------------------------------------------------
    it("episode #3: Braingeyser should not target the opponent", () => {
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

        const trace = diagnose("EP#3 Braingeyser target choice", state, "p1");
        const targetsOpp = trace.candidates.filter(
            (c) =>
                c.move.kind === "cast-spell" &&
                c.move.targets.some((t) => t.type === "player" && t.id === "p2")
        );
        const targetsSelf = trace.candidates.filter(
            (c) =>
                c.move.kind === "cast-spell" &&
                c.move.targets.some((t) => t.type === "player" && t.id === "p1")
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
    });

    // -----------------------------------------------------------------------
    // Episode A — ACTION BIAS (root cause behind the X=0 waste-cast).
    // Hypothesis: passing is undervalued because, in the truncated rollout, a
    // pass immediately hands initiative to the opponent, whose modeled
    // development depresses the bot's leaf margin — while "do something on my
    // own turn" keeps the bot acting and is scored before the reply. So a
    // strictly-neutral action (Braingeyser X=0: draw 0, lose the card + mana)
    // beats pass at the budget the bot actually plays at (400).
    //
    // Marked `it.fails`: it documents the KNOWN bug and stays green WHILE the
    // bug exists. When the horizon fix lands, this flips to red — flip it back
    // to `it(...)` then. Run at the real play budget, not a huge one.
    // -----------------------------------------------------------------------
    it.fails(
        "episode A: at the play budget the bot wastes a card rather than pass (KNOWN BUG)",
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

            // The real play budget (DIFFICULTY_BUDGETS.medium = 400 iterations).
            const { trace } = searchWithTrace(
                state,
                "p1",
                { iterations: 400, timeMs: 60_000 },
                SEED
            );
            // CORRECT play: drawing 0 cards for a card + 2 mana is strictly worse
            // than passing — the bot must pass (or at least not cast X=0).
            expect(trace?.chosen).toContain("pass");
        }
    );
});
