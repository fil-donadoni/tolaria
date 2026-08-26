// The lobby as a game main menu (ADR 0103 §6, issue #2726), end to end:
// Mode Tiles · Loadout · Deck Shelves · Limited footer, over the real wiring.
//
// The one structural fact these tests lean on: a Mode Tile SELECTS, it never
// starts anything — the single ivory primary action in the Loadout does, and
// it takes the selected tile's title as its ACCESSIBLE NAME (the trailing
// arrow is `aria-hidden`). So `getByRole("button", { name: "Play vs Bot" })`
// is the action and `[data-mode-tile="bot"]` is the tile; a tile's own
// accessible name is its whole visible text (chip + title + line), which is
// why the two never collide.
//
// Also covered here, unchanged in substance from before the restyle: the
// two-step vs-AI flow (dialog, then Confirm fires `createSoloGame` with the
// chosen `bestOf` + `deck2`), the Limited footer's wiring, inline Open-Events
// join, game-mode-driven deck filtering, deck-tile overflow actions, and
// join-by-code. See `../lobby`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ConvexError } from "convex/values";
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
const joinGameByCode = vi.fn().mockResolvedValue({ gameId: "game-9" });
const deletePreset = vi.fn();
const joinLimitedEvent = vi.fn().mockResolvedValue(null);

/** How the Convex client ACTUALLY rejects a mutation — NOT `new Error(msg)`.
 *
 *  What reaches a `.catch` is an envelope: `message` is
 *  "[CONVEX M(fn)] [Request ID: …] Server Error", and on a PRODUCTION
 *  deployment that is ALL it is — the inner message is redacted on the way out
 *  (`src/lib/mutation-error.ts`). Only a `ConvexError`'s `data` crosses intact,
 *  which is why the server throws one and the dialog reads it through
 *  `extractMutationErrorMessage`.
 *
 *  A mock that hands the component a bare `Error` whose `message` IS the
 *  user-facing sentence tests a client that does not exist: it is green against
 *  a component rendering `e.message` raw, which in production shows the user
 *  "Server Error" and nothing else. Every rejection mock in this file goes
 *  through here (issue #2649 review). */
function convexRejection(fn: string, payload: string): ConvexError<string> {
    const error = new ConvexError(payload);
    error.message = `[CONVEX M(${fn})] [Request ID: 5f4d3c2b1a09] Server Error`;
    return error;
}

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
        // The one fixture deck with resolvable art: the ambient layer only
        // renders for a deck that HAS a Featured Card, which is what makes
        // "selecting a deck swaps the ambient" (AC #3) falsifiable below.
        featuredCardId: "print-white-weenie",
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

/** One open (waiting) table, as `api.game.listOpenGames` returns it: a games
 *  doc plus its Match's `bestOf` (PRD #387/#397). `mode` decides which join
 *  mutation an `OpenTablesStrip` row would dispatch, so it is what makes a row
 *  mode-compatible or not. */
function makeOpenGame(overrides: Record<string, unknown> = {}) {
    return {
        _id: "game-open-1",
        _creationTime: 0,
        name: "Someone's game",
        mode: "standard",
        status: "waiting",
        bestOf: 1 as const,
        players: [{ id: "user-2", nickname: "Opponent" }],
        ...overrides,
    };
}

async function renderLobby(
    myLimitedEvents: unknown[] = [],
    openLimitedEvents: unknown[] = [],
    openGames: unknown[] = []
) {
    // `api` is mocked to `{}`, so queries can't be distinguished by reference;
    // route by per-render call order instead. The lobby issues exactly FIVE
    // useQuery calls per render, in this order: presetDecks, openGames,
    // activeGame, myLimitedEvents (issue #1582 — via
    // `useMyCurrentLimitedEvents`), openLimitedEvents (issue #2648 — via
    // `useOpenLimitedEvents`; currentUser/userDecks go through mocked hooks).
    // Adding a SIXTH `useQuery` call inside `Lobby` shifts this modulo AND
    // this branch count together — update both in the same change.
    let queryCall = 0;
    useQueryMock.mockImplementation(() => {
        const idx = queryCall++;
        if (idx % 5 === 0) return PRESET_DECKS;
        if (idx % 5 === 1) return openGames;
        if (idx % 5 === 2) return null;
        if (idx % 5 === 3) return myLimitedEvents;
        return openLimitedEvents;
    });
    let mutCall = 0;
    useMutationMock.mockImplementation(() => {
        const idx = mutCall++;
        // Order must mirror the `useMutation` calls in `lobby.tsx`:
        // deletePreset, createGame, createSoloGame, createManualSoloGame,
        // createManualGame, joinGame, joinManualGame, joinLimitedEvent (issue
        // #2648), joinGameByCode (issue #2649). Wiring a mutation at the Lobby
        // level extends this array — update its length AND the doc comment
        // together. APPEND ONLY: a hook inserted mid-list in `lobby.tsx`
        // re-routes every mock after it with NO failing assertion, so this
        // array's order and `lobby.tsx`'s `useMutation` order must match
        // element for element.
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
            joinLimitedEvent,
            joinGameByCode,
        ];
        return handlers[idx % handlers.length];
    });
    return render(<Lobby />);
}

/** A Mode Tile, by key. Tiles are art-backed toggle buttons whose accessible
 *  name is their whole visible text, so `data-mode-tile` is the stable seam —
 *  the same attribute `lobby-mode-tile.tsx` documents as one. */
function modeTile(container: HTMLElement, key: string): HTMLButtonElement {
    const el = container.querySelector<HTMLButtonElement>(
        `[data-mode-tile="${key}"]`
    );
    if (!el) throw new Error(`no Mode Tile for "${key}"`);
    return el;
}

describe("Lobby Mode Tiles name the primary action (issue #2726)", () => {
    it("opens on the Bot tile selected, with the primary action named after it", async () => {
        const { container, getByRole } = await renderLobby();
        expect(modeTile(container, "bot").getAttribute("aria-pressed")).toBe(
            "true"
        );
        expect(getByRole("button", { name: "Play vs Bot" })).toBeTruthy();
    });

    it("selecting another tile RENAMES the primary action (AC #3)", async () => {
        const { container, getByRole, queryByRole } = await renderLobby();
        fireEvent.click(modeTile(container, "table"));
        expect(getByRole("button", { name: "Open a table" })).toBeTruthy();
        expect(queryByRole("button", { name: "Play vs Bot" })).toBeNull();
        expect(modeTile(container, "table").getAttribute("aria-pressed")).toBe(
            "true"
        );
    });

    it("a tile click starts nothing on its own — only the primary action does", async () => {
        const { container, getByRole } = await renderLobby();
        fireEvent.click(modeTile(container, "solo"));
        expect(createSoloGame).not.toHaveBeenCalled();
        fireEvent.click(getByRole("button", { name: "Solo game" }));
        await vi.waitFor(() => {
            expect(createSoloGame).toHaveBeenCalledTimes(1);
        });
        expect(createSoloGame.mock.calls[0][0].vsAi).toBeUndefined();
    });

    it("the Cockatrice tile set swaps 'Play vs Bot' / 'Solo game' for 'Solo table'", async () => {
        useUserDecksMock.mockReturnValue([MANUAL_USER_DECK]);
        localStorage.setItem("tolaria:playMode", "cockatrice");
        localStorage.setItem("tolaria:selectedDeckId", "userdeck-manual-1");
        const { container, getByRole } = await renderLobby();
        expect(container.querySelector('[data-mode-tile="bot"]')).toBeNull();
        expect(container.querySelector('[data-mode-tile="solo"]')).toBeNull();
        // The stranded "bot" key resolves to the first OFFERED tile, so the
        // primary action names something the grid actually shows.
        expect(getByRole("button", { name: "Solo table" })).toBeTruthy();
    });

    it("the Limited tile's action needs no deck at all", async () => {
        localStorage.removeItem("tolaria:selectedDeckId");
        const { container, getByRole } = await renderLobby();
        fireEvent.click(modeTile(container, "limited"));
        const browse = getByRole("button", {
            name: "Limited",
        }) as HTMLButtonElement;
        expect(browse.disabled).toBe(false);
        fireEvent.click(browse);
        expect(navigate).toHaveBeenCalledWith({ to: "/limited" });
    });

    it("selecting a deck from a shelf swaps the Loadout AND the ambient (AC #3)", async () => {
        localStorage.removeItem("tolaria:selectedDeckId");
        const { baseElement, getByRole, getByText, queryByText } =
            await renderLobby();
        expect(getByText("No deck selected")).toBeTruthy();
        // No selection → no deck art behind the menu.
        expect(baseElement.querySelector("[data-lobby-ambient]")).toBeNull();

        fireEvent.click(getByRole("button", { name: "Select White Weenie" }));

        // Loadout swapped...
        expect(queryByText("No deck selected")).toBeNull();
        expect(localStorage.getItem("tolaria:selectedDeckId")).toBe(
            "white-weenie"
        );
        // ...and the ambient with it, from the deck's own Featured Card.
        const art = baseElement.querySelector<HTMLImageElement>(
            "[data-lobby-ambient] img"
        );
        expect(art).not.toBeNull();
        expect(art!.getAttribute("src")).toContain("print-white-weenie");
    });
});

describe("Lobby vs-AI two-step flow", () => {
    it("running the 'Play vs Bot' primary action opens the dialog without firing the mutation", async () => {
        const { getByRole, getAllByText, getByLabelText } = await renderLobby();
        // The Loadout's one ivory plate, named by the selected Mode Tile
        // (issue #2726; the label itself is #2591's "Play vs AI" → "Play vs
        // Bot", ADR 0101 §10). Before opening, no create mutation.
        fireEvent.click(getByRole("button", { name: "Play vs Bot" }));
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
        const { getByRole, getAllByText, getByLabelText } = await renderLobby();
        fireEvent.click(getByRole("button", { name: "Play vs Bot" }));
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
        const { getByRole, getByText, queryByLabelText } = await renderLobby();
        fireEvent.click(getByRole("button", { name: "Play vs Bot" }));
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
        const { getByRole, getByLabelText } = await renderLobby();
        fireEvent.click(getByRole("button", { name: "Play vs Bot" }));
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
    it("renders the Limited footer alongside the Mode Tiles and the Loadout", async () => {
        const { container, getByText, getByRole } = await renderLobby();
        expect(getByRole("group", { name: "Game modes" })).toBeTruthy();
        expect(
            container.querySelector('[data-mode-tile="limited"]')
        ).toBeTruthy();
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

// Open events joinable inline (issue #2648, ADR 0101 §9): the dashboard's
// "Open Events" row, wired through `useOpenLimitedEvents` and the REAL
// `useJoinLimitedEvent` hook (not stubbed — it's plain React state over the
// injected `joinLimitedEvent` mutation, exercised here end-to-end through the
// actual Lobby component: mutation call, error surfacing, and the
// navigate-on-success it shares with `/limited`'s own Join row).
describe("Lobby dashboard Open Events join (issue #2648)", () => {
    function makeOpenEvent(overrides: Record<string, unknown> = {}) {
        return {
            _id: "event-open-1",
            createdBy: "admin-1",
            type: "sealed",
            status: "open",
            matchFormat: "bo3",
            completed: false,
            seatCount: 2,
            seatsWithDeck: 0,
            packSlots: ["lea"],
            seats: [
                {
                    seatIndex: 0,
                    isBot: false,
                    isViewer: false,
                    poolCount: null,
                    hasDeck: false,
                },
                {
                    seatIndex: 1,
                    isBot: false,
                    isViewer: false,
                    poolCount: null,
                    hasDeck: false,
                },
            ],
            createdAt: 0,
            updatedAt: 0,
            ...overrides,
        };
    }

    it("renders an Open Events row for a joinable event", async () => {
        const { getByText } = await renderLobby([], [makeOpenEvent()]);
        expect(getByText("Open Events")).toBeTruthy();
        expect(getByText("Limited Edition Alpha Sealed")).toBeTruthy();
        expect(getByText("Join")).toBeTruthy();
    });

    it("fires the real joinLimitedEvent mutation and navigates to the event on success", async () => {
        const { getByText } = await renderLobby([], [makeOpenEvent()]);
        fireEvent.click(getByText("Join"));
        await vi.waitFor(() => {
            expect(joinLimitedEvent).toHaveBeenCalledWith({
                eventId: "event-open-1",
            });
        });
        await vi.waitFor(() => {
            expect(navigate).toHaveBeenCalledWith({
                to: "/limited/$eventId",
                params: { eventId: "event-open-1" },
            });
        });
    });

    it("surfaces a rejected Join as a banner instead of navigating", async () => {
        joinLimitedEvent.mockRejectedValueOnce(
            new Error("You already have a seat in this event.")
        );
        const { getByText } = await renderLobby([], [makeOpenEvent()]);
        fireEvent.click(getByText("Join"));
        await vi.waitFor(() => {
            expect(
                getByText("You already have a seat in this event.")
            ).toBeTruthy();
        });
        expect(navigate).not.toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-open-1" },
        });
    });

    // Trap #1 guard, exercised through the real Lobby wiring this time (the
    // narrowing itself — `isLimitedEventJoinable` — is unit-covered in
    // `dashboard-limited-box.test.tsx`; this proves the query result actually
    // reaches that narrowing rather than being rendered raw).
    it("does not offer Join for an event the viewer already holds a Seat in", async () => {
        const { queryByText } = await renderLobby(
            [],
            [
                makeOpenEvent({
                    seats: [
                        {
                            seatIndex: 0,
                            userId: "user-1",
                            isBot: false,
                            isViewer: true,
                            poolCount: null,
                            hasDeck: false,
                        },
                        {
                            seatIndex: 1,
                            isBot: false,
                            isViewer: false,
                            poolCount: null,
                            hasDeck: false,
                        },
                    ],
                }),
            ]
        );
        expect(queryByText("Open Events")).toBeNull();
        expect(queryByText("Join")).toBeNull();
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

// Deck Shelf tile actions (ADR 0103 §6, issue #2726; carries forward PRD
// #2405 D15 / ADR 0101 §9, issue #2591). A shelf tile spends its own click on
// SELECTING the deck, so Open / Edit / Delete moved behind the "⋯" overflow —
// Edit stays a visible single tap for the deck that matters most, the SELECTED
// one, on the Loadout. This exercises a *real* user deck row (not the empty
// `[]` most tests in this file use) end-to-end through the confirm dialog:
// restoring an always-visible destructive Delete left the prior suite green
// because no test ever rendered a non-empty deck collection.
describe("Lobby deck shelf tile actions (issue #2726)", () => {
    beforeEach(() => {
        useUserDecksMock.mockReturnValue([MANUAL_USER_DECK]);
        localStorage.setItem("tolaria:playMode", "cockatrice");
        localStorage.setItem("tolaria:selectedDeckId", "userdeck-manual-1");
    });

    it("keeps Edit a single tap for the selected deck and no inline Delete anywhere", async () => {
        const { getByRole, queryByRole, getAllByText } = await renderLobby();
        // Twice: the shelf tile it was picked from, and the Loadout it now
        // fills.
        expect(getAllByText("My Manual Deck").length).toBe(2);
        expect(getByRole("button", { name: "Edit" })).toBeTruthy();
        // Nothing destructive is one stray click away — not as a button, and
        // not as an already-open menu item.
        expect(queryByRole("button", { name: "Delete" })).toBeNull();
        expect(queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });

    it("deletes through the tile overflow, via the in-app confirm dialog", async () => {
        const { getByRole } = await renderLobby();
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

    it("opens the deck's detail page from the same overflow", async () => {
        const { getByRole } = await renderLobby();
        fireEvent.click(
            getByRole("button", { name: "More actions for My Manual Deck" })
        );
        fireEvent.click(getByRole("menuitem", { name: "Open" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/$slug",
            params: { slug: "userdeck-manual-1" },
        });
    });

    it("edits through the same overflow", async () => {
        const { getByRole } = await renderLobby();
        fireEvent.click(
            getByRole("button", { name: "More actions for My Manual Deck" })
        );
        fireEvent.click(getByRole("menuitem", { name: "Edit" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/$slug/edit",
            params: { slug: "userdeck-manual-1" },
        });
    });
});

// Preset ADMIN gating, the whole of it (round-2 review, finding 3). Every
// preset-editing affordance the lobby can offer has to be absent for a
// non-admin, not merely rejected on arrival: `/presets/$slug/edit` carries no
// client guard, so a non-admin who reaches it gets an editor whose save dies at
// the server's `assertIsAdmin`. `canEditPresets` is mocked false for this whole
// file, and `beforeEach` selects a PRESET (`mono-red-burn`) — the default start
// state, which is exactly the state that shipped the offered-Edit bug.
describe("Lobby withholds preset editing from a non-admin (issue #2726)", () => {
    it("offers a preset tile's overflow neither Edit nor Delete", async () => {
        const { getByRole, queryByRole } = await renderLobby();
        fireEvent.click(
            getByRole("button", { name: "More actions for White Weenie" })
        );
        // Open survives — it is the one action a shelf tile cannot show
        // inline, and it needs no rights at all.
        expect(getByRole("menuitem", { name: "Open" })).toBeTruthy();
        expect(queryByRole("menuitem", { name: "Edit" })).toBeNull();
        expect(queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });

    it("offers NO Loadout Edit while the active deck is a preset", async () => {
        const { getAllByText, queryByRole } = await renderLobby();
        // The preset really is the active deck — otherwise the assertion
        // below would pass on an empty Loadout. Twice: the shelf tile it was
        // picked from, and the Loadout it now fills.
        expect(getAllByText("Mono Red Burn").length).toBe(2);
        expect(queryByRole("button", { name: "Edit" })).toBeNull();
        // "Change deck" is NOT rights-gated and must survive the withholding.
        expect(queryByRole("button", { name: "Change deck" })).toBeTruthy();
    });

    it("keeps the Loadout Edit for a USER deck, which needs no admin right", async () => {
        useUserDecksMock.mockReturnValue([MANUAL_USER_DECK]);
        localStorage.setItem("tolaria:playMode", "cockatrice");
        localStorage.setItem("tolaria:selectedDeckId", "userdeck-manual-1");
        const { getByRole } = await renderLobby();
        fireEvent.click(getByRole("button", { name: "Edit" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/$slug/edit",
            params: { slug: "userdeck-manual-1" },
        });
    });
});

// The SHARED gate reaching `OpenTablesStrip` (round-2 review, finding 4).
// `lobbyGate.ts` was extracted so a table row can never be joinable under a
// condition the Loadout's primary action refuses — and nothing proved the
// lobby actually spends that gate on the strip, because no test in this file
// ever seeded an open game, so the strip never rendered at all. These do.
describe("Lobby spends the shared gate on open-table rows (issue #2726)", () => {
    it("disables the row when the gate refuses (no deck selected)", async () => {
        localStorage.removeItem("tolaria:selectedDeckId");
        const { getByRole, getByText } = await renderLobby(
            [],
            [],
            [makeOpenGame()]
        );
        expect(getByText("Open tables to join")).toBeTruthy();
        const join = getByRole("button", {
            name: /Someone's game/,
        }) as HTMLButtonElement;
        expect(join.disabled).toBe(true);
    });

    it("enables the same row once the gate allows (deck selected)", async () => {
        const { getByRole } = await renderLobby([], [], [makeOpenGame()]);
        const join = getByRole("button", {
            name: /Someone's game/,
        }) as HTMLButtonElement;
        expect(join.disabled).toBe(false);
        fireEvent.click(join);
        await vi.waitFor(() => {
            expect(joinGame).toHaveBeenCalledWith(
                expect.objectContaining({ gameId: "game-open-1" })
            );
        });
    });
});

// The ui-gate board walk, executed against the real lobby (round-2 review,
// finding 2). `ensureBoard` (`scripts/ui-gate/surfaces.ts`) reaches a live
// board through three ATTRIBUTE hooks, because none of the three controls
// carries a stable string: a Deck Shelf tile's text is the deck NAME, and the
// Loadout's plate is named by whichever Mode Tile is selected. happy-dom cannot
// prove the walk's LAYOUT assumptions, but it can prove the hooks exist, are
// addressable by the exact selectors the walk uses, and dispatch the solo
// game — which is the half that broke silently when the v3 literals
// (`:has-text('Select')`, `:has-text('Solo Game')`) stopped matching and sent
// `game-board` + `game-stress` UNWALKED at all five viewports.
describe("Lobby drives the ui-gate board walk (issue #2726)", () => {
    // Byte-identical to `ensureBoard`'s constants. If these drift, the walk
    // reds instead of this file, which is the wrong place to find out.
    const DECK_TILE_SELECT =
        "[data-deck-tile] [data-deck-select]:not([disabled])";
    const MODE_TILE_SOLO = '[data-mode-tile="solo"]';
    const LOBBY_PRIMARY = "[data-lobby-primary]:not([disabled])";

    it("reaches a solo game through the walk's own selectors", async () => {
        localStorage.removeItem("tolaria:selectedDeckId");
        const { container } = await renderLobby();

        // Step 3 of the runbook: no deck yet, so the plate is gated and the
        // walk's `:not([disabled])` form matches nothing.
        expect(container.querySelector(LOBBY_PRIMARY)).toBeNull();
        const deckTile =
            container.querySelector<HTMLButtonElement>(DECK_TILE_SELECT);
        expect(deckTile).not.toBeNull();
        fireEvent.click(deckTile!);

        // Step 4: the Mode Tile SELECTS. Still nothing started.
        const solo = container.querySelector<HTMLButtonElement>(MODE_TILE_SOLO);
        expect(solo).not.toBeNull();
        fireEvent.click(solo!);
        expect(createSoloGame).not.toHaveBeenCalled();

        // Step 5: the plate — now ungated, and now reading "Solo game".
        const primary =
            container.querySelector<HTMLButtonElement>(LOBBY_PRIMARY);
        expect(primary).not.toBeNull();
        expect(primary!.textContent).toContain("Solo game");
        fireEvent.click(primary!);
        await vi.waitFor(() => {
            expect(createSoloGame).toHaveBeenCalledTimes(1);
        });
        expect(createSoloGame.mock.calls[0][0].vsAi).toBeUndefined();
    });

    it("marks an already-selected tile disabled, which is how the walk skips the step", async () => {
        const { container } = await renderLobby();
        // `beforeEach` selects `mono-red-burn`; its tile carries the
        // selected flag the walk probes and its button is out of the
        // selectable set.
        expect(
            container.querySelectorAll('[data-deck-tile][data-selected="true"]')
                .length
        ).toBe(1);
        const selectable = container.querySelectorAll(DECK_TILE_SELECT);
        expect(selectable.length).toBe(PRESET_DECKS.length - 1);
    });
});

// Deck creation stays reachable from the shelf headers, and the admin-only
// preset creator stays absent for a non-admin (`canEditPresets` is mocked
// false for this whole file).
describe("Lobby deck shelf headers (issue #2726)", () => {
    it("offers '+ New Deck' and carries the Format filter into the builder", async () => {
        localStorage.setItem("tolaria:deckFormatFilter", "premodern");
        const { getByRole } = await renderLobby();
        fireEvent.click(getByRole("button", { name: "+ New Deck" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/create",
            search: { format: "premodern" },
        });
    });

    it("withholds '+ New Preset' from a non-admin", async () => {
        const { queryByRole } = await renderLobby();
        expect(queryByRole("button", { name: "+ New Preset" })).toBeNull();
    });
});

// "Join by code" (issue #2649) — the frontend half of the wiring analysis:
// the Arena action set offers the 4th action, it opens a dialog rather than
// firing anything, and Confirm reaches `api.game.joinGameByCode` with the
// NORMALIZED code. A code is never resolved to a game id client-side, so
// there is no lookup query to assert on — the mutation call IS the contract.
describe("Lobby join-by-code flow (issue #2649)", () => {
    it("offers 'Join by code' in Arena mode and opens the dialog without joining", async () => {
        const { getByText, getByLabelText } = await renderLobby();
        fireEvent.click(getByText("Join by code"));
        expect(joinGameByCode).not.toHaveBeenCalled();
        expect(getByLabelText(/Join code/i)).toBeTruthy();
    });

    it("does NOT offer it in Cockatrice mode", async () => {
        localStorage.setItem("tolaria:playMode", "cockatrice");
        const { queryByText } = await renderLobby();
        expect(queryByText("Join by code")).toBeNull();
    });

    it("submits the code NORMALIZED, not as typed", async () => {
        const { getByText, getByLabelText, getByRole } = await renderLobby();
        fireEvent.click(getByText("Join by code"));
        // Typed the way a human would after hearing it read out: lower case,
        // with the grouping dash, and with an "oh" for the zero.
        fireEvent.change(getByLabelText(/Join code/i), {
            target: { value: "k3m-9xo" },
        });
        fireEvent.click(getByRole("button", { name: "Join table" }));
        await vi.waitFor(() => {
            expect(joinGameByCode).toHaveBeenCalledTimes(1);
        });
        expect(joinGameByCode.mock.calls[0]![0].code).toBe("K3M9X0");
    });

    it("keeps Join inert until six alphabet characters are present", async () => {
        const { getByText, getByLabelText, getByRole } = await renderLobby();
        fireEvent.click(getByText("Join by code"));
        const join = getByRole("button", { name: "Join table" });
        expect((join as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(getByLabelText(/Join code/i), {
            target: { value: "K3M9X" },
        });
        expect((join as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(getByLabelText(/Join code/i), {
            target: { value: "K3M9XZ" },
        });
        expect((join as HTMLButtonElement).disabled).toBe(false);
    });

    it("shows the server's rejection in the dialog instead of closing it", async () => {
        joinGameByCode.mockRejectedValueOnce(
            convexRejection(
                "game:joinGameByCode",
                "That join code doesn't match a table that's open right now."
            )
        );
        const {
            getByText,
            getByLabelText,
            getByRole,
            findByRole,
            queryByRole,
        } = await renderLobby();
        fireEvent.click(getByText("Join by code"));
        fireEvent.change(getByLabelText(/Join code/i), {
            target: { value: "ZZZZZZ" },
        });
        fireEvent.click(getByRole("button", { name: "Join table" }));
        const alert = await findByRole("alert");
        expect(alert.textContent).toContain("open right now");
        // Still open — the user has to see WHY before retyping.
        expect(getByLabelText(/Join code/i)).toBeTruthy();
        expect(navigate).not.toHaveBeenCalledWith({ to: "/game" });

        // Reopening starts clean: a stale rejection banner would read as a
        // verdict on the code the user is about to type.
        fireEvent.click(getByRole("button", { name: "Cancel" }));
        fireEvent.click(getByText("Join by code"));
        expect(queryByRole("alert")).toBeNull();
        expect((getByLabelText(/Join code/i) as HTMLInputElement).value).toBe(
            ""
        );
    });
});
