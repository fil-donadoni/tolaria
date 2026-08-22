import { describe, it, expect } from "vitest";
import { PRESET_DECKS } from "../deckPresets";
import {
    presetToInsert,
    presetsToSeed,
    presetRowToLobby,
    sortLobbyPresets,
} from "../decks";
import { getDefinition } from "../cards";
import type { Doc } from "../_generated/dataModel";

// `deckPresets.ts` is now seed data only (PRD #466, ADR 0033). These tests
// validate the seed source itself AND the DB-backed `api.decks.list` pipeline
// it feeds — the pure helpers `list` composes (seed → rows → wire shape →
// sorted). The project has no convex-test harness, so we drive those helpers
// directly rather than the `query`/`internalMutation` wrappers.

describe("PRESET_DECKS (seed source)", () => {
    it.each(PRESET_DECKS.map((d) => [d.name, d]))(
        "%s has at least 40 cards",
        (_name, deck) => {
            // Casual presets are 40; constructed-style presets (e.g. Robots)
            // may run larger. A deck must meet the 40-card minimum.
            expect(deck.cards.length).toBeGreaterThanOrEqual(40);
        }
    );

    it.each(PRESET_DECKS.map((d) => [d.name, d]))(
        "%s only contains cards present in the registry",
        (_name, deck) => {
            for (const { cardId } of deck.cards) {
                expect(() => getDefinition(cardId)).not.toThrow();
            }
        }
    );

    it.each(PRESET_DECKS.map((d) => [d.name, d]))(
        "%s cardName matches the registry name",
        (_name, deck) => {
            for (const { cardId, cardName } of deck.cards) {
                expect(getDefinition(cardId).name).toBe(cardName);
            }
        }
    );
});

// Simulate the DB `presetDecks` table by seeding into rows, then run the same
// pipeline `api.decks.list` runs over those rows.
function seededRows(): Doc<"presetDecks">[] {
    return presetsToSeed(PRESET_DECKS, new Set()).map((insert, i) => ({
        ...insert,
        _id: `seed-${i}` as Doc<"presetDecks">["_id"],
        _creationTime: i,
    }));
}

describe("DB-backed api.decks.list", () => {
    it("lists every seeded preset", () => {
        const list = sortLobbyPresets(
            seededRows().map((r) => presetRowToLobby(r))
        );
        expect(list.length).toBe(PRESET_DECKS.length);
        expect(list.map((d) => d.presetId).sort()).toEqual(
            PRESET_DECKS.map((p) => p.presetId).sort()
        );
    });

    it("keeps the slug as the public deck id (unchanged wire format)", () => {
        const list = sortLobbyPresets(
            seededRows().map((r) => presetRowToLobby(r))
        );
        for (const preset of PRESET_DECKS) {
            const lobby = list.find((d) => d.presetId === preset.presetId);
            expect(lobby).toBeDefined();
            expect(lobby!.name).toBe(preset.name);
            expect(lobby!.colors).toEqual(preset.colors);
            expect(lobby!.cards).toEqual(preset.cards);
        }
    });

    it("returns presets sorted by slug", () => {
        const list = sortLobbyPresets(
            seededRows().map((r) => presetRowToLobby(r))
        );
        const slugs = list.map((d) => d.presetId);
        expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b)));
    });

    it("preserves each preset's slug verbatim through the seed", () => {
        for (const preset of PRESET_DECKS) {
            expect(presetToInsert(preset).slug).toBe(preset.presetId);
        }
    });
});
