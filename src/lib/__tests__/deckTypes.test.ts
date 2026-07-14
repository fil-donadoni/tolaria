// Lobby deck transforms: a userDecks Doc → UserLobbyDeck, and a preset →
// PresetLobbyDeck. The key contract for issue #391 is backward compatibility —
// a deck saved before sideboarding (no `sideboard` field) must load as an
// empty Sideboard, not crash.
import { describe, it, expect } from "vitest";
import type { Doc } from "@convex/_generated/dataModel";
import type { DeckPreset } from "@convex/deckPresets";
import type { Reason } from "@convex/formats";
import {
    toUserLobbyDeck,
    toPresetLobbyDeck,
    selectPreset,
    filterDecksByFormat,
} from "../deckTypes";
import type { FormatId } from "@convex/formats";

// `isLegal`/`reasons` aren't part of the `userDecks` schema — they're only
// ever attached server-side by `userDecks.listMine` for a `limited` deck
// (issue #1111), mirroring `PresetSource`'s same optional override.
type UserDeckFixture = Partial<Doc<"userDecks">> & {
    isLegal?: boolean;
    reasons?: Reason[];
};

function userDeck(overrides: UserDeckFixture = {}): Doc<"userDecks"> & {
    isLegal?: boolean;
    reasons?: Reason[];
} {
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
            // 4 Bolt respects the 4-copy limit (#516); Mountain is a basic and
            // therefore unlimited, padding the deck to the 60-card minimum.
            ...Array.from({ length: 4 }, () => ({
                cardId: BOLT_LEA,
                cardName: "Lightning Bolt",
            })),
            ...Array.from({ length: 56 }, () => ({
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

    it("a bare limited user deck (no server-attached legality) reads pool-unresolved, never a silent pass", () => {
        // A `limited` deck's Pool lives on its Limited Event Seat, not the
        // deck row (issue #1111) — without `userDecks.listMine` attaching
        // server-resolved legality, the client has no way to derive a
        // `ResolvePool` on its own.
        const deck = toUserLobbyDeck(
            userDeck({
                format: "limited",
                limitedEventId: "event1",
                limitedSeatId: "0",
            })
        );
        expect(deck.isLegal).toBe(false);
        expect(deck.reasons.some((r) => r.code === "pool-unresolved")).toBe(
            true
        );
        expect(deck.limitedEventId).toBe("event1");
        expect(deck.limitedSeatId).toBe("0");
    });

    it("a limited user deck passes through server-derived legality when present (issue #1111)", () => {
        const deck = toUserLobbyDeck(
            userDeck({
                format: "limited",
                limitedEventId: "event1",
                limitedSeatId: "0",
                isLegal: true,
                reasons: [],
            })
        );
        expect(deck.isLegal).toBe(true);
        expect(deck.reasons).toEqual([]);
    });
});

describe("Featured Card on lobby decks (PRD #589, issue #593)", () => {
    it("resolves a user deck's absent override to the first Maindeck card", () => {
        const deck = toUserLobbyDeck(
            userDeck({
                cards: [
                    { cardId: "bolt", cardName: "Lightning Bolt" },
                    { cardId: "shock", cardName: "Shock" },
                ],
            })
        );
        expect(deck.featuredCardId).toBe("bolt");
    });

    it("surfaces a user deck's in-deck Featured Card override", () => {
        const deck = toUserLobbyDeck(
            userDeck({
                cards: [
                    { cardId: "bolt", cardName: "Lightning Bolt" },
                    { cardId: "shock", cardName: "Shock" },
                ],
                featuredCardId: "shock",
            })
        );
        expect(deck.featuredCardId).toBe("shock");
    });

    it("self-heals a user deck's dangling override to the first card", () => {
        const deck = toUserLobbyDeck(
            userDeck({
                cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
                featuredCardId: "removed",
            })
        );
        expect(deck.featuredCardId).toBe("bolt");
    });

    it("resolves an empty user deck's Featured Card to null", () => {
        const deck = toUserLobbyDeck(userDeck({ cards: [] }));
        expect(deck.featuredCardId).toBeNull();
    });

    it("prefers the server-resolved Featured Card on a preset (wire)", () => {
        // The lobby query resolves featuredCardId server-side; the client must
        // trust it rather than re-resolve.
        const deck = toPresetLobbyDeck({
            presetId: "p",
            name: "Server-featured",
            format: "freeform",
            description: "",
            colors: ["R"],
            cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
            featuredCardId: "bolt",
        });
        expect(deck.featuredCardId).toBe("bolt");
    });

    it("resolves a bare in-code preset's Featured Card client-side", () => {
        const deck = toPresetLobbyDeck({
            presetId: "p2",
            name: "Bare Preset",
            format: "freeform",
            description: "",
            colors: ["W"],
            cards: [{ cardId: "lions", cardName: "Savannah Lions" }],
        });
        expect(deck.featuredCardId).toBe("lions");
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
