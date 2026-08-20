// Join row shows the inherited Match format BEFORE joining (PRD #387 user story
// 12 / #397): a joiner inherits the creator's `bestOf`, surfaced as a "Bo3
// Match" / "Bo1 Match" badge on each open-game row. See `../dashboard-play-box`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import DashboardPlayBox, { type OpenGame } from "../dashboard-play-box";

const DECK: LobbyDeck = {
    kind: "preset",
    presetId: "mono-red-burn",
    name: "Mono Red Burn",
    format: "old-school",
    colors: ["R"],
    cards: [],
    featuredCardId: null,
    isLegal: true,
    reasons: [],
};

function openGame(id: string, name: string, bestOf: 1 | 3): OpenGame {
    return {
        _id: id as OpenGame["_id"],
        _creationTime: 0,
        name,
        status: "waiting",
        players: [
            {
                id: "creator",
                name: "Creator",
                bgColor: "#000",
                deck: { id: "d", name: "D", format: "old-school", cards: [] },
            },
        ],
        createdAt: 0,
        updatedAt: 0,
        bestOf,
    } as OpenGame;
}

function renderBox(openGames: OpenGame[], onJoin = vi.fn()) {
    return {
        onJoin,
        ...render(
            <DashboardPlayBox
                selectedDeck={DECK}
                openGames={openGames}
                mode="arena"
                onModeChange={vi.fn()}
                onCreateSolo={vi.fn()}
                onCreateManual={vi.fn()}
                onCreateVsAi={vi.fn()}
                onCreateMultiplayer={vi.fn()}
                onJoin={onJoin}
                onChangeDeck={vi.fn()}
                matchFormat={1}
                onMatchFormatChange={vi.fn()}
            />
        ),
    };
}

describe("DashboardPlayBox join format (issue #397)", () => {
    it("shows the inherited 'Bo3 Match' format on a Bo3 open game", () => {
        const { getByText } = renderBox([openGame("g1", "Alice's game", 3)]);
        expect(getByText("Alice's game")).toBeTruthy();
        expect(getByText(/Bo3 Match/)).toBeTruthy();
    });

    it("shows 'Bo1 Match' on a Bo1 open game", () => {
        const { getByText, queryByText } = renderBox([
            openGame("g2", "Bob's game", 1),
        ]);
        expect(getByText(/Bo1 Match/)).toBeTruthy();
        expect(queryByText(/Bo3 Match/)).toBeNull();
    });

    it("renders the format per row when several games are open", () => {
        const { getByText } = renderBox([
            openGame("g1", "Alice's game", 3),
            openGame("g2", "Bob's game", 1),
        ]);
        expect(getByText(/Bo3 Match/)).toBeTruthy();
        expect(getByText(/Bo1 Match/)).toBeTruthy();
    });

    it("joining a row fires onJoin with that game's id", () => {
        const onJoin = vi.fn();
        const { getByText } = renderBox(
            [openGame("g1", "Alice's game", 3)],
            onJoin
        );
        fireEvent.click(getByText("Alice's game"));
        expect(onJoin).toHaveBeenCalledWith("g1");
    });
});

describe("DashboardPlayBox compact selected-deck tile (ADR 0101 §10, issue #2591)", () => {
    const REAL_CARD_ID = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";

    function renderWith(selectedDeck: LobbyDeck | null) {
        return render(
            <DashboardPlayBox
                selectedDeck={selectedDeck}
                openGames={[]}
                mode="arena"
                onModeChange={vi.fn()}
                onCreateSolo={vi.fn()}
                onCreateManual={vi.fn()}
                onCreateVsAi={vi.fn()}
                onCreateMultiplayer={vi.fn()}
                onJoin={vi.fn()}
                onChangeDeck={vi.fn()}
                matchFormat={1}
                onMatchFormatChange={vi.fn()}
            />
        );
    }

    it("renders the selected deck's Featured Card art in the compact tile", () => {
        const { container } = renderWith({
            ...DECK,
            featuredCardId: REAL_CARD_ID,
        });
        const img = container.querySelector("img[src*='art_crop']");
        expect(img).not.toBeNull();
        expect(img!.getAttribute("src")).toContain(REAL_CARD_ID);
    });

    it("renders the no-art fallback when no deck is selected", () => {
        const { container, getByText } = renderWith(null);
        expect(getByText("No deck selected")).toBeTruthy();
        expect(container.querySelector("img[src*='art_crop']")).toBeNull();
    });
});

describe("DashboardPlayBox deck legality gate (issue #512)", () => {
    const ILLEGAL: LobbyDeck = {
        ...DECK,
        isLegal: false,
        reasons: [
            {
                code: "size-min",
                message: "Maindeck has 1 cards, minimum is 60.",
            },
        ],
    };

    function renderWith(selectedDeck: LobbyDeck | null) {
        const handlers = {
            onCreateSolo: vi.fn(),
            onCreateManual: vi.fn(),
            onCreateVsAi: vi.fn(),
            onCreateMultiplayer: vi.fn(),
        };
        return {
            handlers,
            ...render(
                <DashboardPlayBox
                    selectedDeck={selectedDeck}
                    openGames={[]}
                    mode="arena"
                    onModeChange={vi.fn()}
                    onCreateSolo={handlers.onCreateSolo}
                    onCreateManual={handlers.onCreateManual}
                    onCreateVsAi={handlers.onCreateVsAi}
                    onCreateMultiplayer={handlers.onCreateMultiplayer}
                    onJoin={vi.fn()}
                    onChangeDeck={vi.fn()}
                    matchFormat={1}
                    onMatchFormatChange={vi.fn()}
                />
            ),
        };
    }

    it("disables every Play button and shows the reasons for an illegal deck", () => {
        const { getByText, handlers } = renderWith(ILLEGAL);
        expect(getByText(/not legal for its format/i)).toBeTruthy();
        expect(getByText(/minimum is 60/)).toBeTruthy();
        for (const label of ["Play vs Bot", "Solo game", "Open a table"]) {
            const btn = getByText(label).closest("button") as HTMLButtonElement;
            expect(btn.disabled).toBe(true);
            fireEvent.click(btn);
        }
        expect(handlers.onCreateVsAi).not.toHaveBeenCalled();
        expect(handlers.onCreateSolo).not.toHaveBeenCalled();
        expect(handlers.onCreateMultiplayer).not.toHaveBeenCalled();
    });

    it("enables Play for a legal selected deck", () => {
        const { getByText } = renderWith(DECK);
        const btn = getByText("Solo game").closest(
            "button"
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });
});

describe("DashboardPlayBox vs-AI dialog handoff (two-step flow)", () => {
    function renderBox(onCreateVsAi = vi.fn()) {
        return {
            onCreateVsAi,
            ...render(
                <DashboardPlayBox
                    selectedDeck={DECK}
                    openGames={[]}
                    mode="arena"
                    onModeChange={vi.fn()}
                    onCreateSolo={vi.fn()}
                    onCreateManual={vi.fn()}
                    onCreateVsAi={onCreateVsAi}
                    onCreateMultiplayer={vi.fn()}
                    onJoin={vi.fn()}
                    onChangeDeck={vi.fn()}
                    matchFormat={1}
                    onMatchFormatChange={vi.fn()}
                />
            ),
        };
    }

    // The vs-AI-only knobs stay in the dialog. Match Format is NOT vs-AI-only:
    // it governs Solo and Multiplayer too, so it lives in the Play box.
    it("no longer renders the inline difficulty / AI-deck selectors", () => {
        const { queryByLabelText } = renderBox();
        expect(queryByLabelText("AI Difficulty")).toBeNull();
        expect(queryByLabelText("AI Opponent Deck")).toBeNull();
        expect(queryByLabelText("Match Format")).toBeTruthy();
    });

    it("clicking 'Play vs Bot' fires the open-dialog callback", () => {
        const onCreateVsAi = vi.fn();
        const { getByText } = renderBox(onCreateVsAi);
        fireEvent.click(getByText("Play vs Bot"));
        expect(onCreateVsAi).toHaveBeenCalledTimes(1);
    });
});

// The Bo1/Bo3 knob used to live ONLY inside the vs-AI setup dialog, so the
// Solo and Multiplayer actions silently used the persisted default with
// no way to change it. The selector now sits in the Play box, next to the
// actions it governs.
describe("DashboardPlayBox match format selector", () => {
    function renderWith(matchFormat: 1 | 3, onMatchFormatChange = vi.fn()) {
        return {
            onMatchFormatChange,
            ...render(
                <DashboardPlayBox
                    selectedDeck={DECK}
                    openGames={[]}
                    mode="arena"
                    onModeChange={vi.fn()}
                    onCreateSolo={vi.fn()}
                    onCreateManual={vi.fn()}
                    onCreateVsAi={vi.fn()}
                    onCreateMultiplayer={vi.fn()}
                    onJoin={vi.fn()}
                    onChangeDeck={vi.fn()}
                    matchFormat={matchFormat}
                    onMatchFormatChange={onMatchFormatChange}
                />
            ),
        };
    }

    it("exposes Bo1/Bo3 for the multiplayer and solo actions", () => {
        const { getByRole } = renderWith(1);
        expect(
            getByRole("radio", { name: "Bo1" }).getAttribute("aria-checked")
        ).toBe("true");
        expect(
            getByRole("radio", { name: "Bo3" }).getAttribute("aria-checked")
        ).toBe("false");
    });

    it("reports the picked format to the lobby", () => {
        const { getByRole, onMatchFormatChange } = renderWith(1);
        fireEvent.click(getByRole("radio", { name: "Bo3" }));
        expect(onMatchFormatChange).toHaveBeenCalledWith(3);
    });
});

/**
 * Explicit game-mode selector (ADR 0101 §10, issue #2591): Arena mode |
 * Cockatrice mode. The mode now DRIVES the action set and deck compatibility
 * — the inverse of the pre-#2591 flow, which derived "manual or not" from
 * whichever deck happened to be selected. Manual Decks and the real engine
 * stay mutually exclusive by construction (ADR 0080), but the gate now keys
 * off the explicit `mode` prop, not `selectedDeck.format` alone.
 */
describe("DashboardPlayBox mode gating (ADR 0101 §10, issue #2591)", () => {
    const MANUAL: LobbyDeck = {
        ...DECK,
        presetId: "manual-deck",
        name: "Manual Deck",
        format: "manual",
        cards: [{ cardId: "print-1", cardName: "Sliver Queen" }],
    };

    function renderWith(mode: "arena" | "cockatrice", selectedDeck: LobbyDeck) {
        const handlers = {
            onCreateSolo: vi.fn(),
            onCreateManual: vi.fn(),
            onCreateVsAi: vi.fn(),
            onCreateMultiplayer: vi.fn(),
        };
        return {
            handlers,
            ...render(
                <DashboardPlayBox
                    selectedDeck={selectedDeck}
                    openGames={[]}
                    mode={mode}
                    onModeChange={vi.fn()}
                    onCreateSolo={handlers.onCreateSolo}
                    onCreateManual={handlers.onCreateManual}
                    onCreateVsAi={handlers.onCreateVsAi}
                    onCreateMultiplayer={handlers.onCreateMultiplayer}
                    onJoin={vi.fn()}
                    onChangeDeck={vi.fn()}
                    matchFormat={1}
                    onMatchFormatChange={vi.fn()}
                />
            ),
        };
    }

    const button = (getByText: (t: string) => HTMLElement, label: string) =>
        getByText(label).closest("button") as HTMLButtonElement;

    it("Arena mode renders only the Arena action set", () => {
        const { getByText, queryByText } = renderWith("arena", DECK);
        expect(getByText("Play vs Bot")).toBeTruthy();
        expect(getByText("Solo game")).toBeTruthy();
        expect(getByText("Open a table")).toBeTruthy();
        expect(queryByText("Solo table")).toBeNull();
    });

    it("Cockatrice mode renders only the Cockatrice action set", () => {
        const { getByText, queryByText } = renderWith("cockatrice", MANUAL);
        expect(getByText("Solo table")).toBeTruthy();
        expect(getByText("Open a table")).toBeTruthy();
        expect(queryByText("Play vs Bot")).toBeNull();
        expect(queryByText("Solo game")).toBeNull();
    });

    it("a real deck under Cockatrice mode is not offered — actions disabled", () => {
        const { getByText, handlers } = renderWith("cockatrice", DECK);
        for (const label of ["Solo table", "Open a table"]) {
            expect(button(getByText, label).disabled).toBe(true);
        }
        fireEvent.click(button(getByText, "Solo table"));
        expect(handlers.onCreateManual).not.toHaveBeenCalled();
        expect(getByText(/isn't a Manual Deck/i)).toBeTruthy();
    });

    it("a manual deck under Arena mode is not offered — actions disabled", () => {
        const { getByText, handlers } = renderWith("arena", MANUAL);
        for (const label of ["Play vs Bot", "Solo game", "Open a table"]) {
            expect(button(getByText, label).disabled).toBe(true);
        }
        fireEvent.click(button(getByText, "Solo game"));
        expect(handlers.onCreateSolo).not.toHaveBeenCalled();
        expect(getByText(/is a Manual Deck/i)).toBeTruthy();
    });

    it("Cockatrice mode blocks Solo table for an empty Manual Deck", () => {
        const { getByText } = renderWith("cockatrice", {
            ...MANUAL,
            cards: [],
        });
        expect(button(getByText, "Solo table").disabled).toBe(true);
        expect(getByText(/empty/i)).toBeTruthy();
    });

    it("enables the Cockatrice action set for a matching Manual Deck", () => {
        const { getByText } = renderWith("cockatrice", MANUAL);
        expect(button(getByText, "Solo table").disabled).toBe(false);
        expect(button(getByText, "Open a table").disabled).toBe(false);
    });
});
