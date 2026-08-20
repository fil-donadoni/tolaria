// /decks/$slug route wiring (issue #2591): Edit routes to the user-deck
// editor for a user deck, to the preset editor for an admin viewing a
// preset, and is absent for a non-admin viewing a preset — the same three-way
// gate `lobby.tsx`'s `handleEditDeck`/`handleEditPreset`/`isAdmin` already
// apply to the "My Decks"/"Preset Decks" panels. This is exactly the
// "frontend wiring" class of bug the per-component test can't catch: it
// proves the ROUTE, not just `DeckDetail`'s props in isolation.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import DeckDetailRoute from "../deck-detail.route";

const navigate = vi.fn();
const useQueryMock = vi.fn();
let currentUser: { _id: string; nickname: string; isAdmin?: boolean } | null =
    null;
let routeSlug = "mono-red-burn";

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
    useParams: () => ({ slug: routeSlug }),
}));

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useMutation: () => vi.fn(),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => currentUser,
}));

vi.mock("~/hooks/usePageVisible", () => ({ usePageVisible: () => true }));

const USER_DECK = {
    kind: "user" as const,
    presetId: "my-user-deck",
    userDeckId: "userdeck-1",
    name: "My User Deck",
    format: "old-school" as const,
    colors: ["R"],
    cards: [],
    featuredCardId: null,
    isLegal: true,
    reasons: [],
};

const MANUAL_USER_DECK = {
    kind: "user" as const,
    presetId: "my-manual-deck",
    userDeckId: "userdeck-manual-1",
    name: "My Manual Deck",
    format: "manual" as const,
    colors: ["U"],
    cards: [],
    featuredCardId: null,
    isLegal: true,
    reasons: [],
};

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => [USER_DECK, MANUAL_USER_DECK],
    useUserDeckMutations: () => ({ remove: vi.fn() }),
}));

const PRESET_DECK = {
    presetId: "mono-red-burn",
    name: "Mono Red Burn",
    format: "old-school",
    colors: ["R"],
    cards: [],
    sideboard: [],
    featuredCardId: null,
    isLegal: true,
    reasons: [],
};

beforeEach(() => {
    vi.clearAllMocks();
    currentUser = null;
    routeSlug = "mono-red-burn";
    useQueryMock.mockImplementation(() => [PRESET_DECK]);
    localStorage.clear();
});

afterEach(() => cleanup());

describe("DeckDetailRoute Edit wiring (issue #2591)", () => {
    it("routes Edit to the user-deck editor for a user deck", () => {
        routeSlug = "my-user-deck";
        render(<DeckDetailRoute />);
        fireEvent.click(screen.getByText("Edit"));
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/$slug/edit",
            params: { slug: "my-user-deck" },
        });
    });

    it("routes Edit to the preset editor for an admin viewing a preset", () => {
        currentUser = { _id: "admin-1", nickname: "Admin", isAdmin: true };
        render(<DeckDetailRoute />);
        fireEvent.click(screen.getByText("Edit"));
        expect(navigate).toHaveBeenCalledWith({
            to: "/presets/$slug/edit",
            params: { slug: "mono-red-burn" },
        });
    });

    it("hides Edit for a non-admin viewing a preset", () => {
        currentUser = { _id: "user-1", nickname: "Player" };
        render(<DeckDetailRoute />);
        expect(screen.queryByText("Edit")).toBeNull();
    });
});

// L6 (issue #2591 review, PR #2647): "Play" stored a preset id without
// reconciling the lobby's game-mode selector — a Manual Deck selected while
// the stored mode was Arena (or vice versa) landed back on a lobby where
// the deck was filtered out of every list and every Play action disabled
// (fail-closed, but silently). `onSelect` must set `tolaria:playMode` to
// match the deck's OWN format, not just store its id.
describe("DeckDetailRoute 'Play' reconciles game mode (issue #2591 L6)", () => {
    it("switches the stored mode to Arena when Playing a non-manual deck from Cockatrice mode", () => {
        localStorage.setItem("tolaria:playMode", "cockatrice");
        routeSlug = "mono-red-burn"; // preset deck, format: old-school
        render(<DeckDetailRoute />);
        fireEvent.click(screen.getByText("Play"));
        expect(localStorage.getItem("tolaria:playMode")).toBe("arena");
    });

    it("switches the stored mode to Cockatrice when Playing a Manual Deck from Arena mode", () => {
        localStorage.setItem("tolaria:playMode", "arena");
        routeSlug = "my-manual-deck";
        render(<DeckDetailRoute />);
        fireEvent.click(screen.getByText("Play"));
        expect(localStorage.getItem("tolaria:playMode")).toBe("cockatrice");
    });
});
