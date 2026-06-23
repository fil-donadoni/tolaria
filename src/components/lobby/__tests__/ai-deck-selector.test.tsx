// AI opponent deck picker: lists decks plus a "mirror" default, reports the
// chosen presetId (or null for mirror), and stays inert while disabled.
// See `../ai-deck-selector`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import AiDeckSelector from "../ai-deck-selector";

const DECKS: LobbyDeck[] = [
    {
        kind: "preset",
        presetId: "mono-red-burn",
        name: "Mono Red Burn",
        format: "old-school",
        colors: ["R"],
        cards: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
    {
        kind: "preset",
        presetId: "white-weenie",
        name: "White Weenie",
        format: "old-school",
        colors: ["W"],
        cards: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
];

describe("AiDeckSelector", () => {
    it("renders a mirror option plus one per deck", () => {
        const { getAllByRole } = render(
            <AiDeckSelector decks={DECKS} value={null} onChange={() => {}} />
        );
        // mirror + 2 decks
        expect(getAllByRole("option")).toHaveLength(3);
    });

    it("defaults to the mirror option when value is null", () => {
        const { getByLabelText } = render(
            <AiDeckSelector decks={DECKS} value={null} onChange={() => {}} />
        );
        expect(
            (getByLabelText("AI Opponent Deck") as HTMLSelectElement).value
        ).toBe("");
    });

    it("reflects the selected deck presetId", () => {
        const { getByLabelText } = render(
            <AiDeckSelector
                decks={DECKS}
                value="white-weenie"
                onChange={() => {}}
            />
        );
        expect(
            (getByLabelText("AI Opponent Deck") as HTMLSelectElement).value
        ).toBe("white-weenie");
    });

    it("reports the chosen deck presetId on change", () => {
        const onChange = vi.fn();
        const { getByLabelText } = render(
            <AiDeckSelector decks={DECKS} value={null} onChange={onChange} />
        );
        fireEvent.change(getByLabelText("AI Opponent Deck"), {
            target: { value: "mono-red-burn" },
        });
        expect(onChange).toHaveBeenCalledWith("mono-red-burn");
    });

    it("reports null when the mirror option is chosen", () => {
        const onChange = vi.fn();
        const { getByLabelText } = render(
            <AiDeckSelector
                decks={DECKS}
                value="mono-red-burn"
                onChange={onChange}
            />
        );
        fireEvent.change(getByLabelText("AI Opponent Deck"), {
            target: { value: "" },
        });
        expect(onChange).toHaveBeenCalledWith(null);
    });
});
