// Lobby deck transforms: a userDecks Doc → UserLobbyDeck, and a preset →
// PresetLobbyDeck. The key contract for issue #391 is backward compatibility —
// a deck saved before sideboarding (no `sideboard` field) must load as an
// empty Sideboard, not crash.
import { describe, it, expect } from "vitest";
import type { Doc } from "@convex/_generated/dataModel";
import type { DeckPreset } from "@convex/deckPresets";
import { toUserLobbyDeck, toPresetLobbyDeck } from "../deckTypes";

function userDeck(overrides: Partial<Doc<"userDecks">> = {}): Doc<"userDecks"> {
    return {
        _id: "deck_1" as Doc<"userDecks">["_id"],
        _creationTime: 0,
        userId: "user_1" as Doc<"userDecks">["userId"],
        name: "My Deck",
        format: "Freeform",
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
        format: "Freeform",
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
