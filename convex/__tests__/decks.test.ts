import { describe, it, expect } from "vitest";
import {
    slugify,
    presetToInsert,
    presetsToSeed,
    presetRowToLobby,
    sortLobbyPresets,
    type LobbyPreset,
} from "../decks";
import { PRESET_DECKS, type DeckPreset } from "../deckPresets";
import type { Doc } from "../_generated/dataModel";

describe("slugify (PRD #466, ADR 0033)", () => {
    it("lowercases and replaces spaces with hyphens", () => {
        expect(slugify("Mono Red Burn")).toBe("mono-red-burn");
    });

    it("strips non-alphanumeric characters", () => {
        expect(slugify("RG Channel Fireball!")).toBe("rg-channel-fireball");
        expect(slugify("Mishra's Workshop")).toBe("mishras-workshop");
    });

    it("collapses runs of whitespace/hyphens to a single hyphen", () => {
        expect(slugify("Foo   Bar")).toBe("foo-bar");
        expect(slugify("Foo -- Bar")).toBe("foo-bar");
    });

    it("trims leading and trailing separators", () => {
        expect(slugify("  Hello World  ")).toBe("hello-world");
        expect(slugify("--edge--")).toBe("edge");
    });

    it("is deterministic and idempotent on an existing slug", () => {
        const slug = slugify("White Weenie");
        expect(slugify(slug)).toBe(slug);
    });
});

describe("presetToInsert", () => {
    it("uses the preset's stable presetId as the slug verbatim", () => {
        const preset = PRESET_DECKS[0];
        const row = presetToInsert(preset);
        expect(row.slug).toBe(preset.presetId);
        expect(row.name).toBe(preset.name);
        expect(row.cards).toEqual(preset.cards);
    });

    it("carries the sideboard through (or leaves it absent)", () => {
        const withSb: DeckPreset = {
            presetId: "demo",
            name: "Demo",
            format: "Freeform",
            description: "",
            colors: ["R"],
            cards: [{ cardId: "x", cardName: "X" }],
            sideboard: [{ cardId: "y", cardName: "Y" }],
        };
        expect(presetToInsert(withSb).sideboard).toEqual([
            { cardId: "y", cardName: "Y" },
        ]);
        const noSb = { ...withSb, sideboard: undefined };
        expect(presetToInsert(noSb).sideboard).toBeUndefined();
    });
});

describe("presetsToSeed — insert-if-absent (idempotent)", () => {
    it("inserts every preset when the table is empty", () => {
        const toSeed = presetsToSeed(PRESET_DECKS, new Set());
        expect(toSeed.length).toBe(PRESET_DECKS.length);
        expect(toSeed.map((r) => r.slug).sort()).toEqual(
            PRESET_DECKS.map((p) => p.presetId).sort()
        );
    });

    it("skips slugs that already exist", () => {
        const existing = new Set([PRESET_DECKS[0].presetId]);
        const toSeed = presetsToSeed(PRESET_DECKS, existing);
        expect(toSeed.length).toBe(PRESET_DECKS.length - 1);
        expect(toSeed.some((r) => r.slug === PRESET_DECKS[0].presetId)).toBe(
            false
        );
    });

    it("inserts nothing when all slugs already exist (re-run is a no-op)", () => {
        const allSlugs = new Set(PRESET_DECKS.map((p) => p.presetId));
        expect(presetsToSeed(PRESET_DECKS, allSlugs)).toEqual([]);
    });
});

describe("presetRowToLobby — wire shape", () => {
    const row: Doc<"presetDecks"> = {
        _id: "row1" as Doc<"presetDecks">["_id"],
        _creationTime: 0,
        slug: "mono-red-burn",
        name: "Mono Red Burn",
        format: "Freeform",
        description: "Fast.",
        colors: ["R"],
        cards: [{ cardId: "a", cardName: "A" }],
        sideboard: [{ cardId: "b", cardName: "B" }],
    };

    it("exposes the slug as the public presetId (unchanged wire format)", () => {
        const lobby = presetRowToLobby(row);
        expect(lobby.presetId).toBe("mono-red-burn");
        expect(lobby.name).toBe("Mono Red Burn");
        expect(lobby.cards).toEqual([{ cardId: "a", cardName: "A" }]);
        expect(lobby.sideboard).toEqual([{ cardId: "b", cardName: "B" }]);
    });

    it("defaults a missing description to an empty string", () => {
        const lobby = presetRowToLobby({ ...row, description: undefined });
        expect(lobby.description).toBe("");
    });
});

describe("sortLobbyPresets", () => {
    it("orders presets by slug ascending", () => {
        const unsorted: LobbyPreset[] = [
            { presetId: "zeta" } as LobbyPreset,
            { presetId: "alpha" } as LobbyPreset,
            { presetId: "mono-red-burn" } as LobbyPreset,
        ];
        expect(sortLobbyPresets(unsorted).map((p) => p.presetId)).toEqual([
            "alpha",
            "mono-red-burn",
            "zeta",
        ]);
    });

    it("does not mutate the input array", () => {
        const input: LobbyPreset[] = [
            { presetId: "b" } as LobbyPreset,
            { presetId: "a" } as LobbyPreset,
        ];
        sortLobbyPresets(input);
        expect(input.map((p) => p.presetId)).toEqual(["b", "a"]);
    });
});
