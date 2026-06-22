// Lobby deck transforms: a userDecks Doc → UserLobbyDeck, and a preset →
// PresetLobbyDeck. The key contract for issue #391 is backward compatibility —
// a deck saved before sideboarding (no `sideboard` field) must load as an
// empty Sideboard, not crash.
import { describe, it, expect } from "vitest";
import type { Doc } from "@convex/_generated/dataModel";
import type { DeckPreset } from "@convex/deckPresets";
import {
    toUserLobbyDeck,
    toPresetLobbyDeck,
    selectPreset,
    filterDecksByFormat,
} from "../deckTypes";
import type { FormatId } from "@convex/formats";

function userDeck(overrides: Partial<Doc<"userDecks">> = {}): Doc<"userDecks"> {
    return {
        _id: "deck_1" as Doc<"userDecks">["_id"],
        _creationTime: 0,
        userId: "user_1" as Doc<"userDecks">["userId"],
        name: "My Deck",
        format: "freeform",
        colors: ["R"],
        cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
        ...overrides,
    };
}

describe("toUserLobbyDeck (issue #391 backward compatibility)", () => {
    it("defaults a legacy deck (no sideboard field) to an empty Sideboard", () => {
        const deck = toUserLobbyDeck(userDeck());
        expect(deck.sideboard).toEqual([]);
        expect(deck.cards).toHaveLength(1);
    });

    it("carries an explicit sideboard through unchanged", () => {
        const deck = toUserLobbyDeck(
            userDeck({
                sideboard: [{ cardId: "disenchant", cardName: "Disenchant" }],
            })
        );
        expect(deck.sideboard).toEqual([
            { cardId: "disenchant", cardName: "Disenchant" },
        ]);
    });
});

describe("toPresetLobbyDeck (issue #391)", () => {
    const base: DeckPreset = {
        presetId: "p1",
        name: "Preset",
        format: "freeform",
        description: "",
        colors: ["W"],
        cards: [{ cardId: "plains", cardName: "Plains" }],
    };

    it("defaults a preset without a sideboard to an empty Sideboard", () => {
        expect(toPresetLobbyDeck(base).sideboard).toEqual([]);
    });

    it("carries a preset sideboard through unchanged", () => {
        const deck = toPresetLobbyDeck({
            ...base,
            sideboard: [{ cardId: "x", cardName: "X" }],
        });
        expect(deck.sideboard).toEqual([{ cardId: "x", cardName: "X" }]);
    });
});

describe("derived deck legality on lobby decks (ADR 0036, issue #512)", () => {
    // Real registry ids so the shared validateDeck resolves real prints.
    const BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
    const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

    function legalOldSchoolMain() {
        return [
            ...Array.from({ length: 40 }, () => ({
                cardId: BOLT_LEA,
                cardName: "Lightning Bolt",
            })),
            ...Array.from({ length: 20 }, () => ({
                cardId: MOUNTAIN,
                cardName: "Mountain",
            })),
        ];
    }

    it("a Freeform user deck is always legal", () => {
        const deck = toUserLobbyDeck(
            userDeck({ format: "freeform", cards: [] })
        );
        expect(deck.isLegal).toBe(true);
        expect(deck.reasons).toEqual([]);
    });

    it("an under-size Old School user deck is illegal with a precise reason", () => {
        const deck = toUserLobbyDeck(
            userDeck({
                format: "old-school",
                cards: [{ cardId: BOLT_LEA, cardName: "Lightning Bolt" }],
            })
        );
        expect(deck.isLegal).toBe(false);
        expect(deck.reasons.some((r) => r.code === "size-min")).toBe(true);
    });

    it("a full legal Old School user deck is legal", () => {
        const deck = toUserLobbyDeck(
            userDeck({ format: "old-school", cards: legalOldSchoolMain() })
        );
        expect(deck.isLegal).toBe(true);
    });

    it("a preset passes through server-derived legality when present", () => {
        const deck = toPresetLobbyDeck({
            presetId: "p",
            name: "Server-flagged",
            format: "old-school",
            description: "",
            colors: [],
            cards: [],
            // Server already computed this (convex/decks.ts) — trust it.
            isLegal: false,
            reasons: [{ code: "size-min", message: "too small" }],
        });
        expect(deck.isLegal).toBe(false);
        expect(deck.reasons).toEqual([
            { code: "size-min", message: "too small" },
        ]);
    });

    it("derives a preset's legality locally when the server didn't provide it", () => {
        const deck = toPresetLobbyDeck({
            presetId: "p2",
            name: "Tiny Old School",
            format: "old-school",
            description: "",
            colors: [],
            cards: [{ cardId: BOLT_LEA, cardName: "Lightning Bolt" }],
        });
        expect(deck.isLegal).toBe(false);
    });
});

describe("selectPreset — null-safe stored-selection fallback (issue #470)", () => {
    const decks = [
        toPresetLobbyDeck({
            presetId: "mono-red-burn",
            name: "Mono Red Burn",
            format: "freeform",
            description: "",
            colors: ["R"],
            cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
        }),
        toPresetLobbyDeck({
            presetId: "white-weenie",
            name: "White Weenie",
            format: "freeform",
            description: "",
            colors: ["W"],
            cards: [{ cardId: "lions", cardName: "Savannah Lions" }],
        }),
    ];

    it("returns the matching deck when the stored id is present", () => {
        expect(selectPreset(decks, "mono-red-burn")?.presetId).toBe(
            "mono-red-burn"
        );
    });

    it("falls back to null when the stored slug was deleted (no crash)", () => {
        // Admin deleted the preset this selection pointed at — the slug is now
        // absent from the list. The lookup must resolve to no selection, never
        // throw.
        expect(selectPreset(decks, "mono-red-burn")).not.toBeNull();
        const afterDelete = decks.filter((d) => d.presetId !== "mono-red-burn");
        expect(selectPreset(afterDelete, "mono-red-burn")).toBeNull();
    });

    it("returns null for a null stored selection (nothing chosen)", () => {
        expect(selectPreset(decks, null)).toBeNull();
    });

    it("returns null for an unknown id against an empty deck list", () => {
        expect(selectPreset([], "anything")).toBeNull();
    });
});

describe("filterDecksByFormat (issue #513)", () => {
    const decks: { format: FormatId; name: string }[] = [
        { format: "freeform", name: "A" },
        { format: "alpha-40", name: "B" },
        { format: "alpha-40", name: "C" },
        { format: "old-school", name: "D" },
    ];

    it("'all' is the identity — returns every deck", () => {
        expect(filterDecksByFormat(decks, "all")).toHaveLength(decks.length);
    });

    it("narrows the list to decks of the chosen Format", () => {
        const alpha = filterDecksByFormat(decks, "alpha-40");
        expect(alpha.map((d) => d.name)).toEqual(["B", "C"]);

        const oldSchool = filterDecksByFormat(decks, "old-school");
        expect(oldSchool.map((d) => d.name)).toEqual(["D"]);
    });

    it("returns an empty list when no deck matches", () => {
        expect(
            filterDecksByFormat(
                [{ format: "freeform", name: "A" }],
                "old-school"
            )
        ).toEqual([]);
    });

    it("does not mutate the input array", () => {
        const input = [...decks];
        filterDecksByFormat(input, "alpha-40");
        expect(input).toHaveLength(decks.length);
    });
});
