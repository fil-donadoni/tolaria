// DecisionTrace debug view (AI reasoning logging). Covers the three pieces of
// the tool — `evaluateBreakdown` (per-term decomposition), `describeMove`
// (human-readable labels), and `searchWithTrace` (the trace by-product) — and
// pins the contract that the trace NEVER changes the chosen move: `search` and
// `searchWithTrace` agree on a fixed seed. These assert the TOOL, not the
// gameplay bug it exists to diagnose. See `convex/gre/search.ts`,
// `evaluate.ts`, `describeMove.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { search, searchWithTrace } from "../search";
import { evaluate, evaluateBreakdown } from "../evaluate";
import { describeMove } from "../describeMove";
import { enumerateMoves, type Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 ground
const BOLT = getCardByName("Lightning Bolt").id; // R: 3 dmg any target
const MOUNTAIN = getCardByName("Mountain").id;
const GIANT = getCardByName("Hill Giant").id; // 3/3

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

function inHand(cardId: string, controllerId: string, id: string) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        zone: "hand",
    });
}

const SEED = 12345;
const BUDGET = { iterations: 200 };

describe("evaluateBreakdown (DecisionTrace)", () => {
    it("terms decompose the score: margin = sum(self) − sum(opp), total = evaluate", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 18,
                    hand: [inHand(BOLT, "p1", "h1"), inHand(BOLT, "p1", "h2")],
                    battlefield: [creature(BEARS, "p1", "c1")],
                }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const b = evaluateBreakdown(state, "p1");
        const sum = (t: typeof b.self) =>
            t.life + t.hand + t.creatures + t.permanents + t.mana;
        expect(sum(b.self) - sum(b.opp)).toBe(b.margin);
        expect(b.total).toBe(evaluate(state, "p1"));
    });

    it("hand and life terms reflect the weighted counts", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 10,
                    hand: [inHand(BOLT, "p1", "h1"), inHand(BOLT, "p1", "h2")],
                }),
                makePlayer("p2"),
            ],
        });
        const b = evaluateBreakdown(state, "p1");
        // Forge-scale weights (ADR 0018): W_LIFE = 8; the hand term sums each
        // card's latent `cardValue` (issue #195). With the DSL semantic layer
        // (PRD #1423, issue #1426) a non-creature's worth is now its Effect
        // Script value, not `base + MV`: Lightning Bolt's `dealDamage 3` scores
        // 3 × 22 = 66 (far above its old MV-1 worth of 18) — the whole point of
        // the layer (a burn spell out-values a do-nothing spell of equal MV).
        expect(b.self.life).toBe(10 * 8); // W_LIFE
        expect(b.self.hand).toBe(2 * 66); // 2 × cardValue(Lightning Bolt), DSL-derived
    });

    it("is symmetric: opponent's terms equal their own self-view", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 12 }),
                makePlayer("p2", {
                    life: 7,
                    hand: [inHand(BOLT, "p2", "h1")],
                }),
            ],
        });
        const fromP1 = evaluateBreakdown(state, "p1");
        const fromP2 = evaluateBreakdown(state, "p2");
        expect(fromP1.opp).toEqual(fromP2.self);
    });
});

describe("describeMove (DecisionTrace labels)", () => {
    const bolt = inHand(BOLT, "p1", "bolt1");
    const bear = creature(BEARS, "p2", "bear1");
    const state = makeState({
        players: [
            makePlayer("p1", { name: "Bot", hand: [bolt] }),
            makePlayer("p2", { name: "You", battlefield: [bear] }),
        ],
    });

    it("labels a pass", () => {
        expect(describeMove({ kind: "pass" }, state)).toBe("pass");
    });

    it("labels a cast targeting a player by name", () => {
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "bolt1",
            targets: [{ type: "player", id: "p2" }],
            confirmTargets: false,
            tapPlan: [],
        };
        expect(describeMove(move, state)).toBe("cast Lightning Bolt → You");
    });

    it("labels a cast targeting a permanent by card name", () => {
        const move: Move = {
            kind: "cast-spell",
            cardInstanceId: "bolt1",
            targets: [{ type: "permanent", id: "bear1" }],
            confirmTargets: false,
            tapPlan: [],
        };
        expect(describeMove(move, state)).toBe(
            "cast Lightning Bolt → Grizzly Bears"
        );
    });

    it("labels declare-attackers and no-attacks", () => {
        expect(
            describeMove({ kind: "declare-attackers", attackerIds: [] }, state)
        ).toBe("no attacks");
    });
});

describe("searchWithTrace (DecisionTrace by-product)", () => {
    /** Bot p1 in its main phase with a land to play — at least {play-land, pass}
     *  so the root is a real (multi-move) decision the trace must explain. */
    function botMainWithLand() {
        return makeState({
            players: [
                makePlayer("p1", {
                    name: "Bot",
                    hand: [inHand(MOUNTAIN, "p1", "land1")],
                    battlefield: [],
                }),
                makePlayer("p2", { name: "You" }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
    }

    it("never changes the chosen move: search() === searchWithTrace().move (same seed)", () => {
        const state = botMainWithLand();
        const plain = search(state, "p1", BUDGET, SEED);
        const { move } = searchWithTrace(state, "p1", BUDGET, SEED);
        expect(move).toEqual(plain);
    });

    it("traces every legal root move, sorted by visits, with the chosen one present", () => {
        const state = botMainWithLand();
        const legalCount = enumerateMoves(state, "p1").length;
        const { move, trace } = searchWithTrace(state, "p1", BUDGET, SEED);

        expect(trace).not.toBeNull();
        expect(legalCount).toBeGreaterThan(1);
        // With iterations >> legal moves every root move is expanded once.
        expect(trace!.candidates.length).toBe(legalCount);

        const labels = trace!.candidates.map((c) => c.label);
        expect(labels).toContain(trace!.chosen);
        expect(trace!.chosen).toBe(describeMove(move!, state));

        const visits = trace!.candidates.map((c) => c.visits);
        for (let i = 1; i < visits.length; i++) {
            expect(visits[i - 1]).toBeGreaterThanOrEqual(visits[i]);
        }
    });

    it("each candidate carries an eval breakdown of the position it leads to", () => {
        const state = botMainWithLand();
        const { trace } = searchWithTrace(state, "p1", BUDGET, SEED);
        for (const cand of trace!.candidates) {
            expect(cand.eval).toBeDefined();
            expect(typeof cand.eval.margin).toBe("number");
            expect(cand.meanReward).toBeGreaterThanOrEqual(0);
            expect(cand.meanReward).toBeLessThanOrEqual(1);
        }
    });

    it("emits no trace when there is no real decision (player owes nothing)", () => {
        const state = botMainWithLand();
        // p2 owes nothing here (p1 has priority) → null move, null trace.
        const { move, trace } = searchWithTrace(state, "p2", BUDGET, SEED);
        expect(move).toBeNull();
        expect(trace).toBeNull();
    });

    // Issue #2682 — before this slice `runSearchWithTrace` computed the real
    // per-decision iteration count and threw it away (never compared against
    // the budget or the wall clock). These two cases are the acceptance
    // criteria: an iteration-only budget completes exactly what it asked for,
    // a time-starved budget stops short.
    it('reports stoppedBy "iterations" and iterationsCompleted === iterationsRequested with no timeMs bound', () => {
        const state = botMainWithLand();
        // BUDGET = { iterations: 200 }, no timeMs — the loop can only stop by
        // exhausting the iteration count.
        const { trace } = searchWithTrace(state, "p1", BUDGET, SEED);
        expect(trace!.stoppedBy).toBe("iterations");
        expect(trace!.iterationsCompleted).toBe(trace!.iterationsRequested);
        expect(trace!.iterationsCompleted).toBe(BUDGET.iterations);
    });

    it('reports stoppedBy "time" and iterationsCompleted < iterationsRequested under a tiny wall-clock bound (injected clock)', () => {
        const state = botMainWithLand();
        // Clock jumps 10ms per read; a 5ms budget allows a single iteration —
        // same pattern as search.test.ts's "stops on the wall-clock bound".
        let t = 0;
        const now = () => (t += 10);
        const { trace } = searchWithTrace(
            state,
            "p1",
            { iterations: 1_000_000, timeMs: 5, now },
            SEED
        );
        expect(trace!.stoppedBy).toBe("time");
        expect(trace!.iterationsCompleted).toBeLessThan(
            trace!.iterationsRequested
        );
        expect(trace!.iterationsRequested).toBe(1_000_000);
        expect(trace!.elapsedMs).toBeGreaterThanOrEqual(5);
    });

    // Issue #2685 — the early-stop rule. A dominant root pick (lethal Bolt to
    // the face) stops at `minIterations + k` with `stoppedBy: "settled"`; a
    // genuinely tied decision (two identical lands) never clears the mean-reward
    // lead condition and runs to the full iteration budget.
    it('reports stoppedBy "settled" and stops before the budget on a dominant pick', () => {
        // Survive-lethal: opponent p1 attacks with a 3/3 and bot p2 sits at 3
        // life with a Bolt + an untapped Mountain. The ONLY survival is to Bolt
        // the attacker; passing (or bolting p1's face) is death — a large,
        // decisive mean-reward gap, so the root pick settles before the budget.
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", {
                    life: 6,
                    battlefield: [
                        creature(GIANT, "p1", "ogre", {
                            isAttacking: true,
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2", {
                    name: "Bot",
                    life: 3,
                    hand: [inHand(BOLT, "p2", "bolt1")],
                    battlefield: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p2",
                            ownerId: "p2",
                            id: "m1",
                        }),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["ogre"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const { trace } = searchWithTrace(
            state,
            "p2",
            { iterations: 200, minIterations: 10 },
            SEED
        );
        expect(trace!.stoppedBy).toBe("settled");
        expect(trace!.iterationsCompleted).toBeGreaterThanOrEqual(10);
        expect(trace!.iterationsCompleted).toBeLessThan(200);
    });

    it("runs to the iteration budget on a tied decision (the early-stop rule never fires)", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    name: "Bot",
                    hand: [
                        inHand(MOUNTAIN, "p1", "m1"),
                        inHand(MOUNTAIN, "p1", "m2"),
                    ],
                    battlefield: [],
                }),
                makePlayer("p2", { name: "You" }),
            ],
        });
        // Two identical lands are outcome-equal: the most-visited root child's
        // mean-reward lead over the runner-up never clears OUTCOME_EPS, so the
        // settle rule must not fire and the search completes its full budget.
        const { trace } = searchWithTrace(
            state,
            "p1",
            { iterations: 200, minIterations: 10 },
            SEED
        );
        expect(trace!.stoppedBy).toBe("iterations");
        expect(trace!.iterationsCompleted).toBe(200);
    });
});
