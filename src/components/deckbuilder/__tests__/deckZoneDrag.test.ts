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
    zoneTabDropId,
    SOURCE_TAB_DROP_ID,
    isSourceTabDropId,
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
        ).toEqual({ type: "moveToSideboard", cardId: "bolt", pinKey: "bolt" });
    });

    it("Maindeck card → a Sideboard COLUMN also just moves it out — no Pin", () => {
        // The Sideboard is one destination; a card leaving the deck records
        // nothing (issue #1622 AC).
        expect(
            resolveDeckZoneDragAction(
                mainCard,
                zoneColumnDropId("sideboard", MV5)
            )
        ).toEqual({ type: "moveToSideboard", cardId: "bolt", pinKey: "bolt" });
    });

    it("Maindeck card → another Maindeck Column records a Card Pin, staying in the deck", () => {
        expect(
            resolveDeckZoneDragAction(
                mainCard,
                zoneColumnDropId("maindeck", MV5)
            )
        ).toEqual({
            type: "pin",
            cardId: "bolt",
            columnId: "mv:5",
            // No `pinKey` on the source, so it falls back to the card id —
            // the Constructed rule, where all copies pin together (#1626).
            pinKey: "bolt",
        });
    });

    it("Maindeck card → the Lands Column pins it into Lands (issue #1573 parity)", () => {
        expect(
            resolveDeckZoneDragAction(
                mainCard,
                zoneColumnDropId("maindeck", LANDS)
            )
        ).toEqual({
            type: "pin",
            cardId: "bolt",
            columnId: "mv:lands",
            pinKey: "bolt",
        });
    });

    // Per-copy Card Pins (issue #1626): a surface that distinguishes copies
    // (Limited, keyed by `poolIndex`) puts the copy's own key on the drag
    // payload, and the resolver carries it through untouched instead of
    // re-deriving it from the card id — which is what made two copies of one
    // card impossible to file separately.
    it("carries the dragged COPY's pin key through, when the source declares one", () => {
        expect(
            resolveDeckZoneDragAction(
                { ...mainCard, pinKey: "7" },
                zoneColumnDropId("maindeck", MV5)
            )
        ).toEqual({
            type: "pin",
            cardId: "bolt",
            columnId: "mv:5",
            pinKey: "7",
        });
        expect(
            resolveDeckZoneDragAction(
                { ...sideCard, pinKey: "9" },
                zoneColumnDropId("maindeck", MV5)
            )
        ).toEqual({
            type: "moveToMaindeck",
            cardId: "bolt",
            columnId: "mv:5",
            pinKey: "9",
        });
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
            pinKey: "bolt",
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
            ).toEqual({
                type: "pin",
                cardId: "bolt",
                columnId,
                pinKey: "bolt",
            });
        }
    });
});

function handlers() {
    return {
        onMoveToSideboard: vi.fn<(cardId: string) => void>(),
        onMoveToMaindeck: vi.fn<(cardId: string) => void>(),
        onPin: vi.fn<
            (cardId: string, columnId: string, pinKey: string) => void
        >(),
        onAddToMaindeck: vi.fn<(cardId: string, cardName: string) => void>(),
        onAddToSideboard: vi.fn<(cardId: string, cardName: string) => void>(),
        onRemoveFromDeck:
            vi.fn<
                (
                    cardId: string,
                    zone: "maindeck" | "sideboard",
                    pinKey?: string
                ) => void
            >(),
    } satisfies DeckZoneDragHandlers;
}

describe("applyDeckZoneDragAction (issue #1622)", () => {
    it("a Sideboard→Column drop is ONE gesture: membership AND the Pin", () => {
        const h = handlers();
        applyDeckZoneDragAction(
            {
                type: "moveToMaindeck",
                cardId: "bolt",
                columnId: "mv:5",
                pinKey: "bolt",
            },
            h
        );
        expect(h.onMoveToMaindeck).toHaveBeenCalledWith("bolt", "bolt");
        expect(h.onPin).toHaveBeenCalledWith("bolt", "mv:5", "bolt");
    });

    it("a Maindeck→Sideboard drop records no Pin", () => {
        const h = handlers();
        applyDeckZoneDragAction(
            { type: "moveToSideboard", cardId: "bolt", pinKey: "bolt" },
            h
        );
        // The dragged COPY travels with the move (issue #1626) so the host
        // sideboards the card the player actually dragged.
        expect(h.onMoveToSideboard).toHaveBeenCalledWith("bolt", "bolt");
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

// ────────────────────────────────────────────────────────────────────────────
// The phone Pane Tabs (issue #2584). A tab is a SECOND drop target for a pane
// the player cannot see, so the two things that matter are: it resolves to the
// SAME action a drop on the pane itself would, and the SOURCE tab — the one
// pane that is not a Zone — means "leave the deck".
//
// The producer census behind these rows: a drag payload's `kind` is the whole
// input space (`dnd-types.ts`), and there are exactly three producers of one —
// `DraggableCard` (Constructed search results, `kind: "result"`) and
// `DeckCardTile` under each of the two zones (`"main"` / `"side"`). Every row
// below is one of those three against the new target, INCLUDING the two that
// must NOT act.
// ────────────────────────────────────────────────────────────────────────────
describe("resolveDeckZoneDragAction — Pane Tabs (issue #2584)", () => {
    it("a ZONE tab resolves exactly as a drop on that zone's pane", () => {
        expect(
            resolveDeckZoneDragAction(mainCard, zoneTabDropId("sideboard"))
        ).toEqual(
            resolveDeckZoneDragAction(mainCard, zonePaneDropId("sideboard"))
        );
        expect(
            resolveDeckZoneDragAction(sideCard, zoneTabDropId("maindeck"))
        ).toEqual(
            resolveDeckZoneDragAction(sideCard, zonePaneDropId("maindeck"))
        );
    });

    it("a search result dropped on a zone tab adds a copy to that zone", () => {
        expect(
            resolveDeckZoneDragAction(resultCard, zoneTabDropId("sideboard"))
        ).toEqual({
            type: "addToSideboard",
            cardId: "bolt",
            cardName: "Lightning Bolt",
        });
    });

    it("a MAINDECK card dropped on the SOURCE tab leaves the deck, naming the zone it left", () => {
        expect(resolveDeckZoneDragAction(mainCard, SOURCE_TAB_DROP_ID)).toEqual(
            {
                type: "removeFromDeck",
                cardId: "bolt",
                zone: "maindeck",
                pinKey: "bolt",
            }
        );
    });

    it("a SIDEBOARD card dropped on the SOURCE tab leaves the sideboard, carrying the dragged COPY's key", () => {
        expect(
            resolveDeckZoneDragAction(
                { ...sideCard, pinKey: "7" },
                SOURCE_TAB_DROP_ID
            )
        ).toEqual({
            type: "removeFromDeck",
            cardId: "bolt",
            zone: "sideboard",
            pinKey: "7",
        });
    });

    it("must NOT act: a search RESULT dropped on the source tab — it never entered the deck", () => {
        expect(
            resolveDeckZoneDragAction(resultCard, SOURCE_TAB_DROP_ID)
        ).toBeNull();
    });

    it("must NOT act: a Maindeck card dropped on the MAINDECK tab — a tab names no Column, so there is no Pin to record", () => {
        expect(
            resolveDeckZoneDragAction(mainCard, zoneTabDropId("maindeck"))
        ).toBeNull();
    });

    it("recognises the source tab id and nothing else", () => {
        expect(isSourceTabDropId(SOURCE_TAB_DROP_ID)).toBe(true);
        expect(isSourceTabDropId(zoneTabDropId("maindeck"))).toBe(false);
        expect(isSourceTabDropId(zonePaneDropId("maindeck"))).toBe(false);
        expect(isSourceTabDropId(undefined)).toBe(false);
    });

    it("dispatches removeFromDeck to the host, and stays a no-op for a variant that declares no source pane", () => {
        const h = handlers();
        applyDeckZoneDragAction(
            {
                type: "removeFromDeck",
                cardId: "bolt",
                zone: "sideboard",
                pinKey: "7",
            },
            h
        );
        expect(h.onRemoveFromDeck).toHaveBeenCalledWith(
            "bolt",
            "sideboard",
            "7"
        );

        const limited: DeckZoneDragHandlers = {
            onMoveToSideboard: h.onMoveToSideboard,
            onMoveToMaindeck: h.onMoveToMaindeck,
            onPin: h.onPin,
        };
        expect(() =>
            applyDeckZoneDragAction(
                {
                    type: "removeFromDeck",
                    cardId: "bolt",
                    zone: "maindeck",
                    pinKey: "bolt",
                },
                limited
            )
        ).not.toThrow();
    });
});
