// Deck editor save dispatch (PRD #466, ADR 0033). The editor shares one save
// path between user decks and admin presets; this verifies the PURE dispatch
// maps `kind` + identity to the right mutation pair and that a preset rename
// can't change its slug.
import { describe, it, expect, vi } from "vitest";
import {
    dispatchDeckSave,
    saveUserDeck,
    savePreset,
    savePresetCreate,
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
