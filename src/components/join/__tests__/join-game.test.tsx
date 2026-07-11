// Invite antechamber (`/join/<gameId>`): the join page names the host, states
// the game format, and lists ONLY the visitor's decks in that format. Picking a
// legal deck and confirming fires `joinGame` with that deck and enters /game.
// Not-joinable games (own game, started, full, missing) show a fallback instead
// of the deck picker. See `../join-game`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import JoinGame from "../join-game";

const navigate = vi.fn();
const joinGame = vi.fn().mockResolvedValue(undefined);
const storeSession = vi.fn();

// Two presets in different formats: only the old-school one may be brought to an
// old-school game. Shape mirrors the preset source `toPresetLobbyDeck` accepts
// (server-derived legality present → used as-is).
const PRESET_DECKS = [
    {
        presetId: "mono-red-burn",
        name: "Mono Red Burn",
        description: "Burn",
        format: "old-school",
        colors: ["R"],
        cards: [{ cardId: "card-a", cardName: "Lightning Bolt" }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
    {
        presetId: "future-blue",
        name: "Future Blue",
        description: "Draw-Go",
        format: "freeform",
        colors: ["U"],
        cards: [{ cardId: "card-b", cardName: "Counterspell" }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
];

const JOINABLE_INFO = {
    gameId: "game-1",
    name: "Tester's game",
    hostName: "Tester",
    format: "old-school",
    status: "waiting",
    playerCount: 1,
    isHost: false,
    joinable: true,
};

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-2", nickname: "Joiner" }),
}));

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => [],
}));

vi.mock("~/lib/session", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    storeSession: (...args: unknown[]) => storeSession(...args),
}));

beforeEach(() => {
    vi.clearAllMocks();
    // Query order in JoinGame: getJoinInfo, then decks.list (useUserDecks mocked).
    useMutationMock.mockReturnValue(joinGame);
});

function renderJoin(info: unknown) {
    // Two useQuery calls per render, in order: getJoinInfo, then decks.list
    // (useUserDecks is mocked). Route by call index MODULO 2 so the mapping
    // stays correct across re-renders (a persistent counter would drift).
    let call = 0;
    useQueryMock.mockImplementation(() =>
        call++ % 2 === 0 ? info : PRESET_DECKS
    );
    return render(<JoinGame gameId={"game-1" as never} />);
}

describe("JoinGame antechamber", () => {
    it("lists only decks in the game's format and names the host", () => {
        const { getByText, queryByText } = renderJoin(JOINABLE_INFO);
        // Host surfaced in the subtitle.
        expect(getByText(/invited you/)).toBeTruthy();
        // Old-school deck shown; the freeform deck filtered out.
        expect(getByText("Mono Red Burn")).toBeTruthy();
        expect(queryByText("Future Blue")).toBeNull();
    });

    it("renders both the Your Decks and Preset Decks panels", () => {
        const { getByText } = renderJoin(JOINABLE_INFO);
        expect(getByText("Your Decks")).toBeTruthy();
        expect(getByText("Preset Decks")).toBeTruthy();
    });

    it("links to the deck builder seeded with the game's format", () => {
        const { getByText } = renderJoin(JOINABLE_INFO);
        fireEvent.click(getByText("+ New Deck"));
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/create",
            search: { format: "old-school" },
        });
    });

    it("joins with the selected deck, then enters the game", async () => {
        const { getByText, getAllByText } = renderJoin(JOINABLE_INFO);
        // Select the deck via its row "Select" control.
        fireEvent.click(getByText("Select"));
        // Confirm — the footer "Join game" button (the header is an <h2>).
        const joinButton = getAllByText("Join game")
            .map((n) => n.closest("button"))
            .filter((b): b is HTMLButtonElement => b !== null)
            .at(-1)!;
        fireEvent.click(joinButton);
        await waitFor(() => expect(joinGame).toHaveBeenCalledTimes(1));
        const arg = joinGame.mock.calls[0][0];
        expect(arg.gameId).toBe("game-1");
        expect(arg.deck.name).toBe("Mono Red Burn");
        expect(arg.deck.format).toBe("old-school");
        expect(storeSession).toHaveBeenCalledWith("game-1", "user-2");
        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({ to: "/game" })
        );
    });

    it("shows a fallback for the caller's own game (no deck picker)", () => {
        const { getByText, queryByText } = renderJoin({
            ...JOINABLE_INFO,
            isHost: true,
            joinable: false,
        });
        expect(getByText(/your own game/)).toBeTruthy();
        expect(queryByText("Mono Red Burn")).toBeNull();
    });

    it("shows a fallback for an unknown game id", () => {
        const { getByText } = renderJoin(null);
        expect(getByText(/no longer exists/)).toBeTruthy();
    });

    it("shows the loader while join info is still loading", () => {
        const { getByText } = renderJoin(undefined);
        expect(getByText("Loading game…")).toBeTruthy();
    });

    it("does not fire joinGame before a deck is selected", () => {
        const { getAllByText } = renderJoin(JOINABLE_INFO);
        const joinButton = getAllByText("Join game")
            .map((n) => n.closest("button"))
            .filter((b): b is HTMLButtonElement => b !== null)
            .at(-1)!;
        expect(joinButton.disabled).toBe(true);
        fireEvent.click(joinButton);
        expect(joinGame).not.toHaveBeenCalled();
    });
});

afterEach(() => cleanup());
