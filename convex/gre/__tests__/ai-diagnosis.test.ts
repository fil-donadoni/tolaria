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
import { evaluate, declaredBlockDelta } from "../evaluate";
import type { GameState } from "../state";

const GRIZZLY = getCardByName("Grizzly Bears").id; // 2/2
const HILL_GIANT = getCardByName("Hill Giant").id; // 3/3
const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;
const BRAINGEYSER = getCardByName("Braingeyser").id; // {X}{U}{U}: target player draws X
const GIANT_GROWTH = getCardByName("Giant Growth").id; // {G}: +3/+3 until EOT
const BOP = getCardByName("Birds of Paradise").id; // 0/1 flying mana dork

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
                    `selfCr=${e.self.creatures} oppHand=${e.opp.hand} oppCr=${e.opp.creatures}`,
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
    // Episode #1 — sits on a land drop (ADR 0020 §1, issue #206). With a Forest
    // in hand and nothing else to do, the bot scored `pass` and `play Forest`
    // outcome-equal and the material tie-break picked `pass` on rollout noise,
    // developing the land only in the second main. The land-drop tie-break in
    // `selectRootMove` must develop the land when nothing competes — a land has
    // no option cost, so deferring it is never right.
    // -----------------------------------------------------------------------
    it(
        "episode #1: develops its land when nothing else competes",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const forestInHand = makeInstance(FOREST, {
                id: "forest-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            // An already-developed board so this is a mid-game land drop (the
            // motivating trace played the land only in the second main).
            const islands = [0, 1].map((i) =>
                makeInstance(ISLAND, {
                    id: `dev-island${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    isTapped: false,
                })
            );
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
                        hand: [forestInHand],
                        battlefield: islands,
                        library: lib("p1"),
                    }),
                    makePlayer("p2", { library: lib("p2") }),
                ],
            });

            const trace = diagnose(
                "EP#1 land drop with nothing competing",
                state,
                "p1"
            );
            const chosenCand = trace.candidates.find(
                (c) => c.label === trace.chosen
            );
            // Documented-correct outcome: develop the land now, never pass on it.
            expect(chosenCand?.move.kind).toBe("play-land");
        }
    );

    // -----------------------------------------------------------------------
    // Episode #4 — dumps a combat trick at sorcery speed (ADR 0020 §2, issue
    // #207). Holding only Giant Growth, the bot cast it on its own creature in
    // precombat main because the leaf counted the temporary +3/+3 as permanent
    // material (+87 = 3×W_CR_POWER + 3×W_CR_TOUGHNESS). With the temporary buff
    // excluded from the realized creature term, casting now only LOSES material
    // (a card + the mana) for no lasting gain, so `pass` must outrank it. This
    // lever removes the false incentive; holding the trick for the right window
    // is lever 4 (#209).
    // -----------------------------------------------------------------------
    it(
        "episode #4: sorcery-speed combat trick with no payoff — should pass",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            // Summoning-sick: it cannot attack this turn, so an until-end-of-turn
            // +3/+3 has NO payoff (no combat to use it in, the buff expires at
            // cleanup). Casting is pure loss of a card + mana.
            const grizzly = makeInstance(GRIZZLY, {
                id: "own-bear",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: true,
            });
            const forest = makeInstance(FOREST, {
                id: "g-forest",
                controllerId: "p1",
                ownerId: "p1",
                isTapped: false,
            });
            const trick = makeInstance(GIANT_GROWTH, {
                id: "gg",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
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
                        hand: [trick],
                        battlefield: [grizzly, forest],
                        library: lib("p1"),
                    }),
                    makePlayer("p2", { library: lib("p2") }),
                ],
            });

            const trace = diagnose(
                "EP#4 Giant Growth at sorcery speed, no payoff",
                state,
                "p1"
            );
            const cast = trace.candidates.find(
                (c) => c.move.kind === "cast-spell"
            );
            const pass = trace.candidates.find((c) => c.move.kind === "pass");
            expect(cast).toBeDefined();
            expect(pass).toBeDefined();

            // Lever-2 guarantee (deterministic): the temporary +3/+3 is NOT
            // counted as permanent material. Before the fix, casting inflated the
            // self.creatures term by +87 (3×W_CR_POWER + 3×W_CR_TOUGHNESS) over
            // passing; now the post-cast creatures term equals the pass-line term,
            // so the false "free lasting board gain" incentive is gone.
            expect(cast!.eval.self.creatures).toBe(pass!.eval.self.creatures);

            // With the false incentive removed, casting no longer DECISIVELY
            // beats passing — the two are now outcome-equal (within OUTCOME_EPS
            // 0.05), down from the motivating trace's 0.027 gap. Actually teaching
            // the bot to HOLD the trick (so pass strictly wins) is lever 4 (#209);
            // here we only assert the false eval incentive is gone.
            const OUTCOME_EPS = 0.05;
            expect(cast!.meanReward - pass!.meanReward).toBeLessThan(
                OUTCOME_EPS
            );
        }
    );

    // -----------------------------------------------------------------------
    // Episode #5 — the canonical combat-trick ambush (ADR 0021 slice 3, issue
    // #223). The headline reactive line ADR 0020 lever 4 could not reach: a 3/3
    // that can attack + Giant Growth in hand, into an open 3/3. The right play
    // is to HOLD the trick — pass out of the main phase, attack with the 2/2,
    // and cast the pump only IF the 3/3 blocks (turning the 2/2 into a 5/5 that
    // kills the 3/3 and survives, a free creature). Dumping the trick precombat
    // reveals it and wastes its ambush value. That `hold → attack → block →
    // respond` subtree is too sparse to accrue visits at realistic budgets, so
    // before this slice the hold line was barely explored.
    //
    // What slice 3 delivers (and this episode pins): the reactive line is now
    // REACHABLE — the soft prior drives real visits down it, and the policy
    // actually PLAYS the ambush (proved deterministically by the seam tests in
    // search.test.ts: bait the block, hold priority pre-block, pump in response).
    // Three pieces make the line playable: the reactive prior EXPLORES it; the
    // pre-block guardrail stops the rollout dumping the pump early; and the
    // policy strips the pre-block combat pre-judgment while holding a trick (so
    // attacking the bait and waiting are not scored as walking into death), with
    // `declaredBlockDelta` on effective P/T letting the block-step pump be seen.
    //
    // Scope of THIS episode: the slice-3 reachability deliverable in isolation —
    // the soft prior drives real visits down the hold line and it is not a
    // clearly-worse line (within the outcome band). The headline ROOT behaviour
    // ("the bot HOLDS the trick at the root and the held line out-scores the
    // precombat dump", #223 AC bullet 3) is pinned separately by episode #7,
    // which the interaction-aware combat predictor (#229) lets pass: with the
    // attacker's held pump modelled the bait is no longer pre-judged dead, so the
    // dump no longer decisively wins and the hold-the-trick selection tie-break
    // keeps the option — `trace.chosen === "pass"`. (Before #229 that last step
    // was a high-variance, deferred gap; it is now closed.)
    // -----------------------------------------------------------------------
    it(
        "episode #5: canonical combat-trick ambush — hold line is reachable & competitive",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const attacker = makeInstance(GRIZZLY, {
                id: "own-bear",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false, // CAN attack this turn
            });
            const forest = makeInstance(FOREST, {
                id: "g-forest",
                controllerId: "p1",
                ownerId: "p1",
                isTapped: false,
            });
            const trick = makeInstance(GIANT_GROWTH, {
                id: "gg",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            const blocker = makeInstance(HILL_GIANT, {
                id: "opp-giant",
                controllerId: "p2",
                ownerId: "p2",
                isSummoningSick: false,
            });
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
                        hand: [trick],
                        battlefield: [attacker, forest],
                        library: lib("p1"),
                    }),
                    makePlayer("p2", {
                        battlefield: [blocker],
                        library: lib("p2"),
                    }),
                ],
            });

            const trace = diagnose(
                "EP#5 canonical ambush (2/2 + Giant Growth into a 3/3)",
                state,
                "p1"
            );
            // The precombat DUMP (cast Giant Growth on the bot's own attacker)
            // and HOLDING the trick (pass out of the main phase).
            const dump = trace.candidates.find(
                (c) =>
                    c.move.kind === "cast-spell" &&
                    c.move.targets.some((t) => t.id === "own-bear")
            );
            const hold = trace.candidates.find((c) => c.move.kind === "pass");
            expect(dump).toBeDefined();
            expect(hold).toBeDefined();

            // REACHABILITY (the slice-3 deliverable, AC bullet 1): before the
            // reactive prior the `hold → attack → block → respond` subtree was so
            // sparse the hold line was barely explored. The prior now drives a
            // substantial share of visits down it, so holding is a genuine,
            // explored contender rather than rollout dust.
            expect(hold!.visits).toBeGreaterThan(trace.iterations * 0.2);

            // NON-DOMINATION: holding is no longer a clearly-worse line — it
            // sits within the outcome band of the precombat dump (the seam tests
            // in search.test.ts prove the policy now actually PLAYS the ambush:
            // bait the block, hold priority, pump in response). Strictly
            // out-scoring the robust dump in this pure bait is bounded by rollout
            // variance — the ambush is one high-value branch among many noisy
            // playouts of the hold line, and a soft prior cannot lift the line's
            // MEAN above a low-variance dump. That last step needs a
            // lower-variance / pump-aware rollout and is deferred; see the PR.
            const OUTCOME_EPS = 0.05;
            expect(hold!.meanReward).toBeGreaterThan(
                dump!.meanReward - OUTCOME_EPS
            );
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

    // -----------------------------------------------------------------------
    // Episode B — latent Card Value closes the residual ADR 0015 leaf blind
    // spot (slice 2, issue #195). Two related claims:
    //
    //  (1) X=0 waste-cast DECISIVELY rejected. With the flat hand term, pitching
    //      Braingeyser for a 0-card draw cost the same tiny amount as any card;
    //      now the hand term is each card's `cardValue`, so the waste is a clear
    //      loss and `pass` out-rewards every X=0 line by a real margin (not the
    //      hair's-breadth tie of the old eval).
    //
    //  (2) The eval values a bomb in hand above a spare land — the latent
    //      ordering that makes the bot keep its best card. Asserted directly on
    //      `evaluate` (the leaf), the level the search consumes.
    // -----------------------------------------------------------------------
    it(
        "episode B: latent card value — X=0 decisively rejected, bomb kept over land",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const islands = [0, 1, 2].map((i) =>
                makeInstance(ISLAND, {
                    id: `bisland${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    isTapped: false,
                })
            );
            const brain = makeInstance(BRAINGEYSER, {
                id: "bbrain",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            const lib = (owner: string) =>
                [0, 1, 2, 3, 4].map((i) =>
                    makeInstance(FOREST, {
                        id: `b-${owner}-lib${i}`,
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
                "EP#B X=0 decisive rejection + latent value",
                state,
                "p1"
            );

            // (1) At the real play budget the bot never makes the X=0 waste cast,
            // and `pass` STRICTLY out-rewards every X=0 line (a clear margin, not
            // the old near-tie).
            const { trace: playTrace } = searchWithTrace(
                state,
                "p1",
                { iterations: 400, timeMs: 60_000 },
                SEED
            );
            if (!playTrace)
                throw new Error("episode B: search returned no trace");
            expect(playTrace.chosen).not.toContain("X=0");
            const pass = playTrace.candidates.find(
                (c) => c.move.kind === "pass"
            );
            const wasteX0 = playTrace.candidates.filter(
                (c) => c.move.kind === "cast-spell" && c.move.chosenX === 0
            );
            expect(pass).toBeDefined();
            expect(wasteX0.length).toBeGreaterThan(0);
            for (const waste of wasteX0) {
                expect(pass!.meanReward).toBeGreaterThan(waste.meanReward);
            }

            // (2) Latent ordering: a hand holding a 3/3 bomb evaluates strictly
            // higher than the same hand holding a spare basic land.
            const withBomb = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(HILL_GIANT, {
                                id: "bomb",
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "hand",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            const withLand = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(FOREST, {
                                id: "spare",
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "hand",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(evaluate(withBomb, "p1")).toBeGreaterThan(
                evaluate(withLand, "p1")
            );

            // Silence the unused-trace lint when the ladder print is all we want
            // from `diagnose`.
            expect(trace).toBeDefined();
        }
    );

    // -----------------------------------------------------------------------
    // Episode C — Danger Clock (slice 3, issue #196). The bot reads the race:
    // it DEFENDS under a lethal opposing clock and PRESSES when it holds the
    // faster clock, instead of turtling.
    //
    //  (1) Defend: the bot is the defender at 4 life facing two 3/3 attackers
    //      (6 = lethal) with one 3/3 blocker. It must block to stabilise.
    //  (2) Press: the bot holds two ready 3/3s against an opponent with no
    //      blockers; it attacks to push its clock rather than passing.
    // -----------------------------------------------------------------------
    it(
        "episode C: danger clock — blocks under a lethal clock, presses when ahead",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            // (1) Defend. p2 is the active attacker; the bot p1 owes blocks.
            const atk = (id: string) =>
                makeInstance(HILL_GIANT, {
                    id,
                    controllerId: "p2",
                    ownerId: "p2",
                    isSummoningSick: false,
                    isAttacking: true,
                });
            const defendState = makeState({
                phase: "DECLARE_BLOCKERS",
                activePlayerId: "p2",
                priorityPlayerId: "p1",
                combat: {
                    attackerIds: ["a1", "a2"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
                players: [
                    makePlayer("p1", {
                        life: 4,
                        battlefield: [
                            makeInstance(HILL_GIANT, {
                                id: "wall",
                                controllerId: "p1",
                                ownerId: "p1",
                                isSummoningSick: false,
                            }),
                        ],
                    }),
                    makePlayer("p2", {
                        life: 20,
                        battlefield: [atk("a1"), atk("a2")],
                    }),
                ],
            });
            const defend = diagnose(
                "EP#C-defend lethal clock",
                defendState,
                "p1"
            );
            // The bot must block (non-empty assignment) — taking 6 is lethal.
            expect(defend.chosen).toContain("block");

            // (2) Press. The bot p1 is the active player with two ready 3/3s and
            // the opponent has no blockers; it should declare attackers.
            const mine = (id: string) =>
                makeInstance(HILL_GIANT, {
                    id,
                    controllerId: "p1",
                    ownerId: "p1",
                    isSummoningSick: false,
                });
            const pressState = makeState({
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
                    makePlayer("p1", {
                        life: 20,
                        battlefield: [mine("m1"), mine("m2")],
                    }),
                    makePlayer("p2", { life: 12 }),
                ],
            });
            const press = diagnose("EP#C-press faster clock", pressState, "p1");
            const chosenAttack = press.candidates.find(
                (c) => c.label === press.chosen
            )?.move;
            expect(chosenAttack?.kind).toBe("declare-attackers");
            if (chosenAttack?.kind === "declare-attackers") {
                expect(chosenAttack.attackerIds.length).toBeGreaterThan(0);
            }
        }
    );

    // -----------------------------------------------------------------------
    // Episode #5 — attacks with a mana dork into death (ADR 0020 §3, issue
    // #208). With an empty hand the bot attacked with Birds of Paradise (a 0/1
    // mana source) alongside its real threat, walking it into a fatal block for
    // 1 chip damage. The `declare-attackers` leaf used to score identically for
    // every attack set (scored before damage), so the choice fell to the
    // aggressive rollout. With the combat-aware leaf, the attack set that
    // includes BoP scores below the one that holds it back. The bot should send
    // the real attacker but keep the dork home.
    // -----------------------------------------------------------------------
    it(
        "episode #5: holds a mana dork back instead of attacking it into death",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const giant = makeInstance(HILL_GIANT, {
                id: "real-threat",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false,
            });
            const bop = makeInstance(BOP, {
                id: "dork",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false,
            });
            // Defender has a 2/2 — enough to kill BoP for free if it attacks.
            const wall = makeInstance(GRIZZLY, {
                id: "wall",
                controllerId: "p2",
                ownerId: "p2",
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
                    makePlayer("p1", { hand: [], battlefield: [giant, bop] }),
                    makePlayer("p2", { battlefield: [wall] }),
                ],
            });

            const trace = diagnose("EP#5 mana dork into death", state, "p1");
            const chosen = trace.candidates.find(
                (c) => c.label === trace.chosen
            )?.move;
            // The chosen attack must not send the mana dork to die.
            if (chosen?.kind === "declare-attackers") {
                expect(chosen.attackerIds).not.toContain("dork");
            }
            // And at the leaf, holding the dork back outranks attacking with it:
            // compare the best attack set with the dork vs the best without.
            const withDork = trace.candidates.filter(
                (c) =>
                    c.move.kind === "declare-attackers" &&
                    c.move.attackerIds.includes("dork")
            );
            const withoutDork = trace.candidates.filter(
                (c) =>
                    c.move.kind === "declare-attackers" &&
                    !c.move.attackerIds.includes("dork")
            );
            const best = (cs: typeof trace.candidates) =>
                Math.max(-Infinity, ...cs.map((c) => c.meanReward));
            if (withDork.length && withoutDork.length) {
                expect(best(withoutDork)).toBeGreaterThanOrEqual(
                    best(withDork)
                );
            }
        }
    );

    // -----------------------------------------------------------------------
    // Episode #6 — keeps a mana dork home when attacking it gains nothing (ADR
    // 0020 §4, issue #209). p1 has a real 3/3 and a Birds of Paradise (0/1), the
    // opponent's board is OPEN. Attacking with BoP pushes 0 damage (it has no
    // power) and only taps it out of being a mana source / blocker. The rollout
    // guardrail biases the default policy away from this pointless dork swing
    // (alongside the snapshot's available-mana term); the bot attacks with the
    // real threat but holds the dork back. (The companion deterministic proof of
    // the guardrail is the `isDiscouragedRolloutMove` unit suite in search.test;
    // a soft, rollout-only bias cannot by itself flip a ROOT cast the search
    // already scores higher on immediate value — see ADR 0020, lever 4.)
    // -----------------------------------------------------------------------
    it(
        "episode #6: keeps a mana dork home on a swing that gains it nothing",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const giant = makeInstance(HILL_GIANT, {
                id: "threat",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false,
            });
            const bop = makeInstance(BOP, {
                id: "dork6",
                controllerId: "p1",
                ownerId: "p1",
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
                    makePlayer("p1", { hand: [], battlefield: [giant, bop] }),
                    makePlayer("p2", {}),
                ],
            });

            const trace = diagnose("EP#6 keep the mana dork home", state, "p1");
            const chosen = trace.candidates.find(
                (c) => c.label === trace.chosen
            )?.move;
            // The chosen attack must not tap the mana dork for nothing.
            if (chosen?.kind === "declare-attackers") {
                expect(chosen.attackerIds).not.toContain("dork6");
            }
            // And the dork-inclusive attack must not out-reward holding it back.
            const withDork = trace.candidates.filter(
                (c) =>
                    c.move.kind === "declare-attackers" &&
                    c.move.attackerIds.includes("dork6")
            );
            const withoutDork = trace.candidates.filter(
                (c) =>
                    c.move.kind === "declare-attackers" &&
                    !c.move.attackerIds.includes("dork6")
            );
            const best = (cs: typeof trace.candidates) =>
                Math.max(-Infinity, ...cs.map((c) => c.meanReward));
            if (withDork.length && withoutDork.length) {
                expect(best(withoutDork)).toBeGreaterThanOrEqual(
                    best(withDork)
                );
            }
        }
    );

    // -----------------------------------------------------------------------
    // Episode #7 — attacker AMBUSH: holds the combat trick at the root instead
    // of dumping it (ADR 0021 §B, issue #229; the deferred #223 AC). The
    // canonical position: the bot p1 has a ready 2/2 and Giant Growth + an
    // untapped Forest in hand/play; the opponent p2 has a 3/3 that can block.
    // At sorcery speed the bot can DUMP the trick (cast it on its bear in
    // precombat main) or HOLD it (pass, attack, pump in response to the block).
    //
    // Before the interaction-aware predictor, `declaredCombatDelta` read the
    // un-pumped 2/2 as walking into the 3/3, so the ambush was a rare,
    // high-variance branch whose mean stayed below the low-variance dump and the
    // bot dumped at the root. With the attacker's held pump modelled, the bait
    // attacker is no longer pre-judged dead, so the hold line out-scores the
    // dump and the chosen root move is NOT the sorcery-speed cast.
    // -----------------------------------------------------------------------
    it(
        "episode #7: holds the combat trick at the root (attacker ambush)",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const bear = makeInstance(GRIZZLY, {
                id: "bait-bear",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: false,
            });
            const forest = makeInstance(FOREST, {
                id: "amb-forest",
                controllerId: "p1",
                ownerId: "p1",
                isTapped: false,
            });
            const trick = makeInstance(GIANT_GROWTH, {
                id: "amb-gg",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            // Opponent's 3/3 blocker, untapped and ready.
            const wall = makeInstance(HILL_GIANT, {
                id: "amb-wall",
                controllerId: "p2",
                ownerId: "p2",
                isSummoningSick: false,
            });
            const lib = (owner: string) =>
                [0, 1, 2, 3, 4].map((i) =>
                    makeInstance(FOREST, {
                        id: `amb-${owner}-lib${i}`,
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
                        hand: [trick],
                        battlefield: [bear, forest],
                        library: lib("p1"),
                    }),
                    makePlayer("p2", {
                        battlefield: [wall],
                        library: lib("p2"),
                    }),
                ],
            });

            const { trace } = searchWithTrace(
                state,
                "p1",
                { iterations: 400, timeMs: 60_000 },
                SEED
            );
            if (!trace) throw new Error("episode #7: search returned no trace");

            diagnose("EP#7 attacker ambush — hold vs dump", state, "p1");

            // The chosen root move must NOT be the sorcery-speed dump of the
            // trick — the bot holds it for the block step.
            const cast = trace.candidates.find(
                (c) => c.move.kind === "cast-spell"
            );
            const pass = trace.candidates.find((c) => c.move.kind === "pass");
            expect(cast).toBeDefined();
            expect(pass).toBeDefined();
            expect(trace.chosen).not.toContain("Giant Growth");
            expect(trace.chosen).toBe("pass");

            // The held line is at least outcome-EQUAL with the precombat dump
            // (within OUTCOME_EPS). The false "dumping decisively wins" incentive
            // is gone: with the held pump modelled (the bait is no longer
            // pre-judged dead) plus the lower-variance reactive rollout, holding
            // is no worse, and the hold-the-trick selection tie-break then keeps
            // the option rather than spending it at sorcery speed for a marginal,
            // rollout-noise edge — so the chosen ROOT move is the hold, not the
            // dump (the deferred #223 acceptance criterion).
            const OUTCOME_EPS = 0.05;
            expect(cast!.meanReward - pass!.meanReward).toBeLessThan(
                OUTCOME_EPS
            );
        }
    );

    // -----------------------------------------------------------------------
    // Episode #8 — cautious MULTI-BLOCK (ADR 0021 §C, issue #229). The bot p1
    // is the DEFENDER facing one 3/3 attacker, holding two 2/2 blockers. A
    // double-block (combined 4 power) kills the 3/3 with no trick — a clean win
    // IF the attacker has nothing. But when the attacker holds a castable
    // +3/+3 pump, the pump lets the 3/3 SURVIVE and kill both committed 2/2s, so
    // the over-committed block is a trap. The cautious-block discount must make
    // the double-block score WORSE when the attacker is loaded (open mana + a
    // trick) than when the attacker is tapped out / empty-handed, so the bot
    // keeps a blocker back rather than walking two creatures into a likely trick.
    // -----------------------------------------------------------------------
    it(
        "episode #8: blocks cautiously vs a loaded attacker, normally vs an empty one",
        { timeout: DIAGNOSIS_TIMEOUT_MS },
        () => {
            const makeMultiBlock = (attackerLoaded: boolean): GameState => {
                const atk = makeInstance(HILL_GIANT, {
                    id: "mb-atk",
                    controllerId: "p2",
                    ownerId: "p2",
                    isSummoningSick: false,
                    isAttacking: true,
                });
                const b1 = makeInstance(GRIZZLY, {
                    id: "mb-b1",
                    controllerId: "p1",
                    ownerId: "p1",
                    isSummoningSick: false,
                });
                const b2 = makeInstance(GRIZZLY, {
                    id: "mb-b2",
                    controllerId: "p1",
                    ownerId: "p1",
                    isSummoningSick: false,
                });
                const hand = attackerLoaded
                    ? [
                          makeInstance(GIANT_GROWTH, {
                              id: "mb-gg",
                              controllerId: "p2",
                              ownerId: "p2",
                              zone: "hand",
                          }),
                      ]
                    : [];
                const lands = attackerLoaded
                    ? [
                          makeInstance(FOREST, {
                              id: "mb-forest",
                              controllerId: "p2",
                              ownerId: "p2",
                              isTapped: false,
                          }),
                      ]
                    : [];
                return makeState({
                    phase: "DECLARE_BLOCKERS",
                    activePlayerId: "p2",
                    priorityPlayerId: "p1",
                    combat: {
                        attackerIds: ["mb-atk"],
                        confirmed: true,
                        blockerAssignments: {},
                        blockersConfirmed: false,
                    },
                    players: [
                        makePlayer("p1", { battlefield: [b1, b2] }),
                        makePlayer("p2", {
                            battlefield: [atk, ...lands],
                            hand,
                        }),
                    ],
                });
            };

            // Leaf-level guarantee (deterministic, the level the search consumes):
            // the SAME double-block scores strictly lower from the defender's view
            // when the attacker holds a castable trick than when it is empty.
            const doubleBlocked = (s: GameState): GameState => ({
                ...s,
                combat: {
                    ...s.combat!,
                    blockerAssignments: {
                        "mb-b1": ["mb-atk"],
                        "mb-b2": ["mb-atk"],
                    },
                    blockersConfirmed: true,
                },
            });
            const loadedVal = declaredBlockDelta(
                doubleBlocked(makeMultiBlock(true)),
                "p1"
            );
            const emptyVal = declaredBlockDelta(
                doubleBlocked(makeMultiBlock(false)),
                "p1"
            );
            expect(loadedVal).toBeLessThan(emptyVal);

            // And via the full search: against an empty-handed attacker the bot
            // commits the double-block (kills the 3/3 for free); against a loaded
            // attacker it does NOT walk both blockers into the likely pump.
            const emptyTrace = diagnose(
                "EP#8 cautious block — empty attacker",
                makeMultiBlock(false),
                "p1"
            );
            const loadedTrace = diagnose(
                "EP#8 cautious block — loaded attacker",
                makeMultiBlock(true),
                "p1"
            );
            const blockerCount = (label: string) =>
                (label.match(/block/gi) ?? []).length;
            // The empty-attacker line blocks at least as committedly as the
            // loaded line — caution never makes the bot block MORE into a trick.
            expect(blockerCount(loadedTrace.chosen)).toBeLessThanOrEqual(
                blockerCount(emptyTrace.chosen)
            );
        }
    );
});
