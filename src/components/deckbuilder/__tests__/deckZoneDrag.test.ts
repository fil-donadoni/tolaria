// Shared deckbuilder zone drag resolution (issue #1622) — the successor of
// `deckbuilderColumnDrag.test.ts`, extended for the two things #1622 adds: a
// Zone-namespaced drop id (both zones generate the SAME Column ids) and the
// Constructed builder's "add from search results" source.
import { describe, it, expect, vi } from "vitest";
import { makeColumnId } from "@convex/deckLayout";
import {
    applyDeckZoneDragAction,
    parseDeckZoneDropId,
    resolveDeckZoneDragAction,
    zoneColumnDropId,
    zonePaneDropId,
    type DeckZoneDragHandlers,
} from "../deckZoneDrag";

const mainCard = {
    kind: "main" as const,
    cardId: "bolt",
    cardName: "Lightning Bolt",
};
const sideCard = {
    kind: "side" as const,
    cardId: "bolt",
    cardName: "Lightning Bolt",
};
const resultCard = {
    kind: "result" as const,
    cardId: "bolt",
    cardName: "Lightning Bolt",
};

const MV5 = makeColumnId("mv", "5");
const LANDS = makeColumnId("mv", "lands");

describe("deck-zone drop ids (issue #1622)", () => {
    it("round-trips a Zone + Column id", () => {
        expect(parseDeckZoneDropId(zoneColumnDropId("maindeck", MV5))).toEqual({
            zone: "maindeck",
            columnId: "mv:5",
        });
        expect(
            parseDeckZoneDropId(zoneColumnDropId("sideboard", LANDS))
        ).toEqual({ zone: "sideboard", columnId: "mv:lands" });
    });

    it("round-trips a whole-Zone (pane) id, with no Column named", () => {
        expect(parseDeckZoneDropId(zonePaneDropId("sideboard"))).toEqual({
            zone: "sideboard",
            columnId: null,
        });
    });

    it("keeps the two zones' identically-named Columns distinct", () => {
        expect(zoneColumnDropId("maindeck", MV5)).not.toBe(
            zoneColumnDropId("sideboard", MV5)
        );
    });

    it("rejects an id this surface does not own", () => {
        expect(parseDeckZoneDropId(undefined)).toBeNull();
        expect(parseDeckZoneDropId("pool-col-5")).toBeNull();
        expect(parseDeckZoneDropId("deck-zone:graveyard:mv:5")).toBeNull();
    });
});

describe("resolveDeckZoneDragAction (issue #1622)", () => {
    it("returns null for a cancelled/incomplete drop (missing source or target)", () => {
        expect(
            resolveDeckZoneDragAction(
                undefined,
                zoneColumnDropId("maindeck", MV5)
            )
        ).toBeNull();
        expect(resolveDeckZoneDragAction(mainCard, undefined)).toBeNull();
    });

    it("Maindeck card → the Sideboard moves it out of the deck", () => {
        expect(
            resolveDeckZoneDragAction(mainCard, zonePaneDropId("sideboard"))
        ).toEqual({ type: "moveToSideboard", cardId: "bolt" });
    });

    it("Maindeck card → a Sideboard COLUMN also just moves it out — no Pin", () => {
        // The Sideboard is one destination; a card leaving the deck records
        // nothing (issue #1622 AC).
        expect(
            resolveDeckZoneDragAction(
                mainCard,
                zoneColumnDropId("sideboard", MV5)
            )
        ).toEqual({ type: "moveToSideboard", cardId: "bolt" });
    });

    it("Maindeck card → another Maindeck Column records a Card Pin, staying in the deck", () => {
        expect(
            resolveDeckZoneDragAction(
                mainCard,
                zoneColumnDropId("maindeck", MV5)
            )
        ).toEqual({ type: "pin", cardId: "bolt", columnId: "mv:5" });
    });

    it("Maindeck card → the Lands Column pins it into Lands (issue #1573 parity)", () => {
        expect(
            resolveDeckZoneDragAction(
                mainCard,
                zoneColumnDropId("maindeck", LANDS)
            )
        ).toEqual({ type: "pin", cardId: "bolt", columnId: "mv:lands" });
    });

    it("Maindeck card → the Maindeck pane (no Column) is a no-op, not a cleared Pin", () => {
        expect(
            resolveDeckZoneDragAction(mainCard, zonePaneDropId("maindeck"))
        ).toBeNull();
    });

    it("Sideboard card → a Maindeck Column moves it in AND names the Column", () => {
        expect(
            resolveDeckZoneDragAction(
                sideCard,
                zoneColumnDropId("maindeck", MV5)
            )
        ).toEqual({
            type: "moveToMaindeck",
            cardId: "bolt",
            columnId: "mv:5",
        });
    });

    it("Sideboard card → the Sideboard is a no-op", () => {
        expect(
            resolveDeckZoneDragAction(sideCard, zonePaneDropId("sideboard"))
        ).toBeNull();
        expect(
            resolveDeckZoneDragAction(
                sideCard,
                zoneColumnDropId("sideboard", MV5)
            )
        ).toBeNull();
    });

    it("a search result adds to whichever Zone it lands on", () => {
        expect(
            resolveDeckZoneDragAction(
                resultCard,
                zoneColumnDropId("maindeck", MV5)
            )
        ).toEqual({
            type: "addToMaindeck",
            cardId: "bolt",
            cardName: "Lightning Bolt",
        });
        expect(
            resolveDeckZoneDragAction(resultCard, zonePaneDropId("sideboard"))
        ).toEqual({
            type: "addToSideboard",
            cardId: "bolt",
            cardName: "Lightning Bolt",
        });
    });

    it("an unrecognized drop-target id is a no-op", () => {
        expect(
            resolveDeckZoneDragAction(mainCard, "some-unrelated-zone")
        ).toBeNull();
    });

    it("every Mana-Value Column id round-trips to a Pin for a Maindeck card", () => {
        for (let n = 0; n <= 7; n++) {
            const columnId = makeColumnId("mv", String(n));
            expect(
                resolveDeckZoneDragAction(
                    mainCard,
                    zoneColumnDropId("maindeck", columnId)
                )
            ).toEqual({ type: "pin", cardId: "bolt", columnId });
        }
    });
});

function handlers() {
    return {
        onMoveToSideboard: vi.fn<(cardId: string) => void>(),
        onMoveToMaindeck: vi.fn<(cardId: string) => void>(),
        onPin: vi.fn<(cardId: string, columnId: string) => void>(),
        onAddToMaindeck: vi.fn<(cardId: string, cardName: string) => void>(),
        onAddToSideboard: vi.fn<(cardId: string, cardName: string) => void>(),
    } satisfies DeckZoneDragHandlers;
}

describe("applyDeckZoneDragAction (issue #1622)", () => {
    it("a Sideboard→Column drop is ONE gesture: membership AND the Pin", () => {
        const h = handlers();
        applyDeckZoneDragAction(
            { type: "moveToMaindeck", cardId: "bolt", columnId: "mv:5" },
            h
        );
        expect(h.onMoveToMaindeck).toHaveBeenCalledWith("bolt");
        expect(h.onPin).toHaveBeenCalledWith("bolt", "mv:5");
    });

    it("a Maindeck→Sideboard drop records no Pin", () => {
        const h = handlers();
        applyDeckZoneDragAction({ type: "moveToSideboard", cardId: "bolt" }, h);
        expect(h.onMoveToSideboard).toHaveBeenCalledWith("bolt");
        expect(h.onPin).not.toHaveBeenCalled();
    });

    it("a host with no search-results source (Limited) simply ignores the add actions", () => {
        const h = handlers();
        const limited: DeckZoneDragHandlers = {
            onMoveToSideboard: h.onMoveToSideboard,
            onMoveToMaindeck: h.onMoveToMaindeck,
            onPin: h.onPin,
        };
        expect(() =>
            applyDeckZoneDragAction(
                { type: "addToMaindeck", cardId: "bolt", cardName: "Bolt" },
                limited
            )
        ).not.toThrow();
        expect(h.onMoveToMaindeck).not.toHaveBeenCalled();
    });
});
