// The lobby deck list's second-level Limited Origin filter (issue #2818).
import { describe, expect, it } from "vitest";
import type { LobbyDeck } from "../deckTypes";
import {
    deckOriginOptions,
    deckPassesOrigin,
    effectiveDeckOrigin,
} from "../deckOriginFilter";
import { homeDecks } from "../lobbyHome";

function deck(overrides: Partial<LobbyDeck>): LobbyDeck {
    return {
        kind: "user",
        presetId: "d",
        name: "D",
        format: "limited",
        colors: [],
        cards: [],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

const sealed = deck({ presetId: "a", limitedOrigin: "sealed:lea" });
const sealed2 = deck({ presetId: "b", limitedOrigin: "sealed:lea" });
const cube = deck({ presetId: "c", limitedOrigin: "draft:cube:vintage" });
const orphan = deck({ presetId: "o" });
const constructed = deck({ presetId: "k", format: "premodern" });

describe("deckOriginOptions", () => {
    it("lists each distinct origin of the own Limited decks once, labelled", () => {
        const options = deckOriginOptions([sealed, sealed2, cube, orphan]);
        expect(options.map((o) => o.key).sort()).toEqual([
            "draft:cube:vintage",
            "sealed:lea",
        ]);
        expect(options.every((o) => o.label.length > 0)).toBe(true);
    });

    it("drops an origin once its last deck is gone", () => {
        expect(deckOriginOptions([sealed, cube]).map((o) => o.key)).toContain(
            "draft:cube:vintage"
        );
        expect(deckOriginOptions([sealed]).map((o) => o.key)).toEqual([
            "sealed:lea",
        ]);
    });

    it("is empty without a classified Limited deck, and ignores presets and other Formats", () => {
        expect(deckOriginOptions([orphan, constructed])).toEqual([]);
        const preset = deck({ kind: "preset", limitedOrigin: "sealed:lea" });
        expect(deckOriginOptions([preset])).toEqual([]);
    });
});

describe("effectiveDeckOrigin", () => {
    it("falls back to all for a key no deck carries", () => {
        const options = deckOriginOptions([sealed]);
        expect(effectiveDeckOrigin("sealed:lea", options)).toBe("sealed:lea");
        expect(effectiveDeckOrigin("draft:inv", options)).toBe("all");
    });
});

describe("homeDecks under the origin filter", () => {
    const decks = [sealed, cube, orphan, constructed];
    const ids = (origin: string, format = "limited" as const) =>
        homeDecks(decks, format, "", origin).mine.map((e) => e.deck.presetId);

    it("narrows Limited decks to the chosen origin", () => {
        expect(ids("sealed:lea")).toEqual(["a", "o"]);
    });

    it("keeps a Limited deck with no origin reachable under every origin", () => {
        expect(deckPassesOrigin(orphan, "draft:cube:vintage")).toBe(true);
        expect(ids("draft:cube:vintage")).toContain("o");
    });

    it("all shows every Limited deck; other Formats ignore the origin", () => {
        expect(ids("all")).toEqual(["a", "c", "o"]);
        expect(
            homeDecks(decks, "all", "", "sealed:lea").mine.map(
                (e) => e.deck.presetId
            )
        ).toEqual(["a", "c", "o", "k"]);
    });
});
