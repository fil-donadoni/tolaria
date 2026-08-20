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

// Controllable per-test: most tests want the pre-existing `[]` (My Decks
// empty), but the mode-filtering / renderUserActions tests below need a real
// user deck to filter and to render Edit/Delete actions on.
const useUserDecksMock = vi.fn<(...args: unknown[]) => unknown[]>(() => []);
const removeUserDeck = vi.fn().mockResolvedValue(undefined);
vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: (...args: unknown[]) => useUserDecksMock(...args),
    useUserDeckMutations: () => ({
        create: vi.fn(),
        update: vi.fn(),
        remove: removeUserDeck,
    }),
}));

// A Manual Deck user deck (issue #2591): the mode selector's filtering hides
// it in Arena mode and shows it in Cockatrice mode — the inverse of the two
// preset decks above (`format: "old-school"`, non-manual).
const MANUAL_USER_DECK = {
    kind: "user" as const,
    userDeckId: "userdeck-manual-1",
    presetId: "userdeck-manual-1",
    name: "My Manual Deck",
    format: "manual" as const,
    description: "Manual",
    colors: ["U"],
    cards: [{ id: "card-c", quantity: 4 }],
    sideboard: [],
    featuredCardId: null,
    isLegal: true,
    reasons: [],
};

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
    // `clearAllMocks` resets call history only, not a prior test's
    // `mockImplementation` override — re-pin the default explicitly so one
    // test's fixture never leaks into the next.
    useUserDecksMock.mockImplementation(() => []);
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
    it("clicking 'Play vs Bot' opens the dialog without firing the mutation", async () => {
        const { getByText, getAllByText, getByLabelText } = await renderLobby();
        // The Play panel button (issue #2591: "Play vs AI" → "Play vs Bot",
        // ADR 0101 §10). Before opening, no create mutation.
        fireEvent.click(getByText("Play vs Bot"));
        expect(createSoloGame).not.toHaveBeenCalled();
        // Dialog content is now present (the two vs-AI selectors). Match
        // Format is not among them — it governs Solo / Multiplayer too
        // and is picked in the Play box, so exactly one instance exists. The
        // dialog itself keeps its own "Play vs AI" title/confirm wording
        // (`vs-ai-setup-dialog.tsx` — out of this slice's scope): both now
        // present (title + confirm button).
        expect(getByLabelText("AI Difficulty")).toBeTruthy();
        expect(getByLabelText("AI Opponent Deck")).toBeTruthy();
        expect(getByLabelText("Match Format")).toBeTruthy();
        expect(getAllByText("Play vs AI").length).toBeGreaterThanOrEqual(2);
    });

    it("Confirm fires createSoloGame with the chosen bestOf and deck2", async () => {
        const { getByText, getAllByText, getByLabelText } = await renderLobby();
        fireEvent.click(getByText("Play vs Bot"));
        // Pick White Weenie as the AI opponent deck (deck2).
        fireEvent.change(getByLabelText("AI Opponent Deck"), {
            target: { value: "white-weenie" },
        });
        // Confirm — the dialog footer's "Play vs AI" button. Filter to actual
        // buttons (the dialog title is an <h2>, not a button).
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
        fireEvent.click(getByText("Play vs Bot"));
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
        fireEvent.click(getByText("Play vs Bot"));
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

// First-class Limited dashboard box (issue #1582, restyled to a full-width
// live strip by #2591 / ADR 0101 §9): a seated event's status hint reaches
// the box through `useMyLimitedEvents` — the real hook wiring, not a
// hand-built prop. The old secondary "Limited Events" button is gone.
describe("Lobby dashboard Limited box (issue #1582)", () => {
    it("renders the Limited strip and the Play box, each full width", async () => {
        const { getByText, getByRole } = await renderLobby();
        expect(getByText("Play")).toBeTruthy();
        expect(getByRole("heading", { name: "Limited" })).toBeTruthy();
        expect(getByText("Browse / Create Events")).toBeTruthy();
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
        // "Your Current Events" since #2357: the box reads the narrowed
        // `myCurrentLimitedEvents`, so a concluded event is no longer here —
        // it lives on `/limited/events` instead.
        expect(getByText("Your Current Events")).toBeTruthy();
        expect(getByText("ready to play")).toBeTruthy();
        fireEvent.click(getByText("Limited Edition Alpha Sealed"));
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
        });
    });
});

// Explicit game-mode selector (issue #2591, ADR 0101 §10): the mode DRIVES
// deck filtering (AC1) and clears an incompatible selection on toggle. Both
// halves were proven unguarded by review — deleting either the `.filter()`
// in `filteredUserDecks`/`filteredPresetDecks` or the `!stillCompatible`
// branch in `handlePlayModeChange` left this file's prior suite green.
describe("Lobby game-mode selector drives deck filtering (issue #2591)", () => {
    it("swaps which decks are listed when the mode toggles (My Decks + Preset Decks)", async () => {
        useUserDecksMock.mockReturnValue([MANUAL_USER_DECK]);
        // No stored selection here — isolates the LIST filter from the
        // Play box's selection-clearing behaviour (covered separately
        // below), and keeps "Mono Red Burn" a single DOM match (the deck
        // row only, not also the Play box hero name).
        localStorage.removeItem("tolaria:selectedDeckId");
        const { getByRole, queryByText, getByText } = await renderLobby();

        // Arena mode (default): the two non-manual preset decks are listed,
        // the Manual Deck is not.
        expect(getByText("Mono Red Burn")).toBeTruthy();
        expect(getByText("White Weenie")).toBeTruthy();
        expect(queryByText("My Manual Deck")).toBeNull();

        fireEvent.click(getByRole("radio", { name: "Cockatrice mode" }));

        // Cockatrice mode: the mode filter inverts — only the Manual Deck is
        // listed, the two non-manual presets disappear from both panels.
        expect(getByText("My Manual Deck")).toBeTruthy();
        expect(queryByText("Mono Red Burn")).toBeNull();
        expect(queryByText("White Weenie")).toBeNull();
    });

    it("clears an incompatible selection when the mode toggles (stale-selection guard)", async () => {
        // Stored selection is `mono-red-burn` (non-manual, via beforeEach) —
        // compatible with the default Arena mode. It renders twice while
        // selected (the deck row AND the Play box hero name).
        const { getByRole, getAllByText, getByText, queryByText } =
            await renderLobby();
        expect(getAllByText("Mono Red Burn").length).toBeGreaterThanOrEqual(2);

        fireEvent.click(getByRole("radio", { name: "Cockatrice mode" }));

        // The selected deck is no longer offered under Cockatrice mode, so
        // the stale selection must be cleared rather than silently carried
        // across the toggle (the Play box falls back to "No deck selected") —
        // if `handlePlayModeChange`'s `!stillCompatible` branch were removed,
        // the Play box would still show "Mono Red Burn" here even though the
        // filtered list no longer offers it.
        expect(queryByText("Mono Red Burn")).toBeNull();
        expect(getByText("No deck selected")).toBeTruthy();
    });
});

// Compact deck rows (PRD #2405 D15 / ADR 0101 §9, issue #2591): Delete moved
// behind DeckRowMenu's "⋯" overflow for both My Decks and Preset Decks. This
// exercises `renderUserActions` (a *real* user deck row, not the empty `[]`
// every other test in this file uses) end-to-end through the confirm dialog —
// restoring the old always-visible destructive Button here left the prior
// suite green because no test ever rendered a non-empty My Decks list.
describe("Lobby compact deck row actions (issue #2591)", () => {
    it("renders Edit + the '⋯' overflow (not an inline Delete button) and deletes through it", async () => {
        useUserDecksMock.mockReturnValue([MANUAL_USER_DECK]);
        localStorage.setItem("tolaria:playMode", "cockatrice");
        const { getByRole, queryByRole, getByText } = await renderLobby();

        expect(getByText("My Manual Deck")).toBeTruthy();
        // Edit stays a visible single tap.
        expect(getByRole("button", { name: "Edit" })).toBeTruthy();
        // No always-visible inline Delete button (the mutation the review
        // caught: restoring `<Button variant="destructive">Delete</Button>`
        // inline left the prior suite green because it was never rendered
        // against a non-empty deck list).
        expect(queryByRole("button", { name: "Delete" })).toBeNull();
        // Delete lives behind the overflow trigger, hidden until opened.
        expect(queryByRole("menuitem", { name: "Delete" })).toBeNull();

        fireEvent.click(
            getByRole("button", { name: "More actions for My Manual Deck" })
        );
        fireEvent.click(getByRole("menuitem", { name: "Delete" }));

        // The confirm dialog (GameDialog) — never a native confirm().
        expect(
            getByRole("heading", { name: 'Delete "My Manual Deck"?' })
        ).toBeTruthy();
        fireEvent.click(getByRole("button", { name: "Delete" }));

        await vi.waitFor(() => {
            expect(removeUserDeck).toHaveBeenCalledWith({
                id: "userdeck-manual-1",
            });
        });
    });
});
