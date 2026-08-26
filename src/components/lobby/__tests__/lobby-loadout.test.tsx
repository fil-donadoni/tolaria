// The Loadout (ADR 0103 §6, issue #2726) — the active deck and THE primary
// action. Ports the gating/legality half of the retired
// `dashboard-play-box.test.tsx` onto the component that inherited it, plus the
// one genuinely new contract: the plate is named by the selected Mode Tile.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import { lobbyModeTiles, type LobbyModeKey } from "~/lib/lobbyModes";
import type { PlayMode } from "~/lib/session";
import LobbyLoadout from "../lobby-loadout";

function makeDeck(overrides: Partial<LobbyDeck> = {}): LobbyDeck {
    return {
        kind: "preset",
        presetId: "mono-red-burn",
        name: "Mono Red Burn",
        description: "Burn",
        format: "old-school",
        colors: ["R"],
        cards: [{ id: "card-a", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

function tileFor(mode: PlayMode, key: LobbyModeKey) {
    return lobbyModeTiles({
        mode,
        difficulty: "medium",
        liveLimitedEvents: 0,
    }).find((t) => t.key === key)!;
}

function renderLoadout(
    overrides: Partial<React.ComponentProps<typeof LobbyLoadout>> = {}
) {
    const props: React.ComponentProps<typeof LobbyLoadout> = {
        deck: makeDeck(),
        mode: "arena",
        tile: tileFor("arena", "bot"),
        matchFormat: 1,
        onMatchFormatChange: vi.fn(),
        onPrimary: vi.fn(),
        onJoinByCode: vi.fn(),
        onEditDeck: vi.fn(),
        onChangeDeck: vi.fn(),
        ...overrides,
    };
    return { ...render(<LobbyLoadout {...props} />), props };
}

describe("LobbyLoadout primary action naming (AC #3)", () => {
    it("takes its name from the selected Mode Tile", () => {
        const { getByRole } = renderLoadout({
            tile: tileFor("arena", "table"),
        });
        expect(getByRole("button", { name: "Open a table" })).toBeTruthy();
    });

    it("runs the caller's dispatch, not a mutation of its own", () => {
        const onPrimary = vi.fn();
        const { getByRole } = renderLoadout({ onPrimary });
        fireEvent.click(getByRole("button", { name: "Play vs Bot" }));
        expect(onPrimary).toHaveBeenCalledTimes(1);
    });
});

describe("LobbyLoadout gating (ADR 0036/0080, issues #512 #155 #2591)", () => {
    const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

    it("disables the primary action with no deck selected", () => {
        const { getByRole, getByText } = renderLoadout({ deck: null });
        expect(getByText("No deck selected")).toBeTruthy();
        expect(isDisabled(getByRole("button", { name: "Play vs Bot" }))).toBe(
            true
        );
    });

    it("disables it for an illegal deck and says why", () => {
        const { getByRole, getByText } = renderLoadout({
            deck: makeDeck({
                isLegal: false,
                reasons: [{ code: "min-cards", message: "Needs 60 cards." }],
            }),
        });
        expect(isDisabled(getByRole("button", { name: "Play vs Bot" }))).toBe(
            true
        );
        expect(getByText("Needs 60 cards.")).toBeTruthy();
        expect(getByText("Illegal")).toBeTruthy();
    });

    it("disables it while another action is in flight", () => {
        const { getByRole } = renderLoadout({ busy: true });
        expect(isDisabled(getByRole("button", { name: "Play vs Bot" }))).toBe(
            true
        );
    });

    it("disables it while the viewer already holds an active game (#155)", () => {
        const { getByRole } = renderLoadout({ hasActiveGame: true });
        expect(isDisabled(getByRole("button", { name: "Play vs Bot" }))).toBe(
            true
        );
    });

    it("LEAVES the Limited action enabled with no deck at all — it is a navigation, not a game", () => {
        const { getByRole } = renderLoadout({
            deck: null,
            tile: tileFor("arena", "limited"),
        });
        expect(isDisabled(getByRole("button", { name: "Limited" }))).toBe(
            false
        );
    });

    it("disables it for a deck whose format does not match the game mode (ADR 0080)", () => {
        const { getByRole, getByText } = renderLoadout({
            deck: makeDeck({ format: "manual" }),
            mode: "arena",
        });
        expect(isDisabled(getByRole("button", { name: "Play vs Bot" }))).toBe(
            true
        );
        expect(
            getByText(
                "This is a Manual Deck — switch to Cockatrice mode to play it, or pick a different deck."
            )
        ).toBeTruthy();
    });

    it("disables it for an EMPTY Manual Deck, which the manual Format calls legal", () => {
        const { getByRole, getByText } = renderLoadout({
            deck: makeDeck({ format: "manual", cards: [] }),
            mode: "cockatrice",
            tile: tileFor("cockatrice", "manual-solo"),
        });
        expect(isDisabled(getByRole("button", { name: "Solo table" }))).toBe(
            true
        );
        expect(
            getByText(
                "This Manual Deck is empty — add cards before starting a game."
            )
        ).toBeTruthy();
    });
});

describe("LobbyLoadout secondary affordances", () => {
    it("offers 'Join by code' in Arena mode only (issue #2649)", () => {
        const arena = renderLoadout();
        expect(
            arena.getByRole("button", { name: "Join by code" })
        ).toBeTruthy();
        arena.unmount();

        const cockatrice = renderLoadout({
            deck: makeDeck({ format: "manual" }),
            mode: "cockatrice",
            tile: tileFor("cockatrice", "manual-solo"),
        });
        expect(
            cockatrice.queryByRole("button", { name: "Join by code" })
        ).toBeNull();
    });

    it("keeps Edit and Change deck a single tap for the selected deck", () => {
        const onEditDeck = vi.fn();
        const onChangeDeck = vi.fn();
        const { getByRole } = renderLoadout({ onEditDeck, onChangeDeck });
        fireEvent.click(getByRole("button", { name: "Edit" }));
        fireEvent.click(getByRole("button", { name: "Change deck" }));
        expect(onEditDeck).toHaveBeenCalledTimes(1);
        expect(onChangeDeck).toHaveBeenCalledTimes(1);
    });

    it("carries the Bo1/Bo3 selector, exactly once", () => {
        const onMatchFormatChange = vi.fn();
        const { getByRole, getByLabelText } = renderLoadout({
            onMatchFormatChange,
        });
        expect(getByLabelText("Match Format")).toBeTruthy();
        fireEvent.click(getByRole("radio", { name: "Bo3" }));
        expect(onMatchFormatChange).toHaveBeenCalledWith(3);
    });

    it("shows the deck's size, format and archetype line", () => {
        const { getByText } = renderLoadout();
        // `cards.length` is DISTINCT entries, the same count `DeckListItem`
        // has always shown — parity is deliberate, not a rounding of
        // quantities.
        expect(getByText("1 cards · Old School (93/94) · Burn")).toBeTruthy();
    });
});
