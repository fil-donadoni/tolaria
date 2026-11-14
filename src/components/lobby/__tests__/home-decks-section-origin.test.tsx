// @vitest-environment happy-dom
// The Decks section's second-level Limited Origin select (issue #2818).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import HomeDecksSection from "../home-decks-section";

function deck(id: string, overrides: Partial<LobbyDeck>): LobbyDeck {
    return {
        kind: "user",
        presetId: id,
        name: `Deck ${id}`,
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

const DECKS = [
    deck("sealed-one", { limitedOrigin: "sealed:lea" }),
    deck("cube-one", { limitedOrigin: "draft:cube:vintage" }),
    deck("old-one", { format: "premodern" }),
];

const ORIGIN = "Filter Limited decks by origin";
const FORMAT = "Filter decks by format";

function mount(decks: LobbyDeck[] = DECKS) {
    return render(
        <HomeDecksSection decks={decks} onOpen={() => {}} onNew={() => {}} />
    );
}

describe("HomeDecksSection Limited Origin filter", () => {
    beforeEach(() => localStorage.clear());
    afterEach(cleanup);

    it("appears only while the Format filter is Limited", () => {
        mount();
        expect(screen.queryByLabelText(ORIGIN)).toBeNull();
        fireEvent.change(screen.getByLabelText(FORMAT), {
            target: { value: "limited" },
        });
        expect(screen.getByLabelText(ORIGIN)).toBeTruthy();
        fireEvent.change(screen.getByLabelText(FORMAT), {
            target: { value: "premodern" },
        });
        expect(screen.queryByLabelText(ORIGIN)).toBeNull();
    });

    it("narrows the list and persists the choice", () => {
        mount();
        fireEvent.change(screen.getByLabelText(FORMAT), {
            target: { value: "limited" },
        });
        expect(screen.queryByText("Deck cube-one")).not.toBeNull();
        fireEvent.change(screen.getByLabelText(ORIGIN), {
            target: { value: "sealed:lea" },
        });
        expect(screen.queryByText("Deck sealed-one")).not.toBeNull();
        expect(screen.queryByText("Deck cube-one")).toBeNull();
        cleanup();
        mount();
        expect((screen.getByLabelText(ORIGIN) as HTMLSelectElement).value).toBe(
            "sealed:lea"
        );
    });

    it("shows no select when no Limited deck has an origin", () => {
        mount([deck("old-one", { format: "premodern" })]);
        fireEvent.change(screen.getByLabelText(FORMAT), {
            target: { value: "limited" },
        });
        expect(screen.queryByLabelText(ORIGIN)).toBeNull();
    });
});
