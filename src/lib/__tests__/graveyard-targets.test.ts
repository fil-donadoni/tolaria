import { describe, it, expect } from "vitest";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import {
    getEligibleGraveyards,
    isGraveyardTargetForViewer,
    matchesGraveyardTarget,
} from "~/lib/graveyard-targets";

function gyCard(id: string, ownerId: string, types: string[]): CardInstance {
    return {
        id,
        card: { id: `def-${id}` },
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
        isTapped: false,
        types,
    } as CardInstance;
}

function player(id: string, graveyard: CardInstance[]): Player {
    return {
        id,
        name: id === "me" ? "Me" : "Opp",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard,
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function pending(over: Partial<PendingTarget>): PendingTarget {
    return {
        playerId: "me",
        cardInstanceId: "src",
        targetType: "Creature",
        count: 1,
        zone: "graveyard",
        selected: [],
        ...over,
    } as PendingTarget;
}

describe("isGraveyardTargetForViewer", () => {
    it("true only for a graveyard-zone target owned by the viewer", () => {
        expect(
            isGraveyardTargetForViewer(pending({ playerId: "me" }), "me")
        ).toBe(true);
        expect(
            isGraveyardTargetForViewer(pending({ playerId: "opp" }), "me")
        ).toBe(false);
        expect(
            isGraveyardTargetForViewer(pending({ zone: "battlefield" }), "me")
        ).toBe(false);
        expect(isGraveyardTargetForViewer(undefined, "me")).toBe(false);
    });
});

describe("matchesGraveyardTarget (mirror of server filter, CR 109.2)", () => {
    it("controller 'you' rejects the opponent's graveyard", () => {
        const card = gyCard("c", "opp", ["Creature"]);
        expect(
            matchesGraveyardTarget(
                card,
                "opp",
                pending({ controller: "you" }),
                "me"
            )
        ).toBe(false);
    });
    it("controller 'opponent' rejects the viewer's own graveyard", () => {
        const card = gyCard("c", "me", ["Creature"]);
        expect(
            matchesGraveyardTarget(
                card,
                "me",
                pending({ controller: "opponent" }),
                "me"
            )
        ).toBe(false);
    });
    it("controller 'any' accepts either graveyard", () => {
        expect(
            matchesGraveyardTarget(
                gyCard("c", "opp", ["Creature"]),
                "opp",
                pending({ controller: "any" }),
                "me"
            )
        ).toBe(true);
    });
    it("rejects a card whose type does not match the requirement", () => {
        const land = gyCard("l", "me", ["Land"]);
        expect(
            matchesGraveyardTarget(
                land,
                "me",
                pending({ targetType: "Creature" }),
                "me"
            )
        ).toBe(false);
    });
    it("type 'card' matches any card type", () => {
        const land = gyCard("l", "me", ["Land"]);
        expect(
            matchesGraveyardTarget(
                land,
                "me",
                pending({ targetType: "card" }),
                "me"
            )
        ).toBe(true);
    });
});

describe("getEligibleGraveyards", () => {
    it("returns only graveyards with ≥1 legal card, viewer's own first", () => {
        const me = player("me", [
            gyCard("m1", "me", ["Creature"]),
            gyCard("m2", "me", ["Land"]),
        ]);
        const opp = player("opp", [gyCard("o1", "opp", ["Creature"])]);
        const result = getEligibleGraveyards(
            pending({ controller: "any" }),
            [opp, me],
            "me"
        );
        expect(result.map((g) => g.playerId)).toEqual(["me", "opp"]);
        // Only the creature in my graveyard is legal.
        expect(result[0].cards.map((c) => c.id)).toEqual(["m1"]);
        expect(result[1].cards.map((c) => c.id)).toEqual(["o1"]);
    });

    it("omits an empty-after-filter graveyard (single eligible → skip choice)", () => {
        const me = player("me", [gyCard("m1", "me", ["Creature"])]);
        const opp = player("opp", [gyCard("o1", "opp", ["Land"])]);
        const result = getEligibleGraveyards(
            pending({ controller: "any" }),
            [me, opp],
            "me"
        );
        expect(result.length).toBe(1);
        expect(result[0].playerId).toBe("me");
    });
});
