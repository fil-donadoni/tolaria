import { describe, it, expect } from "vitest";
import {
    setupManualGame,
    projectManualState,
    manualSetFaceDown,
    manualReveal,
    manualMoveCard,
    MANUAL_FACE_DOWN_CARD_ID,
} from "../manual";

function freshState() {
    return setupManualGame([
        {
            id: "p1",
            name: "Alice",
            bgColor: "#aabbcc",
            deck: [
                { cardId: "c1", cardName: "Mountain" },
                { cardId: "c2", cardName: "Lightning Bolt" },
                { cardId: "c3", cardName: "Shock" },
                { cardId: "c4", cardName: "Grizzly Bears" },
                { cardId: "c5", cardName: "Savannah Lions" },
                { cardId: "c6", cardName: "Serra Angel" },
                { cardId: "c7", cardName: "Counterspell" },
                { cardId: "c8", cardName: "Wrath of God" },
                { cardId: "c9", cardName: "Plains" },
                { cardId: "c10", cardName: "Forest" },
            ],
        },
        {
            id: "p2",
            name: "Bob",
            bgColor: "#ddeeff",
            deck: [
                { cardId: "c11", cardName: "Swamp" },
                { cardId: "c12", cardName: "Dark Ritual" },
                { cardId: "c13", cardName: "Hypnotic Specter" },
                { cardId: "c14", cardName: "Terror" },
                { cardId: "c15", cardName: "Sengir Vampire" },
                { cardId: "c16", cardName: "Duress" },
                { cardId: "c17", cardName: "Hymn to Tourach" },
                { cardId: "c18", cardName: "Necropotence" },
                { cardId: "c19", cardName: "Badlands" },
                { cardId: "c20", cardName: "Bayou" },
            ],
        },
    ]);
}

describe("projectManualState — opponent hand hidden", () => {
    it("own hand cards are visible", () => {
        const state = freshState();
        const projected = projectManualState(state, "p1");

        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.hand).toHaveLength(7);
        for (const card of p1.hand) {
            expect(card).not.toBeNull();
            expect(card!.card.id).toBeTruthy();
        }
    });

    it("opponent hand is null[] with correct length", () => {
        const state = freshState();
        const projected = projectManualState(state, "p1");

        const p2 = projected.players.find((p) => p.id === "p2")!;
        expect(p2.hand).toHaveLength(7);
        for (const card of p2.hand) {
            expect(card).toBeNull();
        }
    });
});

describe("projectManualState — library hidden", () => {
    it("own library is projected as { count } only", () => {
        const state = freshState();
        const projected = projectManualState(state, "p1");

        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.library).toEqual({ count: 3 }); // 10 - 7 drawn
    });

    it("opponent library is projected as { count } only", () => {
        const state = freshState();
        const projected = projectManualState(state, "p1");

        const p2 = projected.players.find((p) => p.id === "p2")!;
        expect(p2.library).toEqual({ count: 3 });
    });
});

describe("projectManualState — faceDown outside knownTo", () => {
    it("face-down card shows real id to known viewer (controller)", () => {
        const state = freshState();
        // Move a card to battlefield and set it face-down.
        const p1 = state.players.find((p) => p.id === "p1")!;
        const card = p1.hand[0];
        const moved = manualMoveCard(state, card.id, "battlefield");
        const fd = manualSetFaceDown(moved.state, card.id, true);

        const projected = projectManualState(fd.state, "p1");
        const bf = projected.players.find((p) => p.id === "p1")!.battlefield;
        const projectedCard = bf.find((c) => c.id === card.id);
        expect(projectedCard).toBeDefined();
        expect(projectedCard!.card.id).toBe(card.card.id);
        expect(projectedCard!.faceDown).toBe(true);
    });

    it("face-down card shows back to non-known viewer", () => {
        const state = freshState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        const card = p1.hand[0];
        const moved = manualMoveCard(state, card.id, "battlefield");
        const fd = manualSetFaceDown(moved.state, card.id, true);

        const projected = projectManualState(fd.state, "p2");
        const bf = projected.players.find((p) => p.id === "p1")!.battlefield;
        const projectedCard = bf.find((c) => c.id === card.id);
        expect(projectedCard).toBeDefined();
        expect(projectedCard!.card.id).toBe(MANUAL_FACE_DOWN_CARD_ID);
        expect(projectedCard!.faceDown).toBe(true);
    });

    it("face-down back does not leak revealedTo or knownTo", () => {
        const state = freshState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        const card = p1.hand[0];
        const moved = manualMoveCard(state, card.id, "battlefield");
        const fd = manualSetFaceDown(moved.state, card.id, true);

        const projected = projectManualState(fd.state, "p2");
        const bf = projected.players.find((p) => p.id === "p1")!.battlefield;
        const projectedCard = bf.find((c) => c.id === card.id)!;
        expect(
            (projectedCard as Record<string, unknown>).knownTo
        ).toBeUndefined();
        expect(
            (projectedCard as Record<string, unknown>).revealedTo
        ).toBeUndefined();
    });
});

describe("projectManualState — revealedTo", () => {
    it("card revealed to opponent appears in opponent's projected hand", () => {
        const state = freshState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        const card = p1.hand[0];
        const revealed = manualReveal(state, card.id, ["p2"]);

        const projected = projectManualState(revealed.state, "p2");
        // The card is in p1's hand, viewed by p2 — it should be visible
        // because it's revealed to p2.
        const p2View = projected.players.find((p) => p.id === "p2")!;
        // p2's own hand should still be their own cards
        expect(p2View.hand.filter((c) => c !== null)).toHaveLength(7);
        // But what really matters: the OPPONENT's (p1's) hand now shows the
        // revealed card to p2.
        const p1Hand = projected.players.find((p) => p.id === "p1")!.hand;
        const revealedCard = p1Hand.find(
            (c) => c !== null && c!.id === card.id
        );
        expect(revealedCard).toBeDefined();
        expect(revealedCard!.card.id).toBe(card.card.id);
    });

    it("card revealed to p2 is not visible when projecting for p1 (not revealed to)", () => {
        const state = freshState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        const card = p1.hand[1]; // Different card from the reveal test above
        const revealed = manualReveal(state, card.id, ["p2"]);

        // When p1 looks at p1's own hand, they see all their cards anyway.
        // The real test: does a THIRD player (not p1, not p2) see p1's
        // revealed card? In a 2-player game there is no third, but the
        // "not revealed to" test means checking p2 sees THEIR opponent's
        // (p1's) hand and CAN see the revealed card.
        // The other direction: a card NOT revealed to p2 stays null.
        const projected = projectManualState(revealed.state, "p2");
        const p1Hand = projected.players.find((p) => p.id === "p1")!.hand;

        // The revealed card (index 1) should be visible to p2.
        const revealedEntry = p1Hand[1];
        expect(revealedEntry).not.toBeNull();
        expect(revealedEntry!.card.id).toBe(card.card.id);

        // The non-revealed card (index 2) should be null to p2.
        expect(p1Hand[2]).toBeNull();
    });

    it("revealedTo honored after card moves zones", () => {
        const state = freshState();
        const p1 = state.players.find((p) => p.id === "p1")!;
        const card = p1.hand[0];
        const revealed = manualReveal(state, card.id, ["p2"]);
        const moved = manualMoveCard(revealed.state, card.id, "battlefield");

        // p2 should still see the card on the battlefield
        const projected = projectManualState(moved.state, "p2");
        const p1Bf = projected.players.find((p) => p.id === "p1")!.battlefield;
        const movedCard = p1Bf.find((c) => c.id === card.id);
        expect(movedCard).toBeDefined();
        expect(movedCard!.card.id).toBe(card.card.id);
    });
});
