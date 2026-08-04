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

describe("DashboardPlayBox featured-art hero splash (PRD #589, issue #600)", () => {
    const REAL_CARD_ID = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";

    function renderWith(selectedDeck: LobbyDeck | null) {
        return render(
            <DashboardPlayBox
                selectedDeck={selectedDeck}
                openGames={[]}
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

    it("renders the selected deck's Featured Card art in the hero splash", () => {
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
        for (const label of [
            "Play vs AI",
            "Solo Game",
            "Create Multiplayer",
            "Manual Game",
        ]) {
            const btn = getByText(label).closest("button") as HTMLButtonElement;
            expect(btn.disabled).toBe(true);
            fireEvent.click(btn);
        }
        expect(handlers.onCreateVsAi).not.toHaveBeenCalled();
        expect(handlers.onCreateSolo).not.toHaveBeenCalled();
        expect(handlers.onCreateMultiplayer).not.toHaveBeenCalled();
        expect(handlers.onCreateManual).not.toHaveBeenCalled();
    });

    it("enables Play for a legal selected deck", () => {
        const { getByText } = renderWith(DECK);
        const btn = getByText("Solo Game").closest(
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
    // it governs Solo and Create Multiplayer too, so it lives in the Play box.
    it("no longer renders the inline difficulty / AI-deck selectors", () => {
        const { queryByLabelText } = renderBox();
        expect(queryByLabelText("AI Difficulty")).toBeNull();
        expect(queryByLabelText("AI Opponent Deck")).toBeNull();
        expect(queryByLabelText("Match Format")).toBeTruthy();
    });

    it("clicking 'Play vs AI' fires the open-dialog callback", () => {
        const onCreateVsAi = vi.fn();
        const { getByText } = renderBox(onCreateVsAi);
        fireEvent.click(getByText("Play vs AI"));
        expect(onCreateVsAi).toHaveBeenCalledTimes(1);
    });
});

// The Bo1/Bo3 knob used to live ONLY inside the vs-AI setup dialog, so the
// Solo and Create Multiplayer actions silently used the persisted default with
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
