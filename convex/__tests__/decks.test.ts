import { describe, it, expect } from "vitest";
import {
    slugify,
    presetToInsert,
    presetsToSeed,
    presetRowToLobby,
    sortLobbyPresets,
    buildPresetPatch,
    buildNewPresetRow,
    resolveFeaturedCardId,
    type LobbyPreset,
} from "../decks";
import { PRESET_DECKS, type DeckPreset } from "../deckPresets";
import { isAdminUser } from "../auth";
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

describe("resolveFeaturedCardId (PRD #589, issue #593)", () => {
    const cards = [
        { cardId: "bolt", cardName: "Lightning Bolt" },
        { cardId: "shock", cardName: "Shock" },
    ];

    it("an in-deck override wins over the default", () => {
        expect(resolveFeaturedCardId({ featuredCardId: "shock", cards })).toBe(
            "shock"
        );
    });

    it("defaults to the first inserted Maindeck card when absent", () => {
        expect(resolveFeaturedCardId({ cards })).toBe("bolt");
    });

    it("resolves an empty deck to null", () => {
        expect(resolveFeaturedCardId({ cards: [] })).toBeNull();
        expect(
            resolveFeaturedCardId({ featuredCardId: "bolt", cards: [] })
        ).toBeNull();
    });

    it("falls back to the first card when the override is no longer in the deck", () => {
        // The featured card was removed from the Maindeck — the dangling
        // override self-heals to the default rather than pointing at nothing.
        expect(
            resolveFeaturedCardId({ featuredCardId: "removed", cards })
        ).toBe("bolt");
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
            format: "freeform",
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
        format: "freeform",
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

    it("resolves the Featured Card to the first card when absent (PRD #589)", () => {
        // The seeded/legacy row has no `featuredCardId`; the wire surfaces the
        // first-card default so the lobby can render deck art with no migration.
        const lobby = presetRowToLobby({ ...row, featuredCardId: undefined });
        expect(lobby.featuredCardId).toBe("a");
    });

    it("surfaces an in-deck Featured Card override on the wire (PRD #589)", () => {
        const lobby = presetRowToLobby({ ...row, featuredCardId: "a" });
        expect(lobby.featuredCardId).toBe("a");
    });

    it("self-heals a dangling Featured Card override to the first card", () => {
        const lobby = presetRowToLobby({ ...row, featuredCardId: "gone" });
        expect(lobby.featuredCardId).toBe("a");
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

    it("persists an explicit Featured Card override (PRD #589, issue #593)", () => {
        const patch = buildPresetPatch({ featuredCardId: "bolt" });
        expect(patch.featuredCardId).toBe("bolt");
        expect(Object.keys(patch)).toEqual(["featuredCardId"]);
    });

    it("leaves the Featured Card untouched when absent from the patch", () => {
        const patch = buildPresetPatch({ name: "Renamed" });
        expect("featuredCardId" in patch).toBe(false);
    });
});

describe("buildNewPresetRow — admin create (issue #469)", () => {
    it("derives the slug from the name via slugify", () => {
        const row = buildNewPresetRow({ name: "My Fresh Brew" });
        expect(row.slug).toBe("my-fresh-brew");
        expect(row.name).toBe("My Fresh Brew");
        expect(slugify(row.name)).toBe(row.slug);
    });

    it("strips punctuation when slugging the name", () => {
        const row = buildNewPresetRow({ name: "RG Channel Fireball!" });
        expect(row.slug).toBe("rg-channel-fireball");
    });

    it("falls back to a default name (and its slug) when blank", () => {
        const row = buildNewPresetRow({ name: "   " });
        expect(row.name).toBe("Untitled preset");
        expect(row.slug).toBe("untitled-preset");
    });

    it("defaults format/colors/cards and omits an absent sideboard", () => {
        const row = buildNewPresetRow({ name: "Empty Deck" });
        expect(row.format).toBe("freeform");
        expect(row.colors).toEqual([]);
        expect(row.cards).toEqual([]);
        expect(row.sideboard).toBeUndefined();
    });

    it("carries a Featured Card override through (PRD #589, issue #593)", () => {
        const row = buildNewPresetRow({
            name: "Featured Deck",
            cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
            featuredCardId: "bolt",
        });
        expect(row.featuredCardId).toBe("bolt");
    });

    it("leaves the Featured Card absent when not provided (round-trips undefined)", () => {
        const row = buildNewPresetRow({ name: "No Featured" });
        expect(row.featuredCardId).toBeUndefined();
        // An absent override resolves to the first-card default on read.
        const lobby = presetRowToLobby({
            _id: "row1" as Doc<"presetDecks">["_id"],
            _creationTime: 0,
            ...row,
            cards: [{ cardId: "first", cardName: "First" }],
        });
        expect(lobby.featuredCardId).toBe("first");
    });

    it("carries the full payload through (cards, colors, sideboard)", () => {
        const row = buildNewPresetRow({
            name: "Loaded",
            format: "old-school",
            colors: ["R", "G"],
            cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
            sideboard: [{ cardId: "smash", cardName: "Smash" }],
            description: "A test deck.",
        });
        expect(row.format).toBe("old-school");
        expect(row.colors).toEqual(["R", "G"]);
        expect(row.cards).toEqual([
            { cardId: "bolt", cardName: "Lightning Bolt" },
        ]);
        expect(row.sideboard).toEqual([{ cardId: "smash", cardName: "Smash" }]);
        expect(row.description).toBe("A test deck.");
    });

    it("produces a row whose lobby projection matches list's wire shape", () => {
        // The mutation inserts this row verbatim; `list` projects it via
        // `presetRowToLobby`. Assert the round-trip exposes the slug as the
        // public presetId, so a newly created preset appears correctly for
        // every user (no convex-test harness — assert the produced shapes).
        const row = buildNewPresetRow({
            name: "Mono White Aggro",
            colors: ["W"],
            cards: [{ cardId: "savannah", cardName: "Savannah Lions" }],
        });
        const lobby = presetRowToLobby({
            _id: "row1" as Doc<"presetDecks">["_id"],
            _creationTime: 0,
            ...row,
        });
        expect(lobby.presetId).toBe("mono-white-aggro");
        expect(lobby.name).toBe("Mono White Aggro");
        expect(lobby.cards).toEqual([
            { cardId: "savannah", cardName: "Savannah Lions" },
        ]);
    });
});

describe("createPreset — slug uniqueness (issue #469)", () => {
    // The mutation builds the row, then rejects if the derived slug already
    // exists in `presetDecks`. No convex-test harness — model the same pure
    // collision decision the mutation makes against the existing slug set.
    function collides(
        name: string,
        existingSlugs: ReadonlySet<string>
    ): boolean {
        return existingSlugs.has(buildNewPresetRow({ name }).slug);
    }

    it("rejects a name whose slug collides with an existing preset", () => {
        const existing = new Set(PRESET_DECKS.map((p) => p.presetId));
        // "Mono Red Burn" → mono-red-burn, an existing preset slug.
        expect(collides("Mono Red Burn", existing)).toBe(true);
    });

    it("rejects a differently-cased/punctuated name that slugs to a taken slug", () => {
        const existing = new Set(["mono-red-burn"]);
        expect(collides("  Mono   Red   Burn!  ", existing)).toBe(true);
    });

    it("accepts a name whose slug is free", () => {
        const existing = new Set(PRESET_DECKS.map((p) => p.presetId));
        expect(collides("Totally New Brew", existing)).toBe(false);
    });
});

describe("deletePreset — admin gate + hard delete by slug (issue #470)", () => {
    // The mutation calls `assertIsAdmin` FIRST, then looks the row up by slug
    // and hard-deletes it. No convex-test harness — assert the same two pure
    // decisions the mutation is built from: the admin gate (`isAdminUser`, which
    // `assertIsAdmin` wraps) and which rows survive the delete.
    function admin(isAdmin?: boolean): Doc<"users"> {
        return {
            _id: "u1" as Doc<"users">["_id"],
            _creationTime: 0,
            isAdmin,
        } as Doc<"users">;
    }

    // Model `ctx.db.delete(row._id)` keyed by the `by_slug` lookup: keep every
    // row whose slug differs from the target. An absent slug deletes nothing.
    function deleteBySlug(
        rows: Doc<"presetDecks">[],
        slug: string
    ): Doc<"presetDecks">[] {
        return rows.filter((r) => r.slug !== slug);
    }

    const rows: Doc<"presetDecks">[] = PRESET_DECKS.map((p, i) => ({
        _id: `row${i}` as Doc<"presetDecks">["_id"],
        _creationTime: 0,
        slug: p.presetId,
        name: p.name,
        format: p.format,
        description: p.description,
        colors: p.colors,
        cards: p.cards,
        sideboard: p.sideboard,
    }));

    it("rejects a non-admin (assertIsAdmin gate runs first)", () => {
        expect(isAdminUser(admin(false))).toBe(false);
        expect(isAdminUser(admin(undefined))).toBe(false);
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin through the gate", () => {
        expect(isAdminUser(admin(true))).toBe(true);
    });

    it("removes exactly the row matching the slug", () => {
        const target = PRESET_DECKS[0].presetId;
        const after = deleteBySlug(rows, target);
        expect(after).toHaveLength(rows.length - 1);
        expect(after.some((r) => r.slug === target)).toBe(false);
        // every other preset is untouched
        expect(after.map((r) => r.slug).sort()).toEqual(
            PRESET_DECKS.slice(1)
                .map((p) => p.presetId)
                .sort()
        );
    });

    it("is a no-op for an absent slug (idempotent re-delete)", () => {
        const after = deleteBySlug(rows, "no-such-preset");
        expect(after).toHaveLength(rows.length);
    });

    it("drops the deleted slug from the lobby list projection", () => {
        const target = PRESET_DECKS[0].presetId;
        const after = deleteBySlug(rows, target);
        const listed = sortLobbyPresets(after.map(presetRowToLobby));
        expect(listed.some((d) => d.presetId === target)).toBe(false);
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
        format: "freeform",
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
