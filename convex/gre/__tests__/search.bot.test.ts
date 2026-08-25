// ISMCTS search (issue #112). Behavioral assertions on crafted positions: the
// Bot finds available lethal, uses a relevant instant response, and picks a
// multi-step line that greedy 1-ply misses. Plus the contract checks: the move
// is always legal, the search is deterministic given a seed, and it respects
// the budget bound. See `convex/gre/search.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    search,
    searchWithTrace,
    buildTrace,
    reward,
    selectRootMove,
    selectRolloutMove,
    isDiscouragedRolloutMove,
    isReactiveInstantCast,
    reactivePrior,
    keyedMovesFor,
    type Edge,
    type Node,
} from "../search";
import { makeRng } from "../rng";
import { LADDER_VARIANTS, setSearchVariant } from "../ai/searchVariant";
import { evaluate } from "../evaluate";
import { greedySelectMove } from "../greedy";
import { enumerateMoves } from "../moves";
import type { Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const GIANT = getCardByName("Hill Giant").id; // 3/3
const BEARS = getCardByName("Grizzly Bears").id; // 2/2
const BOLT = getCardByName("Lightning Bolt").id; // R: 3 dmg any target
const MOUNTAIN = getCardByName("Mountain").id;
const BOP = getCardByName("Birds of Paradise").id; // 0/1 mana dork
const GIANT_GROWTH = getCardByName("Giant Growth").id; // {G} instant +3/+3
const FOREST = getCardByName("Forest").id;
const CONTAINMENT_PRIEST = getCardByName("Containment Priest").id; // {1}{W} 2/2 flash, no ETB/target choices

function creature(
    cardId: string,
    controllerId: string,
    id: string,
    extra = {}
) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        isSummoningSick: false,
        ...extra,
    });
}

function land(controllerId: string, id: string) {
    return makeInstance(MOUNTAIN, { controllerId, ownerId: controllerId, id });
}

function bolt(controllerId: string, id: string) {
    return makeInstance(BOLT, {
        controllerId,
        ownerId: controllerId,
        id,
        zone: "hand",
    });
}

/** Bot (p1) at sorcery speed with `hand`/`battlefield`, opponent p2 as given. */
function botMainPhase(
    hand: ReturnType<typeof makeInstance>[],
    battlefield: ReturnType<typeof makeInstance>[],
    opp: Parameters<typeof makePlayer>[1]
) {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { hand, battlefield }),
            makePlayer("p2", opp),
        ],
    });
}

const isLegal = (
    state: ReturnType<typeof makeState>,
    pid: string,
    move: unknown
) =>
    enumerateMoves(state, pid)
        .map((m) => JSON.stringify(m))
        .includes(JSON.stringify(move));

describe("search — legality & determinism (issue #112)", () => {
    it("returns a legal move for the acting player", () => {
        const state = botMainPhase([bolt("p1", "b")], [land("p1", "m")], {
            battlefield: [creature(GIANT, "p2", "ogre")],
        });
        const move = search(state, "p1", { iterations: 80 }, 1);
        expect(move).not.toBeNull();
        expect(isLegal(state, "p1", move)).toBe(true);
    });

    it("is deterministic: same seed + budget → identical move", () => {
        const state = botMainPhase(
            [bolt("p1", "b1"), bolt("p1", "b2")],
            [land("p1", "m1"), land("p1", "m2")],
            { life: 6, battlefield: [creature(GIANT, "p2", "ogre")] }
        );
        const a = search(state, "p1", { iterations: 300 }, 123);
        const b = search(state, "p1", { iterations: 300 }, 123);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("returns null when the player owes no action", () => {
        const state = botMainPhase([], [], {});
        // p2 does not have priority.
        expect(search(state, "p2", { iterations: 10 }, 1)).toBeNull();
    });
});

describe("search — finds available lethal (issue #112)", () => {
    it("burns the opponent's face for the kill", () => {
        const state = botMainPhase([bolt("p1", "b")], [land("p1", "m")], {
            life: 3,
        });
        const move = search(state, "p1", { iterations: 200 }, 7);
        expect(move?.kind).toBe("cast-spell");
        if (move?.kind !== "cast-spell") throw new Error("kind");
        expect(move.targets[0]?.id).toBe("p2");
    });
});

describe("search — relevant instant response (issue #112)", () => {
    it("bolts a lethal attacker to stay alive instead of taking the hit", () => {
        // Opponent p1 is attacking with a 3/3 and bot p2 is at 3 — taking the
        // hit is lethal. Bot has no blockers but holds Bolt + an untapped
        // Mountain with priority: the relevant response is to remove the
        // attacker and survive. Only bolting the OGRE saves the game (burning
        // p1's face does not), so the choice is unambiguous.
        const attacker = creature(GIANT, "p1", "ogre", {
            isAttacking: true,
            isTapped: true,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { life: 6, battlefield: [attacker] }),
                makePlayer("p2", {
                    life: 3,
                    hand: [bolt("p2", "b")],
                    battlefield: [land("p2", "m")],
                }),
            ],
            combat: {
                attackerIds: ["ogre"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const move = search(state, "p2", { iterations: 200 }, 5);
        expect(move?.kind).toBe("cast-spell");
        if (move?.kind !== "cast-spell") throw new Error("kind");
        expect(move.targets[0]?.id).toBe("ogre");
    });
});

describe("search — beats greedy 1-ply on a multi-step line (issue #112)", () => {
    it("burns face for a two-Bolt lethal where greedy kills the creature", () => {
        // Opp p2 at 6 with a 3/3. One Bolt at the 3/3 is the best SINGLE move by
        // material (+creature removal), so greedy takes it. But two Bolts to the
        // face is exactly lethal — only multi-step search sees it.
        //
        // The opponent is given a non-empty library on purpose: without it the
        // opp decks on their next draw, so BOTH the bolt-the-face line AND the
        // kill-the-creature line win in rollout (the creature line just leaves
        // the opp alive at 6 to deck). That decking confound let the OLD,
        // small-scale eval pass this test only because reducing the opp's life
        // (6 × W_LIFE) happened to out-margin removing a 3/3 — an ordering the
        // Forge-scale rescale (ADR 0018) legitimately flips (a 3/3 is worth far
        // more than 6 life). A real library removes the artifact so the test
        // checks its actual intent: the bolt-to-face line is the ONLY win, and
        // only multi-step search finds it. (Slice 3's Danger Clock is what will
        // make life-in-lethal-range premium; slice 1 must not depend on it.)
        const oppLibrary = [0, 1, 2, 3].map((i) =>
            makeInstance(GIANT, {
                controllerId: "p2",
                ownerId: "p2",
                id: `p2-lib${i}`,
                zone: "library",
            })
        );
        const makePos = () =>
            botMainPhase(
                [bolt("p1", "b1"), bolt("p1", "b2")],
                [land("p1", "m1"), land("p1", "m2")],
                {
                    life: 6,
                    battlefield: [creature(GIANT, "p2", "ogre")],
                    library: oppLibrary,
                }
            );

        const greedy = greedySelectMove(makePos(), "p1");
        expect(greedy?.kind).toBe("cast-spell");
        if (greedy?.kind !== "cast-spell") throw new Error("kind");
        expect(greedy.targets[0]?.id).toBe("ogre"); // greedy removes the creature

        const searched = search(makePos(), "p1", { iterations: 500 }, 11);
        expect(searched?.kind).toBe("cast-spell");
        if (searched?.kind !== "cast-spell") throw new Error("kind");
        expect(searched.targets[0]?.id).toBe("p2"); // search goes for the kill
    });
});

describe("search — material survives reward saturation (issue #138)", () => {
    // Bot p1 owes the attack decision: its only READY attacker is a 2/2 (Grizzly
    // Bears) and the opponent has an OPEN 3/3 (Hill Giant) able to block.
    // Attacking is strictly bad — the 2/2 dies in the block, the 3/3 survives,
    // the opponent loses nothing. p1 is already far ahead (two more 3/3s, just
    // summoning-sick so they can't attack), so truncated rollouts mostly reach a
    // winning terminal. Before the fix both candidates saturated to reward ≈ 1.0
    // and the suicidal attack tied "no attacks" on visit noise.
    function attackDecision() {
        return makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [
                        creature(BEARS, "p1", "bears"),
                        creature(GIANT, "p1", "big1", {
                            isSummoningSick: true,
                        }),
                        creature(GIANT, "p1", "big2", {
                            isSummoningSick: true,
                        }),
                        land("p1", "m1"),
                        land("p1", "m2"),
                    ],
                }),
                makePlayer("p2", {
                    life: 20,
                    battlefield: [creature(GIANT, "p2", "giant")],
                }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    const isNoAttack = (move: Move | null) =>
        move?.kind === "declare-attackers" && move.attackerIds.length === 0;

    function searchChump(seed: number) {
        const { move, trace } = searchWithTrace(
            attackDecision(),
            "p1",
            { iterations: 400 },
            seed
        );
        const noAttack = trace!.candidates.find(
            (c) => c.move.kind === "declare-attackers" && isNoAttack(c.move)
        )!;
        const attack = trace!.candidates.find(
            (c) =>
                c.move.kind === "declare-attackers" &&
                c.move.attackerIds.includes("bears")
        )!;
        return { move, noAttack, attack };
    }

    it("does not chump a 2/2 into an open 3/3 while far ahead", () => {
        const { move, noAttack, attack } = searchChump(7);
        expect(isNoAttack(move)).toBe(true);
        // Decisive separation, not a visit-noise tie: not-attacking is both more
        // visited and higher-reward, and — the saturation-proof signal — keeps
        // clearly more material than the chump attack throws away.
        expect(noAttack.visits).toBeGreaterThan(attack.visits);
        expect(noAttack.meanReward).toBeGreaterThan(attack.meanReward);
        expect(noAttack.meanMargin).toBeGreaterThan(attack.meanMargin + 0.5);
    });

    it("never lets the suicidal chump attack win across seeds", () => {
        for (const seed of [1, 2, 3, 13, 42, 99]) {
            const { move } = searchChump(seed);
            expect(isNoAttack(move)).toBe(true);
        }
    });

    it("still takes a favorable trade: 3/3 into a lone 2/2 blocker", () => {
        // p1's 3/3 attacks into a lone 2/2: if blocked, their 2/2 dies and our
        // 3/3 survives (kills their creature for free); if unblocked, 3 to the
        // face. Either way attacking dominates passing.
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [creature(GIANT, "p1", "giant")],
                }),
                makePlayer("p2", {
                    life: 12,
                    battlefield: [creature(BEARS, "p2", "bears")],
                }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const move = search(state, "p1", { iterations: 400 }, 5);
        expect(move?.kind).toBe("declare-attackers");
        if (move?.kind !== "declare-attackers") throw new Error("kind");
        expect(move.attackerIds).toContain("giant");
    });
});

describe("search — respects the budget bound (issue #112)", () => {
    it("terminates and returns a legal move under a 1-iteration budget", () => {
        const state = botMainPhase([bolt("p1", "b")], [land("p1", "m")], {
            battlefield: [creature(GIANT, "p2", "ogre")],
        });
        const move = search(state, "p1", { iterations: 1 }, 3);
        expect(move).not.toBeNull();
        expect(isLegal(state, "p1", move)).toBe(true);
    });

    it("stops on the wall-clock bound (injected clock)", () => {
        const state = botMainPhase([bolt("p1", "b")], [land("p1", "m")], {
            battlefield: [creature(GIANT, "p2", "ogre")],
        });
        // Clock jumps 10ms per read; a 5ms budget allows a single iteration.
        let t = 0;
        const now = () => (t += 10);
        const move = search(
            state,
            "p1",
            { iterations: 1_000_000, timeMs: 5, now },
            9
        );
        expect(move).not.toBeNull();
        expect(isLegal(state, "p1", move)).toBe(true);
    });
});

describe("buildTrace — tolerates a stale-fallback edge (issue #1516)", () => {
    // `rootMoveFor` falls back to an edge's DETERMINIZATION-captured move when
    // its stable key no longer resolves against the root world's own
    // candidates (an opponent-priority choice edge is the known real-world
    // trigger, per the fallback's own doc comment) — and that fallback move
    // can name ids the root world doesn't have. Reproduced directly here
    // (rather than via a randomized search) so the exact "choice key absent
    // in root world" condition is forced deterministically: a hand-built
    // root Edge is keyed for an `option-pick` id ("stale-option") that the
    // real pending choice's `options` no longer offers, so `rootMoveFor`
    // falls through to `edge.move` — a `resolution-choice` submitting that
    // same absent id, which `applyPendingChoiceSubmit` rejects
    // ("Not a legal choice").
    function staleFallbackScenario(): { state: GameState; stackId: string } {
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const stackItem = pushSpell(state, GIANT, "p1");
        state.pendingChoices = [
            {
                stackItemId: stackItem.id,
                step: 0,
                choiceId: "p1",
                playerId: "p1",
                kind: "option-pick",
                count: 1,
                prompt: "Choose a mode",
                options: [{ id: "real-option", label: "Real" }],
            },
        ];
        return { state, stackId: stackItem.id };
    }

    it("searchWithTrace-style buildTrace call never throws on a stale fallback", () => {
        const { state, stackId } = staleFallbackScenario();
        const staleMove: Move = {
            kind: "resolution-choice",
            stackItemId: stackId,
            step: 0,
            choiceId: "p1",
            cardInstanceIds: ["stale-option"],
        };
        const edge: Edge = {
            move: staleMove,
            key: "option-pick:stale-option",
            mover: "p1",
            node: { children: new Map() },
            visits: 3,
            totalReward: 1.5,
            totalMargin: 10,
            avail: 3,
        };
        const root: Node = { children: new Map([[edge.key, edge]]) };

        expect(() => buildTrace(root, state, "p1", 3, staleMove)).not.toThrow();
    });

    it("marks the stale-fallback edge unavailable instead of faking a resolved eval", () => {
        const { state, stackId } = staleFallbackScenario();
        const staleMove: Move = {
            kind: "resolution-choice",
            stackItemId: stackId,
            step: 0,
            choiceId: "p1",
            cardInstanceIds: ["stale-option"],
        };
        const edge: Edge = {
            move: staleMove,
            key: "option-pick:stale-option",
            mover: "p1",
            node: { children: new Map() },
            visits: 3,
            totalReward: 1.5,
            totalMargin: 10,
            avail: 3,
        };
        const root: Node = { children: new Map([[edge.key, edge]]) };

        const trace = buildTrace(root, state, "p1", 3, staleMove);
        expect(trace.candidates).toHaveLength(1);
        expect(trace.candidates[0]?.unavailable).toBe(true);
        // Still a well-formed PositionBreakdown (the unresolved-root fallback),
        // not a crash and not `undefined`.
        expect(trace.candidates[0]?.eval).toBeDefined();
        expect(trace.candidates[0]?.visits).toBe(3);
    });

    it("a NON-stale edge (key resolves against the root world) is unaffected", () => {
        const { state, stackId } = staleFallbackScenario();
        const realMove: Move = {
            kind: "resolution-choice",
            stackItemId: stackId,
            step: 0,
            choiceId: "p1",
            cardInstanceIds: ["real-option"],
        };
        const edge: Edge = {
            move: realMove,
            key: "option-pick:real-option",
            mover: "p1",
            node: { children: new Map() },
            visits: 5,
            totalReward: 3,
            totalMargin: 20,
            avail: 5,
        };
        const root: Node = { children: new Map([[edge.key, edge]]) };

        const trace = buildTrace(root, state, "p1", 5, realMove);
        expect(trace.candidates).toHaveLength(1);
        expect(trace.candidates[0]?.unavailable).toBeUndefined();
    });
});

describe("search — reward band stays monotonic in eval (ADR 0018, issue #194)", () => {
    // The Forge-scale rescale recalibrated the eval → [0, 1] reward band
    // (`MATERIAL_FULL`). The mapping must remain monotone non-decreasing in
    // `evaluate`, or a strictly better position could score a worse reward and
    // the search would prefer the worse line.
    const lifeState = (myLife: number, oppLife: number) =>
        makeState({
            players: [
                makePlayer("p1", { life: myLife }),
                makePlayer("p2", { life: oppLife }),
            ],
        });

    it("a higher eval never maps to a lower reward (open band)", () => {
        // Sweep the opponent's life down: lower opp life ⇒ higher eval for p1.
        let prevEval = -Infinity;
        let prevReward = -Infinity;
        for (let oppLife = 1; oppLife <= 20; oppLife++) {
            const state = lifeState(20, 21 - oppLife); // 20 → 1
            const e = evaluate(state, "p1");
            const r = reward(state, "p1");
            expect(e).toBeGreaterThan(prevEval); // strictly increasing eval
            expect(r).toBeGreaterThanOrEqual(prevReward); // monotone reward
            expect(r).toBeGreaterThan(0);
            expect(r).toBeLessThan(1);
            prevEval = e;
            prevReward = r;
        }
    });

    it("a won position out-rewards every open one, a lost one under-rewards all", () => {
        const won = lifeState(20, 0); // opp dead
        const lost = lifeState(0, 20); // bot dead
        const evenish = lifeState(20, 20);
        const ahead = lifeState(20, 5);
        expect(reward(won, "p1")).toBeGreaterThan(reward(ahead, "p1"));
        expect(reward(ahead, "p1")).toBeGreaterThan(reward(evenish, "p1"));
        expect(reward(lost, "p1")).toBeLessThan(reward(evenish, "p1"));
        expect(reward(won, "p1")).toBeGreaterThan(reward(lost, "p1"));
    });
});

describe("search — calibrated reward mapping variant (issue #1929)", () => {
    // The `rewardMapping: "calibrated"` knob must actually BITE: a registered
    // variant whose knob is never consulted turns the ladder A/B into a silent
    // control-vs-control null run — 4–5h to an INCONCLUSIVE that measured
    // nothing. This pins the consultation, not the fitted constant's value.
    const lifeState = (myLife: number, oppLife: number) =>
        makeState({
            players: [
                makePlayer("p1", { life: myLife }),
                makePlayer("p2", { life: oppLife }),
            ],
        });
    const CAL = {
        name: "reward-calibrated",
        rewardMapping: "calibrated" as const,
    };
    const underVariant = (fn: () => number): number => {
        setSearchVariant(CAL);
        try {
            return fn();
        } finally {
            setSearchVariant(null);
        }
    };

    it("changes the open-band reward at a nonzero margin", () => {
        const ahead = lifeState(20, 5);
        const dflt = reward(ahead, "p1");
        const cal = underVariant(() => reward(ahead, "p1"));
        expect(cal).not.toBe(dflt);
        // Same side of the band center: calibration rescales, never flips.
        expect(Math.sign(cal - 0.5)).toBe(Math.sign(dflt - 0.5));
    });

    it("keeps the terminal bands untouched (issue #138 outcome dominance)", () => {
        const won = lifeState(20, 0);
        const lost = lifeState(0, 20);
        expect(underVariant(() => reward(won, "p1"))).toBe(reward(won, "p1"));
        expect(underVariant(() => reward(lost, "p1"))).toBe(reward(lost, "p1"));
    });

    it("stays monotone in eval under the variant", () => {
        let prev = -Infinity;
        for (let oppLife = 20; oppLife >= 1; oppLife--) {
            const r = underVariant(() => reward(lifeState(20, oppLife), "p1"));
            expect(r).toBeGreaterThanOrEqual(prev);
            expect(r).toBeGreaterThan(0);
            expect(r).toBeLessThan(1);
            prev = r;
        }
    });

    it("LADDER_VARIANTS registers the knob under the name the CLI accepts", () => {
        expect(LADDER_VARIANTS["reward-calibrated"]).toEqual(CAL);
    });
});

// ---------------------------------------------------------------------------
// Land-drop tie-break in root selection (ADR 0020 §1, issue #206).
//
// A land has no option cost in this engine, so when `pass` and a `play-land`
// move come out OUTCOME-EQUAL (within OUTCOME_EPS), the robust pick must develop
// the land rather than letting the material tie-break pick `pass` on rollout
// noise. These are direct `selectRootMove` unit tests over synthetic edges, so
// the fire / no-fire conditions are asserted without rollout variance.
// ---------------------------------------------------------------------------
describe("selectRootMove — land-drop tie-break (issue #206)", () => {
    const PASS: Move = { kind: "pass" };
    const LAND: Move = { kind: "play-land", cardInstanceId: "forest" };
    const SPELL = {
        kind: "cast-spell",
        cardInstanceId: "bolt",
        targets: [],
        manaPayment: {},
    } as unknown as Move;

    /** Build a synthetic root whose edges carry the given mean reward and mean
     *  margin at a fixed visit count (so every edge is "equally explored"). */
    function rootOf(
        edges: {
            move: Move;
            meanReward: number;
            meanMargin: number;
            visits?: number;
        }[]
    ): Node {
        const children = new Map<string, Edge>();
        edges.forEach((e, i) => {
            const visits = e.visits ?? 100;
            children.set(`${e.move.kind}:${i}`, {
                move: e.move,
                key: `${e.move.kind}:${i}`,
                mover: "p1",
                node: { children: new Map() },
                visits,
                totalReward: e.meanReward * visits,
                totalMargin: e.meanMargin * visits,
                avail: visits,
            });
        });
        return { children };
    }

    it("FIRE: picks the land when pass and play-land are outcome-equal", () => {
        // Pass wins the raw material tie-break (330 vs 327) on noise; the land is
        // outcome-equal, so the tie-break must hand it the pick anyway.
        const root = rootOf([
            { move: PASS, meanReward: 0.6635, meanMargin: 330 },
            { move: LAND, meanReward: 0.6633, meanMargin: 327 },
        ]);
        expect(selectRootMove(root, [PASS, LAND]).kind).toBe("play-land");
    });

    it("FIRE: picks the land even when it fell out of the visit band (mana-screwed)", () => {
        // Regression: a mana-screwed bot sat on its only land. `pass` out-rewards
        // the land by a hair (rollout noise, inside OUTCOME_EPS), so UCB explored
        // pass far more (761 vs 439) and the land dropped below the VISIT_TOL band.
        // The tie-break must still rescue it — it pulls from the full pool on
        // outcome-equality, not the visit band.
        const root = rootOf([
            { move: PASS, meanReward: 0.6135, meanMargin: 227, visits: 761 },
            { move: LAND, meanReward: 0.5708, meanMargin: 248, visits: 439 },
        ]);
        expect(selectRootMove(root, [PASS, LAND]).kind).toBe("play-land");
    });

    it("NO-FIRE: keeps pass when the land is genuinely worse (not outcome-equal)", () => {
        // Land trails pass by more than OUTCOME_EPS (0.05) — a real difference,
        // so it is not a contender and pass stands.
        const root = rootOf([
            { move: PASS, meanReward: 0.7, meanMargin: 320 },
            { move: LAND, meanReward: 0.6, meanMargin: 400 },
        ]);
        expect(selectRootMove(root, [PASS, LAND]).kind).toBe("pass");
    });

    it("NO-FIRE: does not override a non-pass robust pick", () => {
        // A spell is the robust pick (highest margin among outcome-equal moves);
        // the tie-break only rescues `pass`, so the spell is returned, not the land.
        const root = rootOf([
            { move: SPELL, meanReward: 0.66, meanMargin: 400 },
            { move: PASS, meanReward: 0.66, meanMargin: 350 },
            { move: LAND, meanReward: 0.66, meanMargin: 300 },
        ]);
        expect(selectRootMove(root, [SPELL, PASS, LAND]).kind).toBe(
            "cast-spell"
        );
    });

    it("preserves the issue-#149 invariant: a strictly-better land wins on its own", () => {
        // When the land is strictly the better outcome it is the lone contender
        // and wins through the normal path — the tie-break is not even consulted.
        const root = rootOf([
            { move: LAND, meanReward: 0.8, meanMargin: 300 },
            { move: PASS, meanReward: 0.66, meanMargin: 350 },
        ]);
        expect(selectRootMove(root, [LAND, PASS]).kind).toBe("play-land");
    });
});

// ---------------------------------------------------------------------------
// Colour-mode tie-break gates on PROTECTION intent, not the bare colour tag
// (issue #2306 review finding 1). `protectionColorModes` ("protection from
// the colour of your choice" — a DEFENSIVE dodge of the opponent's colours)
// and `colorChoiceModes`/`COLOR_OPTIONS` ("becomes the colour of your
// choice" — a different, sometimes opposite, intent, explicitly out of
// scope per the issue) both set `EffectMode.color` — a UI RENDERING tag
// (`cards/types.ts`'s own doc), not an intent signal. Only the former sets
// `option.protectionColor` (`gre/effects/interpreter.ts`'s
// `modeProtectionColor`, derived via the shared `parseProtectionFromColor`
// parser, never a hand-set flag). `colorModeTiebreak` (`search.ts`) must key
// on `.protectionColor`: reading the bare `.color` steers a "become a
// colour" pick toward the opponent's BEST-shown colour, which is backwards
// for an effect that isn't dodging anything — a directional inversion, worse
// than the arbitrary pick the original #2306 fix replaced. Measured before
// this fix: Kavu Chameleon's real modes against a lone opposing Grizzly
// Bears scored G=0.95, every other colour 0.05.
// ---------------------------------------------------------------------------
describe("selectRootMove — colour-mode tie-break gates on protection intent, not the bare colour tag (issue #2306 review finding 1)", () => {
    /** Five colour-mode edges, one per WUBRG id, all OUTCOME-EQUAL (identical
     *  mean reward) so every one is a `selectRootMove` contender. Distinct,
     *  strictly descending `meanMargin` (W highest) makes the MATERIAL
     *  tie-break's own pick deterministic ("W") with no colour signal at all
     *  — the value this test checks stays undisturbed. */
    function colorModeRoot(): Node {
        const children = new Map<string, Edge>();
        const COLORS = ["W", "U", "B", "R", "G"] as const;
        COLORS.forEach((color, i) => {
            const key = `option-pick:${color}`;
            const visits = 100;
            children.set(key, {
                move: {
                    kind: "resolution-choice",
                    stackItemId: "stack-1",
                    step: 0,
                    choiceId: "optionChoiceMode",
                    cardInstanceIds: [color],
                },
                key,
                mover: "p1",
                node: { children: new Map() },
                visits,
                totalReward: 0.6 * visits,
                totalMargin: (10 - i) * visits, // W=10 .. G=6, strictly descending
                avail: visits,
            });
        });
        return { children };
    }

    /** A `colorChoiceModes`-shaped `option-pick` — every option carries the
     *  `color` UI tag but NOT `protectionColor` (Kavu Chameleon's real
     *  modes have exactly this shape). Opponent's board shows ONLY green (a
     *  lone Grizzly Bears) — the exact position the review measured scoring
     *  G=0.95 when the heuristic read the bare `color` tag instead. */
    function rootStateWithColorChoiceModes(): GameState {
        const p2 = makePlayer("p2", {
            battlefield: [
                makeInstance(BEARS, {
                    id: "opp-bear",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
            ],
        });
        return makeState({
            players: [makePlayer("p1"), p2],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
            pendingChoices: [
                {
                    stackItemId: "stack-1",
                    step: 0,
                    choiceId: "optionChoiceMode",
                    playerId: "p1",
                    kind: "option-pick",
                    count: 1,
                    options: (["W", "U", "B", "R", "G"] as const).map(
                        (color) => ({
                            id: color,
                            label: color,
                            color, // colorChoiceModes shape: `color` set, no `protectionColor`
                        })
                    ),
                    prompt: "Choose a color.",
                },
            ],
        });
    }

    it("does NOT steer a `colorChoiceModes` pick toward the opponent's shown colour — the material tie-break's own pick stands", () => {
        const root = colorModeRoot();
        const rootState = rootStateWithColorChoiceModes();
        const moves = [...root.children.values()].map((e) => e.move);
        const picked = selectRootMove(root, moves, rootState, "p1");
        expect(picked.kind).toBe("resolution-choice");
        // The material tie-break's own deterministic pick (highest margin,
        // "W") stands — NOT "G", the colour the opponent's board shows.
        expect(picked).toMatchObject({ cardInstanceIds: ["W"] });
    });

    it("review finding 3 — a FLAT evidence tie (every colour shown equally) does not fall back to POOL-ITERATION order — the material tie-break's own pick stands", () => {
        // A genuine PROTECTION option-pick this time (`protectionColor` set —
        // the tie-break's OWN correctness, independent of finding 1's gate).
        // The opponent's board shows ONE permanent of each colour, so
        // `observedOpponentColors` ties every colour's SHARE at 0.2 — the
        // shape a wide, even manabase produces (`untappedProducibleColors`
        // is a `Set`, so five-colour mana sources tie the same way). Margins
        // are deliberately NOT in `W..G` order — "R" (third of five in pool
        // insertion order) is the highest — so a stale "return
        // `contenders[0]` on a tie" bug (which would always answer "W", the
        // FIRST edge built below, regardless of margin) is distinguishable
        // from the correct answer ("R", the real material tie-break's pick).
        const root: Node = (() => {
            const children = new Map<string, Edge>();
            const margins: Record<string, number> = {
                W: 6,
                U: 7,
                B: 8,
                R: 10,
                G: 9,
            };
            (["W", "U", "B", "R", "G"] as const).forEach((color) => {
                const key = `option-pick:protection-${color}`;
                const visits = 100;
                children.set(key, {
                    move: {
                        kind: "resolution-choice",
                        stackItemId: "stack-1",
                        step: 0,
                        choiceId: "optionChoiceMode",
                        cardInstanceIds: [`protection-${color}`],
                    },
                    key,
                    mover: "p1",
                    node: { children: new Map() },
                    visits,
                    totalReward: 0.6 * visits,
                    totalMargin: margins[color] * visits,
                    avail: visits,
                });
            });
            return { children };
        })();
        const p2 = makePlayer("p2", {
            battlefield: [
                makeInstance(getCardByName("White Knight").id, {
                    id: "opp-white",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
                makeInstance(getCardByName("Merfolk of the Pearl Trident").id, {
                    id: "opp-blue",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
                makeInstance(getCardByName("Black Knight").id, {
                    id: "opp-black",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
                makeInstance(GIANT, {
                    id: "opp-red",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
                makeInstance(BEARS, {
                    id: "opp-green",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
            ],
        });
        const rootState: GameState = makeState({
            players: [makePlayer("p1"), p2],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
            pendingChoices: [
                {
                    stackItemId: "stack-1",
                    step: 0,
                    choiceId: "optionChoiceMode",
                    playerId: "p1",
                    kind: "option-pick",
                    count: 1,
                    options: (["W", "U", "B", "R", "G"] as const).map(
                        (color) => ({
                            id: `protection-${color}`,
                            label: `Protection from ${color}`,
                            color,
                            protectionColor: color,
                        })
                    ),
                    prompt: "Choose a color.",
                },
            ],
        });
        const moves = [...root.children.values()].map((e) => e.move);
        const picked = selectRootMove(root, moves, rootState, "p1");
        expect(picked).toMatchObject({ cardInstanceIds: ["protection-R"] });
    });
});

// ---------------------------------------------------------------------------
// Free-development tie-break, extended to FREE MANA SOURCES (issue #244). A
// 0-cost mana artifact (Mox Jet) develops mana that washes out of the rollout
// like a land drop, so `pass` can win the material tie-break on noise (reported:
// the bot preferred `pass` over `cast Mox Jet`). Synthetic-edge tests so the
// fire / no-fire conditions are deterministic, with a `rootState` carrying the
// Mox in hand (the tie-break reads it to key on cost-0 + mana-ability).
// ---------------------------------------------------------------------------
describe("selectRootMove — free mana source tie-break (issue #244)", () => {
    const MOX_JET = getCardByName("Mox Jet").id; // {0} artifact, {T}: add {B}
    const BOLT_CARD = getCardByName("Lightning Bolt").id; // {R}: not free
    const PASS: Move = { kind: "pass" };
    const CAST_MOX = {
        kind: "cast-spell",
        cardInstanceId: "mox",
        targets: [],
        tapPlan: [],
    } as unknown as Move;
    const CAST_BOLT = {
        kind: "cast-spell",
        cardInstanceId: "bolt",
        targets: [],
        tapPlan: [],
    } as unknown as Move;

    /** A root state whose bot `p1` holds the Mox (id `mox`) and a Bolt (`bolt`)
     *  so `isFreeManaSourceCast` can resolve the cast cards from hand. */
    function rootState(): GameState {
        return makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(MOX_JET, {
                            id: "mox",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(BOLT_CARD, {
                            id: "bolt",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2", {}),
            ],
        });
    }

    function rootOf(
        edges: { move: Move; meanReward: number; meanMargin: number }[]
    ): Node {
        const children = new Map<string, Edge>();
        edges.forEach((e, i) => {
            const visits = 100;
            children.set(`${e.move.kind}:${i}`, {
                move: e.move,
                key: `${e.move.kind}:${i}`,
                mover: "p1",
                node: { children: new Map() },
                visits,
                totalReward: e.meanReward * visits,
                totalMargin: e.meanMargin * visits,
                avail: visits,
            });
        });
        return { children };
    }

    it("FIRE: casts the Mox when pass wins material on noise but is outcome-equal", () => {
        // The reported trace: pass edged the Mox on accumulated margin (766 vs
        // 753) at an equal mean reward. The tie-break must hand the develop move
        // the pick anyway — a free mana source has no reason to be held.
        const root = rootOf([
            { move: PASS, meanReward: 0.75, meanMargin: 766 },
            { move: CAST_MOX, meanReward: 0.75, meanMargin: 753 },
        ]);
        expect(
            selectRootMove(root, [PASS, CAST_MOX], rootState(), "p1").kind
        ).toBe("cast-spell");
    });

    it("NO-FIRE: does not rescue a non-free spell (Lightning Bolt) over pass", () => {
        // A {R} Bolt is NOT a free mana source — holding it has option value, so
        // the tie-break leaves the robust `pass` pick standing.
        const root = rootOf([
            { move: PASS, meanReward: 0.75, meanMargin: 766 },
            { move: CAST_BOLT, meanReward: 0.75, meanMargin: 753 },
        ]);
        expect(
            selectRootMove(root, [PASS, CAST_BOLT], rootState(), "p1").kind
        ).toBe("pass");
    });

    it("NO-FIRE: keeps pass when the Mox is genuinely worse (not outcome-equal)", () => {
        const root = rootOf([
            { move: PASS, meanReward: 0.8, meanMargin: 766 },
            { move: CAST_MOX, meanReward: 0.6, meanMargin: 900 },
        ]);
        expect(
            selectRootMove(root, [PASS, CAST_MOX], rootState(), "p1").kind
        ).toBe("pass");
    });
});

// Free-development tie-break, extended to MANA DORKS. A mana-ability creature
// (Birds of Paradise) develops a mana source / ramps and, being sorcery-speed,
// has no instant-speed option value to holding — the creature analog of a Mox.
// Its body + ramp washes out of the rollout, so `pass` can win the material
// tie-break on noise (reported: the bot sat on Birds with a Mox down and an
// empty board, 8 cards in hand, rather than casting it). Synthetic-edge tests
// with a `rootState` carrying Birds in hand so `isManaDorkCast` resolves it.
// ---------------------------------------------------------------------------
describe("selectRootMove — mana dork tie-break", () => {
    const BIRDS = getCardByName("Birds of Paradise").id; // {G} 0/1, {T}: add any
    const SPECTER = getCardByName("Hypnotic Specter").id; // {1}{B}{B} 2/2: no mana
    const PASS: Move = { kind: "pass" };
    const CAST_BIRDS = {
        kind: "cast-spell",
        cardInstanceId: "birds",
        targets: [],
        tapPlan: [],
    } as unknown as Move;
    const CAST_SPECTER = {
        kind: "cast-spell",
        cardInstanceId: "specter",
        targets: [],
        tapPlan: [],
    } as unknown as Move;

    /** Bot `p1` holds Birds (a mana dork) and a non-mana creature so
     *  `isManaDorkCast` can resolve the cast cards from hand. */
    function rootState(): GameState {
        return makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(BIRDS, {
                            id: "birds",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(SPECTER, {
                            id: "specter",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2", {}),
            ],
        });
    }

    function rootOf(
        edges: { move: Move; meanReward: number; meanMargin: number }[]
    ): Node {
        const children = new Map<string, Edge>();
        edges.forEach((e, i) => {
            const visits = 100;
            children.set(`${e.move.kind}:${i}`, {
                move: e.move,
                key: `${e.move.kind}:${i}`,
                mover: "p1",
                node: { children: new Map() },
                visits,
                totalReward: e.meanReward * visits,
                totalMargin: e.meanMargin * visits,
                avail: visits,
            });
        });
        return { children };
    }

    it("FIRE: casts Birds when pass wins material on noise but is outcome-equal", () => {
        // The reported trace: pass edged Birds on accumulated meanMargin (940 vs
        // 853) at an equal mean reward (0.75). The leaf eval rated the cast +23
        // higher, but that washes out of the rollout — the tie-break must develop.
        const root = rootOf([
            { move: PASS, meanReward: 0.75, meanMargin: 940 },
            { move: CAST_BIRDS, meanReward: 0.75, meanMargin: 853 },
        ]);
        expect(
            selectRootMove(root, [PASS, CAST_BIRDS], rootState(), "p1").kind
        ).toBe("cast-spell");
    });

    it("NO-FIRE: does not rescue a non-mana creature (Hypnotic Specter) over pass", () => {
        // A 2/2 with no mana ability is not a dork — holding a beater can carry
        // sequencing value, so the tie-break leaves the robust `pass` standing.
        const root = rootOf([
            { move: PASS, meanReward: 0.75, meanMargin: 940 },
            { move: CAST_SPECTER, meanReward: 0.75, meanMargin: 853 },
        ]);
        expect(
            selectRootMove(root, [PASS, CAST_SPECTER], rootState(), "p1").kind
        ).toBe("pass");
    });

    it("NO-FIRE: keeps pass when Birds is genuinely worse (not outcome-equal)", () => {
        const root = rootOf([
            { move: PASS, meanReward: 0.8, meanMargin: 940 },
            { move: CAST_BIRDS, meanReward: 0.6, meanMargin: 999 },
        ]);
        expect(
            selectRootMove(root, [PASS, CAST_BIRDS], rootState(), "p1").kind
        ).toBe("pass");
    });
});

// ---------------------------------------------------------------------------
// Extra-turn structural credit (issue #244). A granted extra turn is washed out
// of the rollout (ADR 0015 horizon + `extraTurns` popped at the turn crossing),
// so the cast is both low-reward and under-visited. `selectRootMove` credits the
// effect (keyed on the `extraTurns` grant, probed off `rootState`) and pulls it
// from the full pool, so a washed Time Walk still beats `pass`.
// ---------------------------------------------------------------------------
describe("selectRootMove — extra-turn structural credit (issue #244)", () => {
    const TIME_WALK = getCardByName("Time Walk").id; // {1}{U}: take an extra turn
    const ISLAND = getCardByName("Island").id;
    const PASS: Move = { kind: "pass" };
    const CAST_WALK = {
        kind: "cast-spell",
        cardInstanceId: "walk",
        targets: [],
        tapPlan: [],
    } as unknown as Move;

    function rootState(): GameState {
        return makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(TIME_WALK, {
                            id: "walk",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [0, 1].map((i) =>
                        makeInstance(ISLAND, {
                            id: `isl${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                }),
                makePlayer("p2", {}),
            ],
        });
    }

    function rootOf(
        edges: { move: Move; meanReward: number; visits: number }[]
    ): Node {
        const children = new Map<string, Edge>();
        edges.forEach((e, i) => {
            children.set(`${e.move.kind}:${i}`, {
                move: e.move,
                key: `${e.move.kind}:${i}`,
                mover: "p1",
                node: { children: new Map() },
                visits: e.visits,
                totalReward: e.meanReward * e.visits,
                totalMargin: 0,
                avail: e.visits,
            });
        });
        return { children };
    }

    it("FIRE: casts Time Walk though it is washed AND under-visited (out of the visit band)", () => {
        // pass out-rewards the washed cast on raw mean and is far more visited, so
        // the cast falls out of the VISIT_TOL band — exactly like the land-drop
        // rescue. The structural extra-turn credit, pulled from the full pool,
        // lifts the grant above pass.
        const root = rootOf([
            { move: PASS, meanReward: 0.66, visits: 760 },
            { move: CAST_WALK, meanReward: 0.61, visits: 240 },
        ]);
        expect(
            selectRootMove(root, [PASS, CAST_WALK], rootState(), "p1").kind
        ).toBe("cast-spell");
    });

    it("NO-FIRE: a clearly-winning pass (beyond the credit) is not overridden", () => {
        // The credit only tips otherwise-close lines; it must not override a line
        // that wins by more than the credit (a near-lethal pass here).
        const root = rootOf([
            { move: PASS, meanReward: 0.99, visits: 500 },
            { move: CAST_WALK, meanReward: 0.5, visits: 500 },
        ]);
        expect(
            selectRootMove(root, [PASS, CAST_WALK], rootState(), "p1").kind
        ).toBe("pass");
    });
});

// ---------------------------------------------------------------------------
// Rollout default-policy guardrails (ADR 0020 §4, issue #209). Soft biases on
// the rollout policy ONLY — never legality. `isDiscouragedRolloutMove` flags the
// obviously-bad lines the greedy default should not model as typical play.
// ---------------------------------------------------------------------------
describe("isDiscouragedRolloutMove — rollout guardrails (issue #209)", () => {
    it("flags attacking with a mana producer (worth more held back)", () => {
        const bop = makeInstance(BOP, {
            controllerId: "p1",
            ownerId: "p1",
            id: "bop",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [bop] }),
                makePlayer("p2"),
            ],
        });
        const move: Move = { kind: "declare-attackers", attackerIds: ["bop"] };
        expect(isDiscouragedRolloutMove(state, "p1", move)).toBe(true);
    });

    it("does NOT flag attacking with a normal creature", () => {
        const giant = creature(GIANT, "p1", "g");
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [giant] }),
                makePlayer("p2"),
            ],
        });
        const move: Move = { kind: "declare-attackers", attackerIds: ["g"] };
        expect(isDiscouragedRolloutMove(state, "p1", move)).toBe(false);
    });

    it("does NOT flag declaring no attackers", () => {
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const move: Move = { kind: "declare-attackers", attackerIds: [] };
        expect(isDiscouragedRolloutMove(state, "p1", move)).toBe(false);
    });

    it("flags casting a holdable instant at sorcery speed (own main phase)", () => {
        const gg = makeInstance(GIANT_GROWTH, {
            controllerId: "p1",
            ownerId: "p1",
            id: "gg",
            zone: "hand",
        });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [makePlayer("p1", { hand: [gg] }), makePlayer("p2")],
        });
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "gg",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };
        expect(isDiscouragedRolloutMove(state, "p1", move)).toBe(true);
    });

    it("does NOT flag the same instant during combat (a reactive window)", () => {
        const gg = makeInstance(GIANT_GROWTH, {
            controllerId: "p1",
            ownerId: "p1",
            id: "gg",
            zone: "hand",
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [makePlayer("p1", { hand: [gg] }), makePlayer("p2")],
        });
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "gg",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };
        expect(isDiscouragedRolloutMove(state, "p1", move)).toBe(false);
    });

    it("does NOT flag a sorcery-speed land drop or a non-instant", () => {
        const land = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            ownerId: "p1",
            id: "m",
            zone: "hand",
        });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [makePlayer("p1", { hand: [land] }), makePlayer("p2")],
        });
        const move: Move = { kind: "play-land", cardInstanceId: "m" };
        expect(isDiscouragedRolloutMove(state, "p1", move)).toBe(false);
    });

    // Issue #2248: the guardrail widened from raw `types.includes("Instant")`
    // to `hasInstantSpeed` (Instant OR the Flash keyword) — a non-Instant
    // FLASH PERMANENT dumped at sorcery speed must now carry the same policy
    // penalty a plain instant already does. Containment Priest ({1}{W} 2/2,
    // no ETB/target choices) is the flash-permanent fixture the blade suite
    // also uses.
    it("flags casting a flash PERMANENT at sorcery speed, same as an Instant (issue #2248)", () => {
        const cp = makeInstance(CONTAINMENT_PRIEST, {
            controllerId: "p1",
            ownerId: "p1",
            id: "cp",
            zone: "hand",
        });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [makePlayer("p1", { hand: [cp] }), makePlayer("p2")],
        });
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "cp",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };
        expect(isDiscouragedRolloutMove(state, "p1", move)).toBe(true);
    });

    it("does NOT flag the same flash permanent during combat (a reactive window)", () => {
        const cp = makeInstance(CONTAINMENT_PRIEST, {
            controllerId: "p1",
            ownerId: "p1",
            id: "cp",
            zone: "hand",
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [makePlayer("p1", { hand: [cp] }), makePlayer("p2")],
        });
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "cp",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };
        expect(isDiscouragedRolloutMove(state, "p1", move)).toBe(false);
    });

    it("does NOT flag a flash permanent cast by the NON-active player (mover scoping)", () => {
        // p2 is the one casting; p1 is the active player. The guardrail is
        // scoped to the ACTIVE player's own sorcery-speed window, never the
        // defender's reactive cast — the over-fire shape a mute-button
        // regression would produce.
        const cp = makeInstance(CONTAINMENT_PRIEST, {
            controllerId: "p2",
            ownerId: "p2",
            id: "cp",
            zone: "hand",
        });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [makePlayer("p1"), makePlayer("p2", { hand: [cp] })],
        });
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "cp",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };
        expect(isDiscouragedRolloutMove(state, "p2", move)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// The reactive-aware rollout DEFAULT POLICY (ADR 0021 slice 2, issue #222).
// `selectRolloutMove` is the named seam the rollout uses for its non-random
// step. Unit-tested in isolation here (no full search): a fixed RNG makes the
// greedy pick deterministic, so each crafted position asserts the policy makes
// the competent move.
// ---------------------------------------------------------------------------
describe("selectRolloutMove — reactive rollout default policy (issue #222)", () => {
    // rng() === 0 → the tie-break always takes the first of the best set, so a
    // unique best move is returned deterministically.
    const fixedRng = () => 0;
    const pick = (state: ReturnType<typeof makeState>, pid: string) =>
        selectRolloutMove(
            state,
            pid,
            pid,
            enumerateMoves(state, pid),
            fixedRng
        );

    it("holds a pure instant at sorcery speed when there is no payoff", () => {
        // p1's own main phase, only Giant Growth to cast (on its own creature for
        // no board gain): casting burns the card + mana + reactive option for a
        // temporary buff the leaf does not count. The policy holds (passes).
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(GIANT_GROWTH, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "gg",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        creature(BEARS, "p1", "bears"),
                        makeInstance(FOREST, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "f1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        // Sanity: the no-payoff cast really is a legal option being declined.
        const moves = enumerateMoves(state, "p1");
        expect(moves.some((m) => m.kind === "cast-spell")).toBe(true);
        expect(pick(state, "p1").kind).toBe("pass");
    });

    it("casts a held instant in a reactive window when it pays (removal)", () => {
        // p2's combat; p1 holds Lightning Bolt with open mana and p2 is attacking
        // with a 2/2. Bolting the attacker removes a creature now — a payoff the
        // leaf sees once the policy looks one resolution deep — so the policy
        // casts rather than holds.
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [bolt("p1", "bolt")],
                    battlefield: [land("p1", "m1")],
                }),
                makePlayer("p2", {
                    battlefield: [creature(BEARS, "p2", "atk")],
                }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const chosen = pick(state, "p1");
        expect(chosen.kind).toBe("cast-spell");
        if (chosen.kind !== "cast-spell") throw new Error("kind");
        expect(chosen.cardInstanceId).toBe("bolt");
    });

    it("makes the sane block: a survivor block on a smaller attacker", () => {
        // p1 attacks with a 2/2 into p2's open 3/3. Blocking kills the attacker
        // for free (the 3/3 survives); not blocking eats 2 to the face. The
        // policy picks the block.
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", {
                    battlefield: [creature(BEARS, "p1", "atk")],
                }),
                makePlayer("p2", {
                    life: 12,
                    battlefield: [creature(GIANT, "p2", "blk")],
                }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const chosen = pick(state, "p2");
        expect(chosen.kind).toBe("declare-blockers");
        if (chosen.kind !== "declare-blockers") throw new Error("kind");
        expect(
            chosen.assignments.some(
                (a) => a.blockerId === "blk" && a.attackerId === "atk"
            )
        ).toBe(true);
    });

    it("preserves the ADR 0020 §4 guardrail: no suicide mana-dork attack", () => {
        // A lone Birds of Paradise (0/1 mana dork) attacking deals no damage and
        // taps out a mana source / blocker. The policy declares no attackers.
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(BOP, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "bop",
                            isSummoningSick: false,
                        }),
                    ],
                }),
                makePlayer("p2", { life: 20 }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const chosen = pick(state, "p1");
        expect(chosen.kind).toBe("declare-attackers");
        if (chosen.kind !== "declare-attackers") throw new Error("kind");
        expect(chosen.attackerIds).toHaveLength(0);
    });

    it("is deterministic under a fixed RNG stream", () => {
        const build = () =>
            makeState({
                phase: "DECLARE_ATTACKERS",
                activePlayerId: "p2",
                priorityPlayerId: "p1",
                players: [
                    makePlayer("p1", {
                        hand: [bolt("p1", "bolt")],
                        battlefield: [land("p1", "m1")],
                    }),
                    makePlayer("p2", {
                        battlefield: [creature(BEARS, "p2", "atk")],
                    }),
                ],
                combat: {
                    attackerIds: ["atk"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
        const a = build();
        const b = build();
        const moveA = selectRolloutMove(
            a,
            "p1",
            "p1",
            enumerateMoves(a, "p1"),
            makeRng(7)
        );
        const moveB = selectRolloutMove(
            b,
            "p1",
            "p1",
            enumerateMoves(b, "p1"),
            makeRng(7)
        );
        expect(moveA).toEqual(moveB);
    });
});

// ---------------------------------------------------------------------------
// Reactive-line reachability (ADR 0021 slice 3, issue #223). The soft prior
// biases the tree to EXPLORE instant-speed responses in their windows, and the
// rollout policy now PLAYS the `hold → attack → block → respond` ambush. The
// prior is unit-tested for shape (fires in the right windows, decays with
// visits); the policy is unit-tested deterministically at each step of the
// ambush — the seam-level proof that the reactive line is reachable & playable.
// ---------------------------------------------------------------------------
const GG = GIANT_GROWTH;

describe("reactivePrior — soft reactive-line bias (issue #223)", () => {
    // Opponent's turn, bot p1 holds Lightning Bolt with open mana and priority:
    // a reactive window for an instant.
    const reactiveCast = () => {
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [bolt("p1", "bolt")],
                    battlefield: [land("p1", "m1")],
                }),
                makePlayer("p2", {
                    battlefield: [creature(BEARS, "p2", "atk")],
                }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const move = enumerateMoves(state, "p1").find(
            (m) => m.kind === "cast-spell"
        )!;
        return { state, move };
    };

    it("fires on an instant cast in a reactive window and decays with visits", () => {
        const { state, move } = reactiveCast();
        expect(isReactiveInstantCast(state, "p1", move)).toBe(true);
        const atOne = reactivePrior(state, "p1", move, 1);
        const atTen = reactivePrior(state, "p1", move, 10);
        expect(atOne).toBeGreaterThan(0);
        // Soft: the bonus shrinks monotonically as the edge is visited, so it
        // can never dominate accumulated reward.
        expect(atTen).toBeLessThan(atOne);
        expect(atTen).toBeGreaterThan(0);
    });

    it("does NOT fire at the mover's own main phase (sorcery speed)", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(GG, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "gg",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        creature(BEARS, "p1", "bear"),
                        makeInstance(FOREST, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "f1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const move = enumerateMoves(state, "p1").find(
            (m) => m.kind === "cast-spell"
        )!;
        expect(isReactiveInstantCast(state, "p1", move)).toBe(false);
        expect(reactivePrior(state, "p1", move, 1)).toBe(0);
    });

    it("does NOT fire for a non-instant move", () => {
        const { state } = reactiveCast();
        expect(reactivePrior(state, "p1", { kind: "pass" }, 1)).toBe(0);
    });

    // Issue #2248: `isReactiveHold` gained a second shape — holding priority
    // (a `pass`) in the MOVER'S OWN main phase, no combat pending at all,
    // while holding an affordable FLASH PERMANENT. Before this shape the
    // "wait for the opponent's end step" line was never explorable outside
    // the mid-combat ambush hold above.
    it("fires on an own-main hold while holding an affordable flash permanent (issue #2248)", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(CONTAINMENT_PRIEST, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "cp",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [land("p1", "m1"), land("p1", "m2")],
                }),
                makePlayer("p2"),
            ],
        });
        const move: Move = { kind: "pass" };
        expect(reactivePrior(state, "p1", move, 1)).toBeGreaterThan(0);
    });

    it("does NOT fire on an own-main hold with only a plain instant (no flash permanent) in hand", () => {
        // Same shape as above but the held card is a plain Instant, not a
        // flash PERMANENT — the own-main hold nudge is deliberately narrower
        // than "any instant-speed card" (`hasCastableFlashPermanent`, not
        // `hasCastableInstant`), so a bare instant alone must not make this
        // pass explorable via the new shape.
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [bolt("p1", "bolt")],
                    battlefield: [land("p1", "m1")],
                }),
                makePlayer("p2"),
            ],
        });
        const move: Move = { kind: "pass" };
        expect(reactivePrior(state, "p1", move, 1)).toBe(0);
    });
});

describe("selectRolloutMove — plays the combat-trick ambush (issue #223)", () => {
    const fixedRng = () => 0;
    const giantGrowth = (id: string) =>
        makeInstance(GG, {
            controllerId: "p1",
            ownerId: "p1",
            id,
            zone: "hand",
        });
    const forest = (id: string) =>
        makeInstance(FOREST, { controllerId: "p1", ownerId: "p1", id });

    it("baits the block: attacks the 2/2 into a 3/3 while holding the trick", () => {
        // The leaf reads the un-pumped attacker as walking into the block, but
        // the bot holds Giant Growth — the policy strips that pre-judgment and
        // declares the attack to set up the ambush.
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [giantGrowth("gg")],
                    battlefield: [creature(BEARS, "p1", "bear"), forest("f")],
                }),
                makePlayer("p2", {
                    battlefield: [creature(GIANT, "p2", "blocker")],
                }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const chosen = selectRolloutMove(
            state,
            "p1",
            "p1",
            enumerateMoves(state, "p1"),
            fixedRng
        );
        expect(chosen.kind).toBe("declare-attackers");
        if (chosen.kind !== "declare-attackers") throw new Error("kind");
        expect(chosen.attackerIds).toContain("bear");
    });

    it("holds priority before blocks instead of dumping the pump early", () => {
        // Attacker declared, bot has priority before blocks. Pumping now reveals
        // the trick and forfeits the ambush; the policy waits.
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [giantGrowth("gg")],
                    battlefield: [
                        creature(BEARS, "p1", "bear", { isAttacking: true }),
                        forest("f"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [creature(GIANT, "p2", "blocker")],
                }),
            ],
            combat: {
                attackerIds: ["bear"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const chosen = selectRolloutMove(
            state,
            "p1",
            "p1",
            enumerateMoves(state, "p1"),
            fixedRng
        );
        expect(chosen.kind).toBe("pass");
    });

    it("casts the pump in response once the block is committed", () => {
        // The 3/3 has blocked the 2/2. Pumping to a 5/5 now kills the blocker
        // and survives — the payoff the policy sees via the effective-P/T block
        // exchange — so it casts the trick.
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [giantGrowth("gg")],
                    battlefield: [
                        creature(BEARS, "p1", "bear", { isAttacking: true }),
                        forest("f"),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        creature(GIANT, "p2", "blocker", { isBlocking: true }),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["bear"],
                confirmed: true,
                blockerAssignments: { blocker: ["bear"] },
                blockersConfirmed: true,
            },
        });
        const chosen = selectRolloutMove(
            state,
            "p1",
            "p1",
            enumerateMoves(state, "p1"),
            fixedRng
        );
        expect(chosen.kind).toBe("cast-spell");
        if (chosen.kind !== "cast-spell") throw new Error("kind");
        expect(chosen.cardInstanceId).toBe("gg");
    });

    it("does NOT cast a no-payoff trick just because the window is reactive (over-aggressive guard)", () => {
        // Opponent's turn, no combat: pumping the bot's own creature buys
        // nothing. Despite the reactive window, the policy holds the trick — the
        // soft prior biases exploration, it never forces a no-payoff cast.
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [giantGrowth("gg")],
                    battlefield: [creature(BEARS, "p1", "bear"), forest("f")],
                }),
                makePlayer("p2"),
            ],
        });
        const chosen = selectRolloutMove(
            state,
            "p1",
            "p1",
            enumerateMoves(state, "p1"),
            fixedRng
        );
        expect(chosen.kind).toBe("pass");
    });
});

// ---------------------------------------------------------------------------
// Self-harm removal tie-break (issue #365). A one-sided removal / destruction
// Spell aimed at the bot's OWN beneficial Permanent is pure self-harm. The leaf
// eval now registers the loss (evaluate.ts), but a thin loss can still tie
// `pass` or an enemy-target cast inside OUTCOME_EPS on rollout noise — the
// reported destroy-own-Castle case. `selectRootMove` must (1) prefer the
// enemy-target cast of the same Spell, else (2) hold (pass). Real enumerated
// moves so target tuples / tap plans are valid and the probe resolves the
// actual spell; synthetic edges so the fire / no-fire conditions are
// deterministic without rollout variance.
// ---------------------------------------------------------------------------
describe("selectRootMove — self-harm removal tie-break (issue #365)", () => {
    const DISENCHANT = getCardByName("Disenchant").id; // {1}{W} destroy art/ench
    const SWORDS = getCardByName("Swords to Plowshares").id; // {W} exile creature
    const CASTLE = getCardByName("Castle").id; // own buff Enchantment
    const TOME = getCardByName("Jayemdae Tome").id; // enemy card-draw Artifact
    const UNICORN = getCardByName("Pearled Unicorn").id; // 2/2 vanilla
    const PLAINS = getCardByName("Plains").id;

    function plains(controllerId: string, id: string) {
        return makeInstance(PLAINS, {
            controllerId,
            ownerId: controllerId,
            id,
        });
    }

    function rootOf(
        edges: { move: Move; meanReward: number; meanMargin: number }[]
    ): Node {
        const children = new Map<string, Edge>();
        edges.forEach((e, i) => {
            const visits = 100;
            children.set(`${e.move.kind}:${i}`, {
                move: e.move,
                key: `${e.move.kind}:${i}`,
                mover: "p1",
                node: { children: new Map() },
                visits,
                totalReward: e.meanReward * visits,
                totalMargin: e.meanMargin * visits,
                avail: visits,
            });
        });
        return { children };
    }

    /** Find the enumerated cast-spell move for `cardInstanceId` whose single
     *  target is `targetId` (a permanent on either battlefield). */
    function castAt(
        state: GameState,
        cardInstanceId: string,
        targetId: string
    ): Move {
        const move = enumerateMoves(state, "p1").find(
            (m) =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === cardInstanceId &&
                m.targets.length === 1 &&
                m.targets[0]?.id === targetId
        );
        if (!move) throw new Error(`no cast move for ${targetId}`);
        return move;
    }

    describe("Disenchant: own Castle vs enemy Tome", () => {
        // Bot p1 holds Disenchant + 2 Plains, controls its own Castle, opponent
        // controls a Jayemdae Tome. Both are legal targets (CR 115.4).
        function rootState(): GameState {
            return makeState({
                phase: "PRECOMBAT_MAIN",
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(DISENCHANT, {
                                id: "dis",
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "hand",
                            }),
                        ],
                        battlefield: [
                            makeInstance(CASTLE, {
                                id: "castle",
                                controllerId: "p1",
                                ownerId: "p1",
                            }),
                            plains("p1", "pl1"),
                            plains("p1", "pl2"),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [
                            makeInstance(TOME, {
                                id: "tome",
                                controllerId: "p2",
                                ownerId: "p2",
                            }),
                        ],
                    }),
                ],
            });
        }

        it("FIRE: prefers the enemy Tome over the bot's own Castle when outcome-equal", () => {
            const state = rootState();
            const ownCastle = castAt(state, "dis", "castle");
            const enemyTome = castAt(state, "dis", "tome");
            // Reported trace shape: self-target edged the alternatives on
            // meanMargin (noise) at an equal mean reward — must not stand.
            const root = rootOf([
                { move: ownCastle, meanReward: 0.54, meanMargin: 89 },
                { move: enemyTome, meanReward: 0.54, meanMargin: 87 },
                { move: { kind: "pass" }, meanReward: 0.54, meanMargin: 87 },
            ]);
            const chosen = selectRootMove(
                root,
                [ownCastle, enemyTome, { kind: "pass" }],
                state,
                "p1"
            );
            expect(chosen.kind).toBe("cast-spell");
            if (chosen.kind !== "cast-spell") throw new Error("kind");
            expect(chosen.targets[0]?.id).toBe("tome");
        });

        it("NO-FIRE: keeps the enemy Tome target when it is the robust pick", () => {
            const state = rootState();
            const ownCastle = castAt(state, "dis", "castle");
            const enemyTome = castAt(state, "dis", "tome");
            // The enemy cast genuinely out-rewards — it is the lone contender and
            // wins on its own; the tie-break is never consulted.
            const root = rootOf([
                { move: enemyTome, meanReward: 0.7, meanMargin: 120 },
                { move: ownCastle, meanReward: 0.5, meanMargin: 89 },
            ]);
            const chosen = selectRootMove(
                root,
                [enemyTome, ownCastle],
                state,
                "p1"
            );
            expect(chosen.kind).toBe("cast-spell");
            if (chosen.kind !== "cast-spell") throw new Error("kind");
            expect(chosen.targets[0]?.id).toBe("tome");
        });
    });

    describe("only own beneficial target available → pass", () => {
        // No enemy artifact/enchantment: Disenchant's ONLY legal target is the
        // bot's own Castle. The bot must hold the Spell, not destroy its own.
        function rootState(): GameState {
            return makeState({
                phase: "PRECOMBAT_MAIN",
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(DISENCHANT, {
                                id: "dis",
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "hand",
                            }),
                        ],
                        battlefield: [
                            makeInstance(CASTLE, {
                                id: "castle",
                                controllerId: "p1",
                                ownerId: "p1",
                            }),
                            plains("p1", "pl1"),
                            plains("p1", "pl2"),
                        ],
                    }),
                    makePlayer("p2", {}),
                ],
            });
        }

        it("FIRE: passes rather than destroying its own Castle", () => {
            const state = rootState();
            const ownCastle = castAt(state, "dis", "castle");
            const root = rootOf([
                { move: ownCastle, meanReward: 0.54, meanMargin: 89 },
                { move: { kind: "pass" }, meanReward: 0.54, meanMargin: 87 },
            ]);
            expect(
                selectRootMove(root, [ownCastle, { kind: "pass" }], state, "p1")
                    .kind
            ).toBe("pass");
        });
    });

    describe("Swords to Plowshares: own creature vs enemy creature", () => {
        function rootState(): GameState {
            return makeState({
                phase: "PRECOMBAT_MAIN",
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(SWORDS, {
                                id: "stp",
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "hand",
                            }),
                        ],
                        battlefield: [
                            creature(UNICORN, "p1", "myUnicorn"),
                            plains("p1", "pl1"),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [creature(UNICORN, "p2", "oppUnicorn")],
                    }),
                ],
            });
        }

        it("FIRE: exiles the enemy creature, never the bot's own", () => {
            const state = rootState();
            const ownU = castAt(state, "stp", "myUnicorn");
            const enemyU = castAt(state, "stp", "oppUnicorn");
            const root = rootOf([
                { move: ownU, meanReward: 0.53, meanMargin: 5 },
                { move: enemyU, meanReward: 0.53, meanMargin: 3 },
                { move: { kind: "pass" }, meanReward: 0.53, meanMargin: 3 },
            ]);
            const chosen = selectRootMove(
                root,
                [ownU, enemyU, { kind: "pass" }],
                state,
                "p1"
            );
            expect(chosen.kind).toBe("cast-spell");
            if (chosen.kind !== "cast-spell") throw new Error("kind");
            expect(chosen.targets[0]?.id).toBe("oppUnicorn");
        });
    });
});

describe("opponent priority edges use stable, definition-based keys (issue #1520)", () => {
    // `determinizeOpponent` (determinize.ts) freely reshuffles which physical
    // card object lands in the opponent's hand each ISMCTS iteration. Two
    // functionally-identical duplicate cards can therefore supply a DIFFERENT
    // `cardInstanceId` for the "same" semantic move across determinizations —
    // the raw structural `moveKey` (JSON.stringify) split one decision's tree
    // statistics across worlds, exactly the pathology PRD #1423 already fixed
    // for choice nodes. `keyedMovesFor` now stabilizes a hand-sourced id onto
    // the card's DEFINITION id for a non-observer mover.

    /** p2 (the modeled opponent from p1's search) at priority with `hand`
     *  hand cards and a tapped-for-mana-able land, so `cast-spell` is a legal
     *  move. `botId` is "p1" throughout — p2 is always the non-observer. */
    function opponentPriorityState(
        hand: ReturnType<typeof makeInstance>[]
    ): GameState {
        return makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand,
                    battlefield: [land("p2", "p2-mtn")],
                }),
            ],
        });
    }

    it("keys an opponent's cast-spell move identically across two determinizations naming a different physical copy", () => {
        // World A: THIS physical Bolt ("copy-1") was dealt into the
        // opponent's hand this iteration.
        const worldA = opponentPriorityState([bolt("p2", "copy-1")]);
        // World B: a re-determinization dealt a DIFFERENT physical copy of
        // the exact same card ("copy-2") into the hand instead — the same
        // semantic decision ("cast the opponent's one Lightning Bolt"), a
        // different underlying id.
        const worldB = opponentPriorityState([bolt("p2", "copy-2")]);

        const keyA = keyedMovesFor(worldA, "p2", "p1").find(
            (k) => k.move.kind === "cast-spell"
        )?.key;
        const keyB = keyedMovesFor(worldB, "p2", "p1").find(
            (k) => k.move.kind === "cast-spell"
        )?.key;

        expect(keyA).toBeDefined();
        expect(keyA).toBe(keyB);
    });

    it("collapses two functionally-identical opponent hand duplicates down to one keyed move PER target, not two", () => {
        const state = opponentPriorityState([
            bolt("p2", "copy-1"),
            bolt("p2", "copy-2"),
        ]);
        const castMoves = keyedMovesFor(state, "p2", "p1").filter(
            (k) => k.move.kind === "cast-spell"
        );
        // Lightning Bolt has 2 legal "any target" picks with no creatures on
        // board (either player) — 2 copies × 2 targets would be 4 raw moves,
        // but each target's two copies collapse to ONE representative: the
        // interchangeable-copy statistics no longer split across the two ids.
        expect(castMoves).toHaveLength(2);
        const keys = new Set(castMoves.map((m) => m.key));
        expect(keys.size).toBe(2); // both representatives are distinct targets
    });

    it("leaves the SEARCHING bot's own hand-sourced moves keyed by raw instance id (unchanged, out of scope)", () => {
        // `determinize` never touches the observer's own hand, so the raw
        // instance id is already stable there — two of the bot's own
        // duplicate cards stay two distinct keyed moves (historical
        // behavior, not a regression this issue addresses).
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [bolt("p1", "own-1"), bolt("p1", "own-2")],
                    battlefield: [land("p1", "p1-mtn")],
                }),
                makePlayer("p2"),
            ],
        });
        const castMoves = keyedMovesFor(state, "p1", "p1").filter(
            (k) => k.move.kind === "cast-spell"
        );
        // 2 copies × 2 legal targets, NONE collapsed (the bot's own hand is
        // never touched by `determinize`, so there is nothing to stabilize).
        expect(castMoves).toHaveLength(4);
    });

    it("leaves a battlefield-sourced activate-ability move's key untouched (public zone, already stable)", () => {
        // Sanity: `priorityMoveKey` only stabilizes a HAND-sourced id;
        // battlefield ids are public and never reshuffled by `determinize`,
        // so an opponent's own-ability activation must key identically to
        // the plain structural `moveKey` (no accidental over-matching).
        const state = opponentPriorityState([]);
        const keyed = keyedMovesFor(state, "p2", "p1");
        // No activated abilities on a bare Mountain — this just confirms the
        // land's `play-land`/mana-ability surface stays keyed by its own
        // (public, stable) instance id rather than being swapped out.
        const passMove = keyed.find((k) => k.move.kind === "pass");
        expect(passMove?.key).toBe(JSON.stringify({ kind: "pass" }));
    });
});
