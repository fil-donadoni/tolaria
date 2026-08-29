// Survival of the Fittest discard choice (ADR 0091 decision 4, issue #2135) —
// WHICH creature the tutor engine eats is the decision the card is about, so the
// search treats it as a variant axis (K=3, `gre/parkKinds.ts`) rather than the
// deterministic cheapest-first fallback. The activation enumerator already
// emits one variant per DISTINCT discard candidate (`activationCostPicks.ts`,
// issue #2297); this test pins the SELECTION half — that `selectRootMove`
// chooses among them by reward, not by enumeration order.
//
// A synthetic-edge `selectRootMove` test (not self-play), per the acceptance
// criterion: real enumerated variants, synthetic rewards, so the fire /
// no-fire condition is asserted without rollout variance.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import { selectRootMove, type Edge, type Node } from "../search";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const BOT = "p2";
const OPP = "p1";

const SURVIVAL = getCardByName("Survival of the Fittest");
const BEAR = getCardByName("Grizzly Bears").id; // {1}{G} 2/2
const WURM = getCardByName("Craw Wurm").id; // {4}{G}{G} 6/4

function survivalState(): GameState {
    return makeState({
        players: [
            makePlayer(OPP),
            makePlayer(BOT, {
                battlefield: [
                    makeInstance(SURVIVAL.id, {
                        id: "survival",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                ],
                hand: [
                    makeInstance(BEAR, {
                        id: "bear",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                    makeInstance(WURM, {
                        id: "wurm",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "PRECOMBAT_MAIN",
    });
}

/** A synthetic root whose child edges carry the given mean reward at a fixed
 *  visit count. */
function rootOf(
    edges: { move: Move; meanReward: number; meanMargin: number }[]
): Node {
    const children = new Map<string, Edge>();
    edges.forEach((e, i) => {
        const visits = 100;
        children.set(`edge:${i}`, {
            move: e.move,
            key: `edge:${i}`,
            mover: BOT,
            node: { children: new Map() },
            visits,
            totalReward: e.meanReward * visits,
            totalMargin: e.meanMargin * visits,
            avail: visits,
        });
    });
    return { children };
}

describe("Survival of the Fittest — the search chooses the discard (issue #2135)", () => {
    it("enumerates one variant per distinct creature, cheapest first (CR 118.3)", () => {
        const activations = enumerateMoves(survivalState(), BOT).filter(
            (m) => m.kind === "activate-ability"
        );
        const picked = activations.map((m) =>
            m.kind === "activate-ability" ? m.costPicks?.discardIds : undefined
        );
        expect(picked).toEqual([["bear"], ["wurm"]]);
    });

    it("selectRootMove returns the better-rewarded discard variant, not the enumeration-order default", () => {
        const activations = enumerateMoves(survivalState(), BOT).filter(
            (m): m is Extract<Move, { kind: "activate-ability" }> =>
                m.kind === "activate-ability"
        );
        expect(activations).toHaveLength(2);

        // Pitching the Bears (keeping the Craw Wurm) is the strictly-better
        // line: the tutor finds the best creature regardless, so the pitch that
        // loses less material is the correct one.
        const [pitchBears, pitchWurm] = activations;
        const root = rootOf([
            { move: pitchBears, meanReward: 0.71, meanMargin: 300 },
            { move: pitchWurm, meanReward: 0.6, meanMargin: 200 },
        ]);

        const chosen = selectRootMove(root, [pitchBears, pitchWurm]);
        expect(chosen.kind).toBe("activate-ability");
        expect(
            (chosen as Extract<Move, { kind: "activate-ability" }>).costPicks
                ?.discardIds
        ).toEqual(["bear"]);
    });
});
