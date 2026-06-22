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
                difficulty="medium"
                onDifficultyChange={vi.fn()}
                matchFormat={1}
                onMatchFormatChange={vi.fn()}
                decks={[DECK]}
                aiDeckId={null}
                onAiDeckChange={vi.fn()}
                onCreateSolo={vi.fn()}
                onCreateVsAi={vi.fn()}
                onCreateMultiplayer={vi.fn()}
                onJoin={onJoin}
                onChangeDeck={vi.fn()}
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
