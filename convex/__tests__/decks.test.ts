import { describe, it, expect } from "vitest";
import {
    slugify,
    presetToInsert,
    presetsToSeed,
    presetRowToLobby,
    sortLobbyPresets,
    buildPresetPatch,
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

describe("buildPresetPatch — slug is read-only (ADR 0033)", () => {
    it("never includes a slug key, even when the name changes", () => {
        const patch = buildPresetPatch({ name: "Totally Renamed Deck" });
        expect("slug" in patch).toBe(false);
        expect(patch.name).toBe("Totally Renamed Deck");
    });

    it("a rename to a name with a different slugify result still omits slug", () => {
        // Renaming "Mono Red Burn" → "Big Blue Control" would slugify to a
        // different value; the patch must NOT carry it — identity is immutable.
        const renamed = "Big Blue Control";
        expect(slugify(renamed)).toBe("big-blue-control");
        const patch = buildPresetPatch({ name: renamed });
        expect(patch).not.toHaveProperty("slug");
    });

    it("falls back to a default name when blank", () => {
        expect(buildPresetPatch({ name: "   " }).name).toBe("Untitled preset");
    });

    it("only patches the fields present in the input", () => {
        const patch = buildPresetPatch({
            cards: [{ cardId: "a", cardName: "A" }],
        });
        expect(Object.keys(patch)).toEqual(["cards"]);
    });

    it("carries an explicit sideboard through (preset edit can include one)", () => {
        const sb = [{ cardId: "s", cardName: "S" }];
        expect(buildPresetPatch({ sideboard: sb }).sideboard).toEqual(sb);
    });

    it("yields an empty patch for an empty input (caller skips the write)", () => {
        expect(buildPresetPatch({})).toEqual({});
    });
});

describe("preset edit round-trip — getPreset → editor → list (ADR 0033)", () => {
    // Integration at the pure-helper / projection level (no convex-test
    // harness). Assert the data shapes the query/mutation produce flow end to
    // end: a stored row projects to the editor wire shape, an admin edit
    // patches the row, and the edited row re-projects into the lobby list.
    const stored: Doc<"presetDecks"> = {
        _id: "row1" as Doc<"presetDecks">["_id"],
        _creationTime: 0,
        slug: "mono-red-burn",
        name: "Mono Red Burn",
        format: "Freeform",
        description: "Fast aggro.",
        colors: ["R"],
        cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
        sideboard: [{ cardId: "smash", cardName: "Smash to Smithereens" }],
    };

    it("getPreset's wire shape feeds the editor with the slug as presetId", () => {
        const editorInput = presetRowToLobby(stored);
        expect(editorInput.presetId).toBe("mono-red-burn");
        expect(editorInput.name).toBe("Mono Red Burn");
        expect(editorInput.sideboard).toEqual(stored.sideboard);
    });

    it("an admin edit patches the row but preserves slug, then re-lists", () => {
        const patch = buildPresetPatch({
            name: "Mono Red Aggro",
            cards: [
                { cardId: "bolt", cardName: "Lightning Bolt" },
                { cardId: "shock", cardName: "Shock" },
            ],
        });
        // Simulate ctx.db.patch: merge the patch into the stored row. The slug
        // is untouched because the patch never carries it.
        const edited: Doc<"presetDecks"> = { ...stored, ...patch };
        expect(edited.slug).toBe("mono-red-burn"); // identity survives rename
        expect(edited.name).toBe("Mono Red Aggro");

        // The edited row re-projects into the lobby deck list unchanged in
        // identity, with the new name/cards visible to every client.
        const listed = sortLobbyPresets([presetRowToLobby(edited)]);
        expect(listed[0].presetId).toBe("mono-red-burn");
        expect(listed[0].name).toBe("Mono Red Aggro");
        expect(listed[0].cards).toHaveLength(2);
    });
});
