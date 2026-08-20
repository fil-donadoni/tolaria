// Deck detail page (PRD #2405 D15 / ADR 0101 §9, issue #2591): list (already
// shipped via `ManaPileView`) + curve + legality + Edit/Play. See
// `../deck-detail`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import DeckDetail from "../deck-detail";

// `ManaPileView` (already-shipped list view, unchanged by this slice) reads
// the full catalogue via `useFullCatalogue`/`useQuery` for a manual deck's
// shape resolution — always called (hooks can't branch), so it needs a
// Convex client in the tree even though every deck here is non-manual.
// Mirrors `lobby.test.tsx`'s api-proxy mock.
vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

// Savannah Lions (1-mana 2/1 white creature) — the same real registry id
// several other lobby tests already use to exercise catalogue-backed art/
// stats without hand-rolling a card definition.
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";

const DECK: LobbyDeck = {
    kind: "preset",
    presetId: "mono-white-lions",
    name: "Mono White Lions",
    format: "old-school",
    colors: ["W"],
    cards: [
        { cardId: SAVANNAH_LIONS, cardName: "Savannah Lions" },
        { cardId: SAVANNAH_LIONS, cardName: "Savannah Lions" },
    ],
    featuredCardId: null,
    isLegal: true,
    reasons: [],
};

function renderDetail(overrides: Partial<Parameters<typeof DeckDetail>[0]>) {
    return render(
        <DeckDetail
            deck={DECK}
            isSelected={false}
            onBack={vi.fn()}
            onSelect={vi.fn()}
            {...overrides}
        />
    );
}

describe("DeckDetail mana curve (issue #2591)", () => {
    it("renders the Mana Curve chart with the deck's 1-drop count", () => {
        renderDetail({});
        expect(screen.getByText("Mana Curve")).toBeTruthy();
        // DeckStatsCurveChart's group label + per-bucket title (two 1-mana
        // non-land cards → bucket "1" holds count 2).
        expect(
            screen.getByRole("group", {
                name: "Mana curve by mana value, lands excluded",
            })
        ).toBeTruthy();
        expect(screen.getByTitle("Mana value 1: 2 cards")).toBeTruthy();
    });
});

describe("DeckDetail legality section (issue #2591)", () => {
    it("shows no legality banner for a legal deck", () => {
        renderDetail({});
        expect(screen.queryByText(/not legal for its format/i)).toBeNull();
    });

    it("shows the reasons for an illegal deck", () => {
        renderDetail({
            deck: {
                ...DECK,
                isLegal: false,
                reasons: [
                    {
                        code: "size-min",
                        message: "Maindeck has 2 cards, minimum is 60.",
                    },
                ],
            },
        });
        expect(screen.getByText(/not legal for its format/i)).toBeTruthy();
        expect(screen.getByText(/minimum is 60/)).toBeTruthy();
    });
});

describe("DeckDetail Edit / Play actions (issue #2591)", () => {
    it("hides Edit when no onEdit is supplied (e.g. a non-admin viewing a preset)", () => {
        renderDetail({});
        expect(screen.queryByText("Edit")).toBeNull();
    });

    it("fires onEdit when Edit is clicked", () => {
        const onEdit = vi.fn();
        renderDetail({ onEdit });
        fireEvent.click(screen.getByText("Edit"));
        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("shows 'Play' and fires onSelect when not yet selected", () => {
        const onSelect = vi.fn();
        renderDetail({ onSelect, isSelected: false });
        const btn = screen
            .getByText("Play")
            .closest("button") as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        fireEvent.click(btn);
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("shows a disabled 'Selected' once this deck is the active selection", () => {
        renderDetail({ isSelected: true });
        expect(screen.queryByText("Play")).toBeNull();
        const btn = screen
            .getByText("Selected")
            .closest("button") as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });
});
