/**
 * The tree walk and the rollout answer a mandatory discard (issue #4917).
 *
 * A MANDATORY `discard-hand` choice (CR 701.9b — the discarding player picks)
 * has no in-tree candidate generator, so `decidingPlayer` returns `null` at
 * it. The walk and the rollout used to stop right there and score the leaf
 * mid-resolution: the discard spell spent, the mana tapped, the discard not
 * yet made. They now ask `advanceToDecision`, which applies the forced answer
 * (`forcedChoiceAnswer`) and hands back whoever decides next.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { resolveTopOfStack } from "../../state";
import { cloneGameState } from "../../clone";
import { enumerateMoves } from "../../moves";
import {
    advanceToDecision,
    applyMoveInSearch,
    decidingPlayer,
} from "../../search";
import { buildPositionFromSpec } from "../blade/build";

type SpecCard = ScenarioSpec["cards"][number];

function position(cards: SpecCard[]): GameState {
    return buildPositionFromSpec({
        cards,
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    });
}

const idOf = (c: { card: unknown }) => (c.card as { id?: string }).id;

/** Cast Mind Rot at the opponent and resolve it up to the opponent's
 *  discard: the state the walk used to score as a leaf. */
function midMindRot(oppHand: SpecCard[]): GameState {
    const s = position([
        { name: "Mind Rot", owner: "me", zone: "hand" },
        ...oppHand,
    ]);
    const me = s.activePlayerId;
    const opp = s.players.find((p) => p.id !== me)!.id;
    const mindRot = s.players
        .find((p) => p.id === me)!
        .hand.find((c) => idOf(c) === getCardByName("Mind Rot").id)!;
    const cast = enumerateMoves(s, me).find(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === mindRot.id &&
            (m.targets ?? []).every((t) => t.type !== "player" || t.id === opp)
    );
    if (!cast) throw new Error("no Mind Rot cast at the opponent");
    applyMoveInSearch(s, me, cast);
    resolveTopOfStack(s);
    return s;
}

describe("advanceToDecision — a mandatory discard is answered, not scored (issue #4917)", () => {
    it("the position the walk used to stop at: the opponent's discard, no decider", () => {
        const mid = midMindRot([
            { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            { name: "Hill Giant", owner: "opp", zone: "hand" },
        ]);
        expect(mid.pendingChoices?.[0]?.kind).toBe("discard-hand");
        expect(mid.pendingChoices?.[0]?.playerId).not.toBe(mid.activePlayerId);
        expect(decidingPlayer(mid)).toBeNull();
    });

    it("finishes the resolution and hands priority back: the discard is made", () => {
        const mid = midMindRot([
            { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            { name: "Hill Giant", owner: "opp", zone: "hand" },
        ]);
        const me = mid.activePlayerId;
        expect(advanceToDecision(mid)).toBe(me);
        expect(mid.pendingChoices?.length ?? 0).toBe(0);
        expect(mid.stack).toHaveLength(0);
        const opp = mid.players.find((p) => p.id !== me)!;
        expect(opp.hand).toHaveLength(0);
        expect(opp.graveyard.map(idOf)).toEqual(
            expect.arrayContaining([
                getCardByName("Grizzly Bears").id,
                getCardByName("Hill Giant").id,
            ])
        );
    });

    it("the chooser sheds its least valuable cards: it keeps its best", () => {
        const mid = midMindRot([
            { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            { name: "Hill Giant", owner: "opp", zone: "hand" },
            { name: "Serra Angel", owner: "opp", zone: "hand" },
        ]);
        advanceToDecision(mid);
        const opp = mid.players.find((p) => p.id !== mid.activePlayerId)!;
        expect(opp.hand.map(idOf)).toEqual([getCardByName("Serra Angel").id]);
    });

    it("anywhere else it is `decidingPlayer`, and leaves the state as it was", () => {
        const s = position([
            { name: "Mind Rot", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "opp", zone: "hand" },
        ]);
        const before = JSON.stringify(s);
        expect(advanceToDecision(s)).toBe(decidingPlayer(cloneGameState(s)));
        expect(advanceToDecision(s)).toBe(s.activePlayerId);
        expect(JSON.stringify(s)).toBe(before);
    });
});
