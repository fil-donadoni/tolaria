// CR 118.9 / 701.20a — an alternative cost that REVEALS the caster's hand,
// gated on the hand holding no card of a type (Land Grant). Three seams:
// the condition, the Cast Commit's reveal, and the wire the opponent reads.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, getDefinition } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import {
    alternativeCostConditionMet,
    canPayAlternativeCost,
} from "../alternativeCost";
import type { AlternativeCost, CardDefinition } from "../../cards/types";
import { commitCast } from "../castCommit";
import { getAlternativeCost } from "../alternativeCost";

const forest = getCardByName("Forest");
const bolt = getCardByName("Lightning Bolt");
// Land Grant's compiled alternative cost (the gold of the Oracle compiler's
// golden fixture), spread onto an existing sorcery-speed spell so the test
// does not depend on the catalogue snapshot.
const REVEAL_COST: AlternativeCost = {
    id: "reveal-hand-no-land-cards",
    description: "Reveal your hand",
    condition: { kind: "no-hand-cards", filter: { type: "Land" } },
    revealHand: true,
};
const landGrant: CardDefinition = {
    ...getDefinition(bolt.id),
    alternativeCosts: [REVEAL_COST],
};

const NO_LANDS = {
    kind: "no-hand-cards",
    filter: { type: "Land" },
} as const;

function hand(cardId: string, id: string) {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
}

function position(cards: ReturnType<typeof hand>[]) {
    return makeState({
        players: [makePlayer("p1", { hand: cards }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

describe("no-hand-cards condition (CR 118.9)", () => {
    it("holds with no land in hand, fails with one", () => {
        expect(
            alternativeCostConditionMet(
                position([hand(bolt.id, "b")]),
                "p1",
                NO_LANDS
            )
        ).toBe(true);
        expect(
            alternativeCostConditionMet(
                position([hand(bolt.id, "b"), hand(forest.id, "f")]),
                "p1",
                NO_LANDS
            )
        ).toBe(false);
    });

    it("gates Land Grant's reveal cost", () => {
        const alt = getAlternativeCost(landGrant, REVEAL_COST.id)!;
        expect(alt.revealHand).toBe(true);
        const castable = position([hand(landGrant.id, "lg")]);
        const blocked = position([
            hand(landGrant.id, "lg"),
            hand(forest.id, "f"),
        ]);
        expect(canPayAlternativeCost(castable, "p1", alt, "lg")).toBe(true);
        expect(canPayAlternativeCost(blocked, "p1", alt, "lg")).toBe(false);
    });
});

describe("reveal-hand leg at the Cast Commit (CR 701.20a)", () => {
    function commit(revealHand: boolean) {
        const state = position([hand(landGrant.id, "lg"), hand(bolt.id, "b")]);
        const item = commitCast(state, {
            casterId: "p1",
            cardInstanceId: "lg",
            cardDef: landGrant,
            manaCost: {},
            source: { zone: "hand" },
            legs: revealHand ? { revealHand: true } : {},
            record: {},
            mode: {},
            placement: { kind: "announce" },
        });
        expect(item).not.toBeNull();
        return state;
    }

    it("makes the remaining hand known to the opponent, through the projection", () => {
        const state = commit(true);
        const slot = projectPublicState(state, 1, "p2").players[0]!.hand;
        expect(slot).toHaveLength(1);
        expect(slot[0]).not.toBeNull();
        expect(slot[0]!.id).toBe("b");
    });

    it("reveals nothing when the chosen cost does not", () => {
        const state = commit(false);
        const slot = projectPublicState(state, 1, "p2").players[0]!.hand;
        expect(slot[0]).toBeNull();
    });
});
