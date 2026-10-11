// The lobby home (PRD #5334 stories 1–14, issue #5344) over its real wiring:
// the four sections in order, Play again sending the remembered setup
// without opening the flow, change setup / Constructed / Limited routing,
// Your Tables naming and its Show all cap, and the Decks section's Format
// filter, deck-or-card search and New Deck.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
// Static import: `vi.mock` is hoisted above all imports, so the lobby module
// graph loads fully mocked; importing it during collection keeps its one-time
// transform off the per-test timeout budget.
import Lobby from "../lobby";
import { MATCH_SETUP_STORAGE_KEY } from "~/lib/matchSetup";

const navigate = vi.fn();
const createSoloGame = vi.fn().mockResolvedValue("solo-game-1");

const PRESET_DECKS = [
    {
        presetId: "mono-red-burn",
        name: "Mono Red Burn",
        format: "old-school",
        colors: ["R"],
        cards: [{ id: "card-a", cardName: "Lightning Bolt", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
    {
        presetId: "white-weenie",
        name: "White Weenie",
        format: "old-school",
        colors: ["W"],
        cards: [{ id: "card-b", cardName: "Savannah Lions", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
    {
        presetId: "premodern-elves",
        name: "Premodern Elves",
        format: "premodern",
        colors: ["G"],
        cards: [{ id: "card-c", cardName: "Llanowar Elves", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
    },
];

// `api` resolves every access to a token carrying its dotted path, so the
// mocks dispatch by FUNCTION, never by call order.
vi.mock("@convex/_generated/api", () => {
    const ref = (path: string): unknown =>
        new Proxy(
            { path },
            {
                get: (target, key) =>
                    key === "path"
                        ? target.path
                        : ref(path ? `${path}.${String(key)}` : String(key)),
            }
        );
    return { api: ref("") };
});

const queries: Record<string, unknown> = {};
const mutations: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("convex/react", () => ({
    useQuery: (fn: { path: string }, args: unknown) =>
        args === "skip" ? undefined : queries[fn.path],
    useMutation: (fn: { path: string }) =>
        mutations[fn.path] ?? vi.fn().mockResolvedValue(null),
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Tester" }),
}));
vi.mock("~/hooks/usePageVisible", () => ({ usePageVisible: () => true }));

const useUserDecksMock = vi.fn<() => unknown[]>(() => []);
vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => useUserDecksMock(),
}));

const myEvents = vi.fn<() => unknown[]>(() => []);
vi.mock("~/hooks/useLimitedEvent", () => ({
    useMyCurrentLimitedEvents: () => myEvents(),
}));

vi.mock("../lobby-background", () => ({ default: () => null }));

/** Arena · Bot · Old School (93/94) · Bo3 · Mono Red Burn vs White Weenie. */
const BOT_SETUP = {
    mode: "arena",
    opponent: "bot",
    matchFormat: "old-school",
    gamesFormat: 3,
    myDeckId: "mono-red-burn",
    opponentDeckId: "white-weenie",
    opponentDeckChosen: true,
    difficulty: "hard",
    joinTableId: null,
    joinTableFormat: null,
};

beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    useUserDecksMock.mockImplementation(() => []);
    myEvents.mockImplementation(() => []);
    for (const k of Object.keys(queries)) delete queries[k];
    queries["decks.list"] = PRESET_DECKS;
    queries["gameReads.listOpenGames"] = [];
    queries["gameReads.myActiveGame"] = null;
    mutations["game.createSoloGame"] = createSoloGame;
});

const sections = (c: HTMLElement) =>
    [...c.querySelectorAll("[data-home-section]")].map((e) =>
        e.getAttribute("data-home-section")
    );

describe("Lobby home — sections (stories 1, 5, 6, 10)", () => {
    it("renders Last Match, Play, Your Tables and Decks in that order", () => {
        localStorage.setItem(
            MATCH_SETUP_STORAGE_KEY,
            JSON.stringify(BOT_SETUP)
        );
        const { container } = render(<Lobby />);
        expect(sections(container)).toEqual([
            "last-match",
            "play",
            "tables",
            "decks",
        ]);
    });

    it("omits Last Match while no setup can be replayed", () => {
        const { container } = render(<Lobby />);
        expect(sections(container)).toEqual(["play", "tables", "decks"]);
    });
});

describe("Lobby home — Last Match (stories 1–4)", () => {
    it("names both decks and the setup", () => {
        localStorage.setItem(
            MATCH_SETUP_STORAGE_KEY,
            JSON.stringify(BOT_SETUP)
        );
        const { getByText } = render(<Lobby />);
        expect(getByText("Mono Red Burn vs White Weenie")).toBeTruthy();
        expect(
            getByText("Last Match · Arena · Bot · Old School (93/94) · Bo3")
        ).toBeTruthy();
    });

    it("Play again starts the saved setup without opening the flow", async () => {
        localStorage.setItem(
            MATCH_SETUP_STORAGE_KEY,
            JSON.stringify(BOT_SETUP)
        );
        const { getByRole } = render(<Lobby />);
        fireEvent.click(getByRole("button", { name: "Play again →" }));
        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({ to: "/game" })
        );
        expect(createSoloGame).toHaveBeenCalledTimes(1);
        const args = createSoloGame.mock.calls[0][0];
        expect(args).toMatchObject({
            vsAi: true,
            bestOf: 3,
            matchFormat: "old-school",
        });
        expect(args.deck.id).toBe("mono-red-burn");
        expect(args.deck2.id).toBe("white-weenie");
        expect(navigate).not.toHaveBeenCalledWith({ to: "/play/constructed" });
        // The Bot seat: one user holds both seats.
        expect(localStorage.getItem("tolaria:playerId")).toBe("user-1-p1");
    });

    it("Play again is refused while a game is active (#155)", () => {
        localStorage.setItem(
            MATCH_SETUP_STORAGE_KEY,
            JSON.stringify(BOT_SETUP)
        );
        queries["gameReads.myActiveGame"] = {
            gameId: "game-7",
            matchId: "match-7",
            name: "Tester vs Bot",
            status: "playing",
            matchStatus: "active",
            solo: true,
            vsAi: true,
            mode: null,
        };
        const { getByRole } = render(<Lobby />);
        const button = getByRole("button", { name: "Play again →" });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(button);
        expect(createSoloGame).not.toHaveBeenCalled();
    });

    it("change setup opens the flow", () => {
        localStorage.setItem(
            MATCH_SETUP_STORAGE_KEY,
            JSON.stringify(BOT_SETUP)
        );
        const { getByRole } = render(<Lobby />);
        fireEvent.click(getByRole("button", { name: "change setup" }));
        expect(navigate).toHaveBeenCalledWith({ to: "/play/constructed" });
        expect(createSoloGame).not.toHaveBeenCalled();
    });
});

describe("Lobby home — Play (story 5)", () => {
    it("Constructed opens the flow, Limited the Limited branch", () => {
        const { container } = render(<Lobby />);
        fireEvent.click(
            container.querySelector('[data-home-play="constructed"]')!
        );
        expect(navigate).toHaveBeenCalledWith({ to: "/play/constructed" });
        fireEvent.click(container.querySelector('[data-home-play="limited"]')!);
        expect(navigate).toHaveBeenCalledWith({ to: "/limited" });
    });
});

describe("Lobby home — Your Tables (stories 6–9)", () => {
    const event = (id: string, status: string) => ({
        _id: id,
        type: "draft",
        packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
        status,
        completed: false,
    });

    it("names the Match by opponent kind and events by pool and phase", () => {
        queries["gameReads.myActiveGame"] = {
            gameId: "game-7",
            matchId: "match-7",
            name: "Tester vs Bot",
            status: "playing",
            matchStatus: "active",
            solo: true,
            vsAi: true,
            mode: null,
        };
        myEvents.mockImplementation(() => [event("ev-1", "open")]);
        const { container, getByText } = render(<Lobby />);
        const tiles = [...container.querySelectorAll("[data-home-table]")];
        expect(tiles.map((t) => t.textContent)).toEqual([
            "In progressConstructedvs Bot",
            "Waiting for playersVintage Cube DraftLimited",
        ]);
        expect(getByText("Your Tables · 2")).toBeTruthy();

        fireEvent.click(tiles[0]);
        expect(localStorage.getItem("tolaria:playerId")).toBe("user-1-p1");
        expect(navigate).toHaveBeenCalledWith({ to: "/game" });
        fireEvent.click(tiles[1]);
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "ev-1" },
        });
    });

    it("caps the tiles to one row and Show all lifts the cap", () => {
        myEvents.mockImplementation(() =>
            ["a", "b", "c"].map((id) => event(id, "started"))
        );
        const { container, getByRole } = render(<Lobby />);
        const grid = () => container.querySelector("[data-tables-capped]")!;
        expect(grid().getAttribute("data-tables-capped")).toBe("true");
        fireEvent.click(getByRole("button", { name: "Show all (3)" }));
        expect(grid().getAttribute("data-tables-capped")).toBe("false");
        fireEvent.click(getByRole("button", { name: "Show less" }));
        expect(grid().getAttribute("data-tables-capped")).toBe("true");
    });

    it("offers no Show all when one row holds every table", () => {
        myEvents.mockImplementation(() => [event("a", "started")]);
        const { queryByRole } = render(<Lobby />);
        expect(queryByRole("button", { name: /Show all/ })).toBeNull();
    });
});

describe("Lobby home — Decks (stories 10–14)", () => {
    const deckIds = (c: HTMLElement) =>
        [...c.querySelectorAll("[data-home-deck]")].map((e) =>
            e.getAttribute("data-home-deck")
        );

    it("filters by Format and by deck or card name", () => {
        const { container, getByLabelText, getByText } = render(<Lobby />);
        expect(deckIds(container)).toEqual([
            "mono-red-burn",
            "white-weenie",
            "premodern-elves",
        ]);
        fireEvent.change(getByLabelText("Filter decks by format"), {
            target: { value: "premodern" },
        });
        expect(deckIds(container)).toEqual(["premodern-elves"]);
        fireEvent.change(getByLabelText("Filter decks by format"), {
            target: { value: "all" },
        });
        fireEvent.change(getByLabelText("Search decks or cards"), {
            target: { value: "savannah" },
        });
        expect(deckIds(container)).toEqual(["white-weenie"]);
        expect(getByText("Contains Savannah Lions")).toBeTruthy();
    });

    it("a tile opens its deck; New Deck opens the builder on the Format", () => {
        const { container, getByLabelText, getByRole } = render(<Lobby />);
        fireEvent.click(
            container.querySelector('[data-home-deck="white-weenie"]')!
        );
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/$slug",
            params: { slug: "white-weenie" },
        });
        fireEvent.change(getByLabelText("Filter decks by format"), {
            target: { value: "premodern" },
        });
        fireEvent.click(getByRole("button", { name: "+ New Deck" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/create",
            search: { format: "premodern" },
        });
    });
});
