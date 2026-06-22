// Deck editor save dispatch (PRD #466, ADR 0033). The editor shares one save
// path between user decks and admin presets; this verifies the PURE dispatch
// maps `kind` + identity to the right mutation pair and that a preset rename
// can't change its slug.
import { describe, it, expect, vi } from "vitest";
import {
    dispatchDeckSave,
    saveUserDeck,
    savePreset,
    type DeckBuilderSinks,
    type DeckSavePayload,
} from "../deckBuilderDispatch";

const payload: DeckSavePayload = {
    name: "Deck",
    format: "Freeform",
    colors: ["R"],
    cards: [{ cardId: "bolt", cardName: "Lightning Bolt" }],
    sideboard: [],
};

function makeSinks() {
    const userCreate = vi.fn(async () => "newDeckId");
    const userUpdate = vi.fn(async () => {});
    const presetUpdate = vi.fn(async () => {});
    const sinks: DeckBuilderSinks = {
        user: { create: userCreate, update: userUpdate },
        preset: { update: presetUpdate },
    };
    return { sinks, userCreate, userUpdate, presetUpdate };
}

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

describe("dispatchDeckSave", () => {
    it("routes kind:user to the user sink", async () => {
        const { sinks, userCreate } = makeSinks();
        const save = dispatchDeckSave("user", sinks, null);
        await save(payload);
        expect(userCreate).toHaveBeenCalledTimes(1);
    });

    it("routes kind:preset to the preset sink by slug", async () => {
        const { sinks, presetUpdate } = makeSinks();
        const save = dispatchDeckSave("preset", sinks, "white-weenie");
        const id = await save(payload);
        expect(id).toBe("white-weenie");
        expect(presetUpdate).toHaveBeenCalledWith("white-weenie", payload);
    });

    it("throws for a preset with no slug (edit-only in this slice)", () => {
        const { sinks } = makeSinks();
        expect(() => dispatchDeckSave("preset", sinks, null)).toThrow();
    });
});
