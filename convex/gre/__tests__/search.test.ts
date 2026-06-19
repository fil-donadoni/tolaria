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
    selectRolloutMove,
    isDiscouragedRolloutMove,
    isReactiveInstantCast,
    reactivePrior,
    type Edge,
    type Node,
} from "../search";
import { makeRng } from "../rng";
import { evaluate } from "../evaluate";
import { greedySelectMove } from "../greedy";
import { enumerateMoves } from "../moves";
import type { Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const GIANT = getCardByName("Hill Giant").id; // 3/3
const BEARS = getCardByName("Grizzly Bears").id; // 2/2
const BOLT = getCardByName("Lightning Bolt").id; // R: 3 dmg any target
const MOUNTAIN = getCardByName("Mountain").id;
const BOP = getCardByName("Birds of Paradise").id; // 0/1 mana dork
const GIANT_GROWTH = getCardByName("Giant Growth").id; // {G} instant +3/+3
const FOREST = getCardByName("Forest").id;

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
