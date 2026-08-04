// Two-step "Play vs AI" lobby flow (integration): clicking "Play vs AI" opens
// the setup dialog WITHOUT firing the create mutation; Confirm fires
// `createSoloGame` with the chosen `bestOf` + `deck2`; Cancel closes without
// firing. The player's OWN deck stays the Lobby hero selection. See `../lobby`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
// Static import: `vi.mock` is hoisted above all imports, so the lobby module
// graph (dnd-kit, base-ui, deck-builder, AI) loads fully mocked. Importing it
// here — during collection, not inside a test — keeps its heavy one-time
// transform off the per-test 5s timeout budget, which a lazy `await
// import("../lobby")` inside the first test otherwise blew under full-suite
// load (the transform is only cache-warm when the file runs in isolation).
import Lobby from "../lobby";

const navigate = vi.fn();
const createSoloGame = vi.fn().mockResolvedValue("solo-game-1");
const createGame = vi.fn().mockResolvedValue("game-1");
const joinGame = vi.fn().mockResolvedValue(undefined);
const deletePreset = vi.fn();

// One preset deck the lobby can select as the hero, and a second one usable as
// the AI opponent deck.
const PRESET_DECKS = [
    {
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
    },
    {
        presetId: "white-weenie",
        name: "White Weenie",
        description: "Weenie",
        format: "old-school",
        colors: ["W"],
        cards: [{ id: "card-b", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
];

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

// The lobby references functions like `api.decks.list` / `api.game.createGame`.
// A self-returning Proxy resolves any nested access to a stable token — enough
// for the mocked useQuery/useMutation, which ignore the reference and dispatch
// by call order.
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Tester" }),
}));

vi.mock("~/hooks/usePageVisible", () => ({ usePageVisible: () => true }));

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => [],
    useUserDeckMutations: () => ({
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
    }),
}));

vi.mock("~/lib/adminGating", () => ({ canEditPresets: () => false }));

// Stub the chrome around the Play panel so the integration test stays focused
// on the vs-AI flow (the real DashboardPlayBox + VsAiSetupDialog still render).
// The app header is no longer the Lobby's to render — it moved to `AppShell`
// (`src/components/chrome/app-header.tsx`) so every section wears it — so
// there is nothing to stub here beyond the background.
vi.mock("../lobby-background", () => ({ default: () => null }));

// Persisted lobby state: start with a known hero deck selected, Bo3 format.
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("tolaria:selectedDeckId", "mono-red-burn");
    localStorage.setItem("tolaria:matchFormat", "3");
});

async function renderLobby(myLimitedEvents: unknown[] = []) {
    // `api` is mocked to `{}`, so queries can't be distinguished by reference;
    // route by per-render call order instead. The lobby issues exactly four
    // useQuery calls per render, in this order: presetDecks, openGames,
    // activeGame, myLimitedEvents (issue #1582 — via `useMyLimitedEvents`;
    // currentUser/userDecks go through mocked hooks).
    let queryCall = 0;
    useQueryMock.mockImplementation(() => {
        const idx = queryCall++;
        if (idx % 4 === 0) return PRESET_DECKS;
        if (idx % 4 === 1) return [];
        if (idx % 4 === 2) return null;
        return myLimitedEvents;
    });
    let mutCall = 0;
    useMutationMock.mockImplementation(() => {
        const idx = mutCall++;
        // Order must mirror the `useMutation` calls in `lobby.tsx`:
        // deletePreset, createGame, createSoloGame, createManualSoloGame,
        // createManualGame, joinGame, joinManualGame.
        const createManualSoloGame = vi.fn().mockResolvedValue("manual-game-1");
        const createManualGame = vi.fn().mockResolvedValue("manual-game-2");
        const joinManualGame = vi.fn().mockResolvedValue(null);
        const handlers = [
            deletePreset,
            createGame,
            createSoloGame,
            createManualSoloGame,
            createManualGame,
            joinGame,
            joinManualGame,
        ];
        return handlers[idx % handlers.length];
    });
    return render(<Lobby />);
}

describe("Lobby vs-AI two-step flow", () => {
    it("clicking 'Play vs AI' opens the dialog without firing the mutation", async () => {
        const { getByText, getAllByText, getByLabelText } = await renderLobby();
        // The Play panel button. Before opening, no create mutation.
        fireEvent.click(getByText("Play vs AI"));
        expect(createSoloGame).not.toHaveBeenCalled();
        // Dialog content is now present (the two vs-AI selectors). Match
        // Format is not among them — it governs Solo / Create Multiplayer too
        // and is picked in the Play box, so exactly one instance exists.
        expect(getByLabelText("AI Difficulty")).toBeTruthy();
        expect(getByLabelText("AI Opponent Deck")).toBeTruthy();
        expect(getByLabelText("Match Format")).toBeTruthy();
        // Two "Play vs AI" labels now exist: the panel button + the dialog
        // confirm button.
        expect(getAllByText("Play vs AI").length).toBeGreaterThanOrEqual(2);
    });

    it("Confirm fires createSoloGame with the chosen bestOf and deck2", async () => {
        const { getByText, getAllByText, getByLabelText } = await renderLobby();
        fireEvent.click(getByText("Play vs AI"));
        // Pick White Weenie as the AI opponent deck (deck2).
        fireEvent.change(getByLabelText("AI Opponent Deck"), {
            target: { value: "white-weenie" },
        });
        // Confirm — the dialog footer's "Play vs AI" button. Filter to actual
        // buttons (the dialog title is an <h2>, not a button) and click the
        // last one, which is the footer confirm.
        const buttons = getAllByText("Play vs AI")
            .map((n) => n.closest("button"))
            .filter((b): b is HTMLButtonElement => b !== null);
        fireEvent.click(buttons[buttons.length - 1]);
        expect(createSoloGame).toHaveBeenCalledTimes(1);
        const arg = createSoloGame.mock.calls[0][0];
        expect(arg.vsAi).toBe(true);
        expect(arg.bestOf).toBe(3);
        expect(arg.deck).toBeTruthy();
        expect(arg.deck2).toBeTruthy();
        expect(arg.deck2.name).toBe("White Weenie");
    });

    it("Cancel closes the dialog without firing the mutation", async () => {
        const { getByText, queryByLabelText } = await renderLobby();
        fireEvent.click(getByText("Play vs AI"));
        expect(queryByLabelText("AI Difficulty")).toBeTruthy();
        fireEvent.click(getByText("Cancel"));
        expect(createSoloGame).not.toHaveBeenCalled();
        expect(queryByLabelText("AI Difficulty")).toBeNull();
    });

    // Regression guard for issue #910: the dialog renders through a base-ui
    // portal attached to `document.body`, outside the RTL container. If a close
    // or an unmount stranded that portal subtree, its labels would leak into the
    // NEXT test's body-scoped queries and flake them ("found multiple
    // elements"). Open the dialog, unmount as the shared afterEach does, and
    // assert `document.body` is portal-free — the teardown contract the whole
    // jsdom project relies on for cross-file isolation.
    it("leaves no residual dialog portal in document.body after teardown", async () => {
        const { getByText, getByLabelText } = await renderLobby();
        fireEvent.click(getByText("Play vs AI"));
        // The portal is live while the dialog is open.
        expect(getByLabelText("AI Difficulty")).toBeTruthy();
        expect(
            document.querySelectorAll("[data-base-ui-portal]").length
        ).toBeGreaterThan(0);
        // Unmounting (what afterEach's cleanup() does) must reap the portal
        // synchronously — no stranded subtree left behind.
        cleanup();
        expect(document.querySelectorAll("[data-base-ui-portal]").length).toBe(
            0
        );
        expect(document.querySelectorAll('[data-slot^="dialog"]').length).toBe(
            0
        );
    });
});

// First-class Limited dashboard box (issue #1582): a Limited box sits
// alongside the constructed Play box with equal visual weight (both render
// through the same shared Panel), the old secondary "Limited Events" button
// is gone, and a seated event's status hint reaches the box through
// `useMyLimitedEvents` — the real hook wiring, not a hand-built prop.
describe("Lobby dashboard Limited box (issue #1582)", () => {
    it("renders the Limited box alongside the Play box, stacked via a responsive grid", async () => {
        const { getByText, getByRole, container } = await renderLobby();
        expect(getByText("Play")).toBeTruthy();
        expect(getByRole("heading", { name: "Limited" })).toBeTruthy();
        expect(getByText("Browse / Create Events")).toBeTruthy();
        // Same grid wrapper drives the narrow-viewport stack (grid-cols-1)
        // and the wide side-by-side layout (lg:grid-cols-2).
        const grid = container.querySelector(
            ".grid.grid-cols-1.lg\\:grid-cols-2"
        );
        expect(grid).toBeTruthy();
        expect(grid?.children.length).toBe(2);
    });

    it("removes the old secondary 'Limited Events' button (no duplicate entry point)", async () => {
        const { queryByText } = await renderLobby();
        expect(queryByText("Limited Events")).toBeNull();
    });

    it("navigates to the Limited events page from the box's Browse action", async () => {
        const { getByText } = await renderLobby();
        fireEvent.click(getByText("Browse / Create Events"));
        expect(navigate).toHaveBeenCalledWith({ to: "/limited" });
    });

    it("lists a seated event with its status hint and navigates to its detail on click", async () => {
        const { getByText } = await renderLobby([
            {
                _id: "event-1",
                createdBy: "admin-1",
                type: "sealed",
                status: "started",
                completed: true,
                seatCount: 2,
                seatsWithDeck: 2,
                packSlots: ["lea"],
                seats: [],
                createdAt: 0,
                updatedAt: 0,
            },
        ]);
        expect(getByText("Your Events")).toBeTruthy();
        expect(getByText("ready to play")).toBeTruthy();
        fireEvent.click(getByText("Limited Edition Alpha Sealed"));
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
        });
    });
});
