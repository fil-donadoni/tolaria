import { describe, expect, it } from "vitest";
import {
    SIDEBOARD_LIMIT,
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "../deckSideboard";
import type { DeckCard } from "~/types/game";

function card(id: string, name = id): DeckCard {
    return { cardId: id, cardName: name };
}

describe("deck sideboard moves (issue #391)", () => {
    it("moves a single copy from Maindeck to Sideboard, preserving the pool", () => {
        const split: SideboardSplit = {
            cards: [card("bolt"), card("bolt"), card("plains")],
            sideboard: [],
        };
        const next = moveToSideboard(split, "bolt");
        expect(next.cards).toEqual([card("bolt"), card("plains")]);
        expect(next.sideboard).toEqual([card("bolt")]);
        // Combined pool unchanged in size.
        expect(next.cards.length + next.sideboard.length).toBe(3);
    });

    it("moves a single copy from Sideboard to Maindeck", () => {
        const split: SideboardSplit = {
            cards: [card("plains")],
            sideboard: [card("bolt"), card("bolt")],
        };
        const next = moveToMaindeck(split, "bolt");
        expect(next.cards).toEqual([card("plains"), card("bolt")]);
        expect(next.sideboard).toEqual([card("bolt")]);
    });

    it("moves only ONE copy even when multiples exist", () => {
        const split: SideboardSplit = {
            cards: [card("bolt"), card("bolt"), card("bolt")],
            sideboard: [],
        };
        const next = moveToSideboard(split, "bolt");
        expect(next.cards.length).toBe(2);
        expect(next.sideboard.length).toBe(1);
    });

    it("is a no-op when the card is absent from the source pile", () => {
        const split: SideboardSplit = {
            cards: [card("plains")],
            sideboard: [],
        };
        expect(moveToSideboard(split, "bolt")).toBe(split);
        expect(moveToMaindeck(split, "plains")).toBe(split);
    });

    it("does not mutate the input split", () => {
        const split: SideboardSplit = {
            cards: [card("bolt")],
            sideboard: [],
        };
        moveToSideboard(split, "bolt");
        expect(split.cards).toEqual([card("bolt")]);
        expect(split.sideboard).toEqual([]);
    });

    it("allows the Sideboard to exceed the soft limit (no hard block)", () => {
        let split: SideboardSplit = {
            cards: Array.from({ length: SIDEBOARD_LIMIT + 1 }, () =>
                card("bolt")
            ),
            sideboard: [],
        };
        for (let i = 0; i < SIDEBOARD_LIMIT + 1; i++) {
            split = moveToSideboard(split, "bolt");
        }
        expect(split.sideboard.length).toBe(SIDEBOARD_LIMIT + 1);
        expect(split.sideboard.length > SIDEBOARD_LIMIT).toBe(true);
    });
});

// Issue #1626 / PR #2318 review NB-B. The `pinKey`-keyed lookup in
// `removeCopy` is what makes a Pin follow its physical card across a zone
// move — the whole point of retiring the positional ordinal that B1 was
// about. Breaking that lookup left this file green (only the mounted
// deckbuilder test caught it), so the unit-level guard was missing, and the
// documented stale-handle fallback was asserted nowhere at all.
describe("per-copy moves keyed by pinKey (issue #1626)", () => {
    const keyed = (
        id: string,
        pinKey: string
    ): DeckCard & {
        pinKey: string;
    } => ({ cardId: id, cardName: id, pinKey });

    it("moves the copy NAMED by pinKey, not the first one matching the cardId", () => {
        const split: SideboardSplit = {
            cards: [keyed("bolt", "0"), keyed("bolt", "2")],
            sideboard: [],
        };
        const next = moveToSideboard(split, "bolt", "2");
        expect(next.sideboard).toEqual([keyed("bolt", "2")]);
        expect(next.cards).toEqual([keyed("bolt", "0")]);
    });

    it("carries the pinKey ACROSS the move (the entry itself moves, not a copy of it)", () => {
        const split: SideboardSplit = {
            cards: [],
            sideboard: [keyed("bolt", "7")],
        };
        const next = moveToMaindeck(split, "bolt", "7");
        expect(next.cards[0].pinKey).toBe("7");
    });

    it("falls back to the first copy when the pinKey names none (a stale UI handle stays a working gesture)", () => {
        const split: SideboardSplit = {
            cards: [keyed("bolt", "0"), keyed("bolt", "2")],
            sideboard: [],
        };
        const next = moveToSideboard(split, "bolt", "99");
        expect(next.sideboard).toEqual([keyed("bolt", "0")]);
    });

    it("ignores pinKey entirely for Constructed entries, which carry none", () => {
        const split: SideboardSplit = {
            cards: [card("bolt"), card("bolt")],
            sideboard: [],
        };
        const next = moveToSideboard(split, "bolt", "0");
        expect(next.sideboard).toEqual([card("bolt")]);
        expect(next.cards).toEqual([card("bolt")]);
    });
});
