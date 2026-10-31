// The Constructed setup flow over its real wiring when the user already holds
// an active Match (issue #7703): the server rejects every create/join while
// one stands (`findActiveMatchForUser`), so the flow must show the active-game
// notice — Resume / Concede — where Start is pressed, and keep Start disabled,
// instead of letting the player hit an opaque rejection.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import MatchSetupFlow from "../match-setup-flow";
import { MATCH_SETUP_STORAGE_KEY } from "~/lib/matchSetup";

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
    useNavigate: () => vi.fn(),
    useRouter: () => ({ preloadRoute: vi.fn() }),
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
vi.mock("~/hooks/useUserDecks", () => ({ useUserDecks: () => [] }));
vi.mock("~/hooks/useStartMatchPrefetch", () => ({
    useStartMatchPrefetch: () => {},
}));

/** Arena · Bot · Old School · Bo3 · Mono Red Burn vs White Weenie — every
 *  step answered, so Start is reachable. */
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

const ACTIVE_GAME = {
    gameId: "game-7",
    matchId: "match-7",
    name: "Tester vs Bot",
    status: "playing",
    matchStatus: "playing",
    solo: true,
    vsAi: true,
    mode: null,
};

beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(MATCH_SETUP_STORAGE_KEY, JSON.stringify(BOT_SETUP));
    for (const k of Object.keys(queries)) delete queries[k];
    queries["decks.list"] = PRESET_DECKS;
    queries["gameReads.listOpenGames"] = [];
    queries["gameReads.myActiveGame"] = null;
    mutations["game.createSoloGame"] = createSoloGame;
});

const startButton = (getByRole: (r: string, o: object) => HTMLElement) =>
    getByRole("button", { name: "Start match" }) as HTMLButtonElement;

describe("Match setup flow — active Match (issue #7703)", () => {
    it("starts normally when no Match is active", () => {
        const { getByRole, queryByText } = render(<MatchSetupFlow />);
        expect(queryByText(/You have a game in progress/)).toBeNull();
        const start = startButton(getByRole);
        expect(start.disabled).toBe(false);
        fireEvent.click(start);
        expect(createSoloGame).toHaveBeenCalledTimes(1);
    });

    it("shows the notice with Resume and Concede, and blocks Start", () => {
        queries["gameReads.myActiveGame"] = ACTIVE_GAME;
        const { getByRole, getByText } = render(<MatchSetupFlow />);
        getByText(/You have a game in progress/);
        getByRole("button", { name: "Resume" });
        getByRole("button", { name: "Concede Match" });
        const start = startButton(getByRole);
        expect(start.disabled).toBe(true);
        fireEvent.click(start);
        expect(createSoloGame).not.toHaveBeenCalled();
    });
});
