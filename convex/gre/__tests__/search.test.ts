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
    reward,
    selectRootMove,
    isDiscouragedRolloutMove,
    type Edge,
    type Node,
} from "../search";
import { evaluate } from "../evaluate";
import { greedySelectMove } from "../greedy";
import { enumerateMoves } from "../moves";
import type { Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const GIANT = getCardByName("Hill Giant").id; // 3/3
const BEARS = getCardByName("Grizzly Bears").id; // 2/2
const BOLT = getCardByName("Lightning Bolt").id; // R: 3 dmg any target
const MOUNTAIN = getCardByName("Mountain").id;
const BOP = getCardByName("Birds of Paradise").id; // 0/1 mana dork
const GIANT_GROWTH = getCardByName("Giant Growth").id; // {G} instant +3/+3

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
        edges: { move: Move; meanReward: number; meanMargin: number }[]
    ): Node {
        const VISITS = 100;
        const children = new Map<string, Edge>();
        edges.forEach((e, i) => {
            children.set(`${e.move.kind}:${i}`, {
                move: e.move,
                mover: "p1",
                node: { children: new Map() },
                visits: VISITS,
                totalReward: e.meanReward * VISITS,
                totalMargin: e.meanMargin * VISITS,
                avail: VISITS,
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
});
