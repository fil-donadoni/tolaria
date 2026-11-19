// The self-harm hold when the reward band is blind (issue #9964).
//
// `self-harm-removal` (issue #365) holds a cast that only lowers the bot's own
// material margin — but only over a `pass` inside `outcomeEps` of the best
// mean reward. That gate reads MEAN REWARD, and reward carries material only
// inside +/-`materialFull`: a bot already that far behind maps the cast's
// settled position and the untouched one to the same clipped reward, so the
// gap between the two means is rollout residue, not a reading of the loss.
// Observed: Fatal Push with revolt on, the opponent's creatures all out of
// reach, the bot's own 2-drops the only targets — and the bot destroyed its
// own creature on the seeds where the noise pushed `pass` out of the band.
//
// Synthetic edges, so the means are exactly the ones the gate must survive;
// real enumerated moves, so the probe resolves the actual spell. The cards are
// fixtures: nothing under test reads a card name.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { reward, selectRootMove, type Edge, type Node } from "../search";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import type { RootDecisionMechanism } from "../ai/decisionTelemetry";
import { enumerateMoves, type Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../state";

const FATAL_PUSH = getCardByName("Fatal Push").id; // {B}: destroy MV <= 2
const EPHEMERATE = getCardByName("Ephemerate").id; // {W}: flicker own creature
const SWORDS = getCardByName("Swords to Plowshares").id; // {W}: exile creature
const BEARS = getCardByName("Grizzly Bears").id; // 2/2, mana value 2
const WURM = getCardByName("Craw Wurm").id; // 6/4, mana value 6
const SWAMP = getCardByName("Swamp").id;
const PLAINS = getCardByName("Plains").id;

const PASS: Move = { kind: "pass" };

function card(
    defId: string,
    controllerId: string,
    id: string,
    zone: CardInstanceState["zone"] = "battlefield"
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone,
        isSummoningSick: false,
    });
}

/** The opponent's board: `wurms` Craw Wurms, every one out of Fatal Push's
 *  reach. Six put the bot well past `materialFull` behind; one does not. */
function wurms(count: number): CardInstanceState[] {
    return Array.from({ length: count }, (_, i) =>
        card(WURM, "p2", `wurm${i}`)
    );
}

function pushBoard(oppWurms: number, oppBears = false): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [card(FATAL_PUSH, "p1", "push", "hand")],
                battlefield: [
                    card(BEARS, "p1", "myBears"),
                    card(SWAMP, "p1", "sw1"),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    ...wurms(oppWurms),
                    ...(oppBears ? [card(BEARS, "p2", "oppBears")] : []),
                ],
            }),
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

function castAt(state: GameState, cardId: string, targetId: string): Move {
    const move = enumerateMoves(state, "p1").find(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === cardId &&
            m.targets.length === 1 &&
            m.targets[0]?.id === targetId
    );
    if (!move) throw new Error(`no cast of ${cardId} at ${targetId}`);
    return move;
}

/** The pick and the rule that settled it. */
function pick(
    state: GameState,
    edges: { move: Move; meanReward: number; meanMargin: number }[]
): { move: Move; mechanism: RootDecisionMechanism } {
    const out = { mechanism: "mean-reward" as RootDecisionMechanism };
    const move = selectRootMove(
        rootOf(edges),
        edges.map((e) => e.move),
        state,
        "p1",
        undefined,
        DEFAULT_EVAL_WEIGHTS,
        undefined,
        out
    );
    return { move, mechanism: out.mechanism };
}

// The cast out-rewards `pass` by 0.07, past the 0.05 `outcomeEps` band: the
// shape the issue's seeds reached, where the old gate let the cast stand.
const NOISY_GAP = 0.07;

describe("selectRootMove — self-harm hold under a blind reward band (issue #9964)", () => {
    it("the board the FIRE case stands on IS blind: both sides read the clipped floor", () => {
        // Precondition, so the FIRE case cannot pass for another reason: six
        // Wurms put the bot past `materialFull` behind, where the open band
        // clips to its floor (`terminalBand`).
        const state = pushBoard(6);
        expect(reward(state, "p1")).toBe(DEFAULT_EVAL_WEIGHTS.terminalBand);
    });

    it("FIRE: passes rather than destroying its own creature when the band is blind", () => {
        const state = pushBoard(6);
        const ownBears = castAt(state, "push", "myBears");
        const { move, mechanism } = pick(state, [
            { move: ownBears, meanReward: 0.25 + NOISY_GAP, meanMargin: -1500 },
            { move: PASS, meanReward: 0.25, meanMargin: -1400 },
        ]);
        expect(move.kind).toBe("pass");
        expect(mechanism).toBe("self-harm-removal");
    });

    it("FIRE: redirects to the opponent's creature over its own, whatever the sibling's mean", () => {
        // The opposing Bears is a sibling of the same announcement, but its
        // mean sits past `outcomeEps` below the own-target cast — rollout
        // residue like the gap itself, so it is ranked anyway, and the
        // variant ranking takes it over both the self-harm and `pass`.
        const state = pushBoard(6, true);
        const ownBears = castAt(state, "push", "myBears");
        const oppBears = castAt(state, "push", "oppBears");
        const { move, mechanism } = pick(state, [
            { move: ownBears, meanReward: 0.25 + NOISY_GAP, meanMargin: -1500 },
            { move: oppBears, meanReward: 0.25, meanMargin: -1400 },
            { move: PASS, meanReward: 0.25, meanMargin: -1450 },
        ]);
        expect(move.kind).toBe("cast-spell");
        if (move.kind !== "cast-spell") throw new Error("kind");
        expect(move.targets[0]?.id).toBe("oppBears");
        expect(mechanism).toBe("announcement-variant");
    });

    it("NO-FIRE: in the open band the mean reward still decides", () => {
        // One Wurm: the bot is inside +/-`materialFull`, the reward sees the
        // lost Bears, and a cast that out-rewards `pass` past the band is the
        // search's reading — the hold stays an outcome-equal tie-break there.
        const state = pushBoard(1);
        expect(reward(state, "p1")).toBeGreaterThan(
            DEFAULT_EVAL_WEIGHTS.terminalBand
        );
        const ownBears = castAt(state, "push", "myBears");
        const { move } = pick(state, [
            { move: ownBears, meanReward: 0.4 + NOISY_GAP, meanMargin: -300 },
            { move: PASS, meanReward: 0.4, meanMargin: -200 },
        ]);
        expect(move.kind).toBe("cast-spell");
    });

    it("NO-FIRE: a flicker that saves its creature from removal on the stack is not held", () => {
        // The blind reading is taken against `pass` SETTLED: the opponent's
        // Swords resolves on that side too, so the save reads as the gain it
        // is. Against the raw root — which still counts the Bears the Swords
        // is about to exile — the flicker would read as a drop, and the blind
        // admission would hold it whatever the means said.
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [card(EPHEMERATE, "p1", "eph", "hand")],
                    battlefield: [
                        card(BEARS, "p1", "myBears"),
                        card(PLAINS, "p1", "pl1"),
                    ],
                }),
                makePlayer("p2", { battlefield: wurms(6) }),
            ],
        });
        pushSpell(state, SWORDS, "p2", [{ type: "permanent", id: "myBears" }]);
        const flicker = castAt(state, "eph", "myBears");
        const { move } = pick(state, [
            { move: flicker, meanReward: 0.25 + NOISY_GAP, meanMargin: -1400 },
            { move: PASS, meanReward: 0.25, meanMargin: -1500 },
        ]);
        expect(move.kind).toBe("cast-spell");
    });
});

// The self-harm reading on the search's OWN pick (issue #10222). The material
// tie-break runs first: with the own-target cast on top of the means and
// `pass` inside `outcomeEps` with a better subtree margin, the tie-break used
// to take `pass`, and the sibling aimed at the opponent — a hair outside the
// band, rollout residue like the rest — was never ranked.
describe("selectRootMove — the self-harm reading on the search's argmax (issue #10222)", () => {
    it("FIRE: redirects to the opponent's creature when the tie-break would have taken `pass`", () => {
        const state = pushBoard(6, true);
        const ownBears = castAt(state, "push", "myBears");
        const oppBears = castAt(state, "push", "oppBears");
        // `pass` is inside the band and out-margins the own-target cast;
        // the opposing variant sits past the band, with the WORST margin, so
        // only the variant ranking (never the margin) can pick it.
        const { move, mechanism } = pick(state, [
            { move: ownBears, meanReward: 0.31, meanMargin: -1500 },
            { move: PASS, meanReward: 0.28, meanMargin: -1400 },
            { move: oppBears, meanReward: 0.25, meanMargin: -1600 },
        ]);
        expect(move.kind).toBe("cast-spell");
        if (move.kind !== "cast-spell") throw new Error("kind");
        expect(move.targets[0]?.id).toBe("oppBears");
        expect(mechanism).toBe("announcement-variant");
    });

    it("FIRE: with no sibling to redirect to, the argmax is still held on `pass`", () => {
        const state = pushBoard(6);
        const ownBears = castAt(state, "push", "myBears");
        const { move, mechanism } = pick(state, [
            { move: ownBears, meanReward: 0.31, meanMargin: -1500 },
            { move: PASS, meanReward: 0.28, meanMargin: -1400 },
        ]);
        expect(move.kind).toBe("pass");
        expect(mechanism).toBe("self-harm-removal");
    });

    it("NO-FIRE: in the open band the tie-break's `pass` stands", () => {
        // One Wurm: the reward sees the lost Bears, so the argmax is no
        // blind self-harm and the material tie-break keeps its reading.
        const state = pushBoard(1, true);
        const ownBears = castAt(state, "push", "myBears");
        const oppBears = castAt(state, "push", "oppBears");
        const { move, mechanism } = pick(state, [
            { move: ownBears, meanReward: 0.46, meanMargin: -300 },
            { move: PASS, meanReward: 0.43, meanMargin: -200 },
            { move: oppBears, meanReward: 0.4, meanMargin: -400 },
        ]);
        expect(move.kind).toBe("pass");
        expect(mechanism).toBe("material-tiebreak");
    });
});
