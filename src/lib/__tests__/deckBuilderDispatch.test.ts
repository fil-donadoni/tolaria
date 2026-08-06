// Deck editor save dispatch (PRD #466, ADR 0033). The editor shares one save
// path between user decks and admin presets; this verifies the PURE dispatch
// maps `kind` + identity to the right mutation pair and that a preset rename
// can't change its slug.
import { describe, it, expect, vi } from "vitest";
import {
    buildDeckBuilderSinks,
    dispatchDeckSave,
    saveUserDeck,
    savePreset,
    savePresetCreate,
    toPresetPayload,
    toUpdatePatch,
    type DeckBuilderSinks,
    type DeckSavePayload,
} from "../deckBuilderDispatch";

const payload: DeckSavePayload = {
    name: "Deck",
    format: "freeform",
    colors: ["R"],
    cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
    sideboard: [],
};

function makeSinks() {
    const userCreate = vi.fn(async () => "newDeckId");
    const userUpdate = vi.fn(async () => {});
    const presetCreate = vi.fn(async () => "derived-slug");
    const presetUpdate = vi.fn(async () => {});
    const sinks: DeckBuilderSinks = {
        user: { create: userCreate, update: userUpdate },
        preset: { create: presetCreate, update: presetUpdate },
    };
    return { sinks, userCreate, userUpdate, presetCreate, presetUpdate };
}

describe("toUpdatePatch — format is immutable on update (ADR 0036)", () => {
    it("drops the format from the update patch", () => {
        const patch = toUpdatePatch(payload);
        expect("format" in patch).toBe(false);
    });

    it("preserves every other editable field", () => {
        const patch = toUpdatePatch(payload);
        expect(patch.name).toBe(payload.name);
        expect(patch.colors).toEqual(payload.colors);
        expect(patch.cards).toEqual(payload.cards);
        expect(patch.sideboard).toEqual(payload.sideboard);
    });

    it("carries the Featured Card through the update patch (PRD #589, issue #599)", () => {
        const patch = toUpdatePatch({ ...payload, featuredCardId: "bolt" });
        expect(patch.featuredCardId).toBe("bolt");
    });

    it("leaves the Featured Card undefined when none is picked", () => {
        // An absent override must reach the mutation as `undefined` so the
        // server's `if (featuredCardId !== undefined)` guard leaves the stored
        // value untouched (no accidental clear).
        const patch = toUpdatePatch(payload);
        expect(patch.featuredCardId).toBeUndefined();
    });
});

describe("saveUserDeck", () => {
    it("creates on first save (null id) and returns the new id", async () => {
        const { sinks, userCreate, userUpdate } = makeSinks();
        const id = await saveUserDeck(sinks.user, null, payload);
        expect(id).toBe("newDeckId");
        expect(userCreate).toHaveBeenCalledTimes(1);
        expect(userUpdate).not.toHaveBeenCalled();
    });

    it("updates by id once created and returns the same id", async () => {
        const { sinks, userCreate, userUpdate } = makeSinks();
        const id = await saveUserDeck(sinks.user, "deck42", payload);
        expect(id).toBe("deck42");
        expect(userUpdate).toHaveBeenCalledWith("deck42", payload);
        expect(userCreate).not.toHaveBeenCalled();
    });
});

describe("savePreset", () => {
    it("updates by slug and returns the unchanged slug", async () => {
        const { sinks, presetUpdate } = makeSinks();
        const slug = await savePreset(sinks.preset, "mono-red-burn", payload);
        expect(slug).toBe("mono-red-burn");
        expect(presetUpdate).toHaveBeenCalledWith("mono-red-burn", payload);
    });

    it("never derives a new slug from a renamed name", async () => {
        const { sinks, presetUpdate } = makeSinks();
        const renamed: DeckSavePayload = { ...payload, name: "Brand New Name" };
        const slug = await savePreset(sinks.preset, "mono-red-burn", renamed);
        expect(slug).toBe("mono-red-burn");
        // The slug passed to the mutation is the original, not slug(name).
        expect(presetUpdate).toHaveBeenCalledWith("mono-red-burn", renamed);
    });
});

describe("savePresetCreate (issue #469)", () => {
    it("creates on first save (null slug) and returns the server-derived slug", async () => {
        const { sinks, presetCreate, presetUpdate } = makeSinks();
        const slug = await savePresetCreate(sinks.preset, null, payload);
        expect(slug).toBe("derived-slug");
        expect(presetCreate).toHaveBeenCalledTimes(1);
        expect(presetCreate).toHaveBeenCalledWith(payload);
        expect(presetUpdate).not.toHaveBeenCalled();
    });

    it("patches by the derived slug on subsequent saves", async () => {
        const { sinks, presetCreate, presetUpdate } = makeSinks();
        const renamed: DeckSavePayload = { ...payload, name: "Renamed" };
        const slug = await savePresetCreate(
            sinks.preset,
            "derived-slug",
            renamed
        );
        expect(slug).toBe("derived-slug");
        expect(presetUpdate).toHaveBeenCalledWith("derived-slug", renamed);
        expect(presetCreate).not.toHaveBeenCalled();
    });
});

describe("dispatchDeckSave", () => {
    it("routes kind:user to the user sink", async () => {
        const { sinks, userCreate } = makeSinks();
        const save = dispatchDeckSave("user", sinks, null);
        await save(payload);
        expect(userCreate).toHaveBeenCalledTimes(1);
    });

    it("routes kind:preset edit to the preset update sink by slug", async () => {
        const { sinks, presetUpdate } = makeSinks();
        const save = dispatchDeckSave("preset", sinks, "white-weenie", "edit");
        const id = await save(payload);
        expect(id).toBe("white-weenie");
        expect(presetUpdate).toHaveBeenCalledWith("white-weenie", payload);
    });

    it("throws for a preset edit with no slug (edit requires an existing preset)", () => {
        const { sinks } = makeSinks();
        expect(() => dispatchDeckSave("preset", sinks, null, "edit")).toThrow();
    });

    it("defaults to edit mode (back-compat) and throws on a null preset slug", () => {
        const { sinks } = makeSinks();
        expect(() => dispatchDeckSave("preset", sinks, null)).toThrow();
    });

    it("routes kind:preset create with a null slug to createPreset", async () => {
        const { sinks, presetCreate } = makeSinks();
        const save = dispatchDeckSave("preset", sinks, null, "create");
        const slug = await save(payload);
        expect(slug).toBe("derived-slug");
        expect(presetCreate).toHaveBeenCalledWith(payload);
    });

    it("routes kind:preset create with an existing slug to update", async () => {
        const { sinks, presetUpdate, presetCreate } = makeSinks();
        const save = dispatchDeckSave(
            "preset",
            sinks,
            "derived-slug",
            "create"
        );
        await save(payload);
        expect(presetUpdate).toHaveBeenCalledWith("derived-slug", payload);
        expect(presetCreate).not.toHaveBeenCalled();
    });
});

describe("Featured Card picker → update path (PRD #589, issue #599)", () => {
    const featured: DeckSavePayload = { ...payload, featuredCardId: "bolt" };

    it("flows the featured pick to the USER deck update sink", async () => {
        const { sinks, userUpdate } = makeSinks();
        const save = dispatchDeckSave("user", sinks, "deck42");
        await save(featured);
        expect(userUpdate).toHaveBeenCalledWith("deck42", featured);
        expect(userUpdate).toHaveBeenCalledWith(
            "deck42",
            expect.objectContaining({ featuredCardId: "bolt" })
        );
    });

    it("flows the featured pick to the PRESET update sink by slug (admin path)", async () => {
        const { sinks, presetUpdate } = makeSinks();
        const save = dispatchDeckSave("preset", sinks, "mono-red-burn", "edit");
        await save(featured);
        expect(presetUpdate).toHaveBeenCalledWith("mono-red-burn", featured);
        expect(presetUpdate).toHaveBeenCalledWith(
            "mono-red-burn",
            expect.objectContaining({ featuredCardId: "bolt" })
        );
    });

    it("flows the featured pick on a brand-new USER deck (create path)", async () => {
        const { sinks, userCreate } = makeSinks();
        const save = dispatchDeckSave("user", sinks, null);
        await save(featured);
        expect(userCreate).toHaveBeenCalledWith(
            expect.objectContaining({ featuredCardId: "bolt" })
        );
    });
});

// ── the Column Layout at the save boundary (ADR 0075 §4, issue #1626) ────────

describe("Column Layout on the save path (issue #1626)", () => {
    const layout = {
        maindeck: {
            manualColumns: [{ id: "custom:removal", label: "Removal" }],
            pins: { bolt: { custom: "custom:removal" } },
        },
    };

    it("carries the layout into a USER deck's update patch", () => {
        // `userDecks.update` reads it as the whole arrangement, never a merge.
        expect(toUpdatePatch({ ...payload, layout }).layout).toEqual(layout);
    });

    it("OMITS the key entirely when the arrangement was never touched", () => {
        // Absent means "leave the stored layout alone" — which is what editing
        // a deck saved before this slice must do. An explicit `layout:
        // undefined` key would say the same to Convex today, but says nothing
        // to a reader and would survive a future merge-style patch.
        const patch = toUpdatePatch(payload);
        expect("layout" in patch).toBe(false);
    });

    it("passes an EMPTY layout through — that is how a cleared arrangement is cleared", () => {
        expect(toUpdatePatch({ ...payload, layout: {} }).layout).toEqual({});
    });

    it("strips the layout from every PRESET payload", () => {
        // `presetDecks` declares no `layout` argument, and Convex rejects an
        // argument its validator doesn't know — so the field is dropped at
        // this one boundary rather than guarded at each preset call site.
        const preset = toPresetPayload({ ...payload, layout });
        expect("layout" in preset).toBe(false);
        expect("layout" in toUpdatePatch(preset)).toBe(false);
        // Everything else survives untouched.
        expect(preset.name).toBe(payload.name);
        expect(preset.cards).toEqual(payload.cards);
    });
});

// The SINK CONSTRUCTION itself (PR #2318 review NB2). `toUpdatePatch` and
// `toPresetPayload` were unit-tested above, but until this slice nothing
// asserted that the four production sinks actually CALL them: the only caller
// was the route's inline `useMemo`, and deleting either call there is a
// runtime `ArgumentValidationError` (Convex rejects an argument its validator
// doesn't declare) with a fully green suite.
describe("buildDeckBuilderSinks (issue #1626, review NB2)", () => {
    const layout = {
        maindeck: { manualColumns: [{ id: "custom:x", label: "X" }] },
    };

    function spies() {
        return {
            createUserDeck: vi.fn().mockResolvedValue("deck-1"),
            updateUserDeck: vi.fn().mockResolvedValue(undefined),
            createPreset: vi.fn().mockResolvedValue({ slug: "the-slug" }),
            updatePreset: vi.fn().mockResolvedValue(undefined),
        };
    }

    it("strips the immutable format from a USER deck's update patch (ADR 0036)", async () => {
        const api = spies();
        await buildDeckBuilderSinks(api).user.update("deck-1", {
            ...payload,
            layout,
        });
        const [id, patch] = api.updateUserDeck.mock.calls[0];
        expect(id).toBe("deck-1");
        expect("format" in patch).toBe(false);
        // …while the Column Layout, which `userDecks` DOES store, survives.
        expect(patch.layout).toEqual(layout);
    });

    it("creates a user deck with the payload untouched", async () => {
        const api = spies();
        const id = await buildDeckBuilderSinks(api).user.create({
            ...payload,
            layout,
        });
        expect(id).toBe("deck-1");
        expect(api.createUserDeck).toHaveBeenCalledWith({ ...payload, layout });
    });

    it("strips the Column Layout from a PRESET create, and returns the server's slug", async () => {
        const api = spies();
        const slug = await buildDeckBuilderSinks(api).preset.create({
            ...payload,
            layout,
        });
        expect(slug).toBe("the-slug");
        expect("layout" in api.createPreset.mock.calls[0][0]).toBe(false);
    });

    it("strips BOTH the layout and the immutable format from a PRESET update", async () => {
        const api = spies();
        await buildDeckBuilderSinks(api).preset.update("the-slug", {
            ...payload,
            layout,
        });
        const [slug, patch] = api.updatePreset.mock.calls[0];
        expect(slug).toBe("the-slug");
        expect("layout" in patch).toBe(false);
        expect("format" in patch).toBe(false);
        expect(patch.cards).toEqual(payload.cards);
    });
});
