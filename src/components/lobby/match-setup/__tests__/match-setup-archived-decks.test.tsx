// The Match setup's archived-deck section over its real wiring (issue #8411):
// an admin's Bot or Solo Freeform deck steps list other players' decks with the
// owner named; nobody else's setup subscribes or shows them. The rules themselves
// are `matchSetup.test.ts`; the server's refusal is `limitedDeckAdminSeat.test.ts`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import MatchSetupFlow from "../match-setup-flow";
import { MATCH_SETUP_STORAGE_KEY } from "~/lib/matchSetup";

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

const ARCHIVED_ROW = {
    _id: "row-1",
    userId: "alice",
    name: "Alice's Sealed",
    format: "limited",
    colors: ["R"],
    cards: [],
    sideboard: [],
    isLegal: true,
    reasons: [],
    ownerNickname: "Alice",
};

const queries: Record<string, unknown> = {};
const paginated = vi.hoisted(() => ({
    args: [] as unknown[],
    status: "Exhausted",
    loadMore: vi.fn(),
}));
const currentUser = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    useRouter: () => ({ preloadRoute: vi.fn() }),
}));
vi.mock("convex/react", () => ({
    useQuery: (fn: { path: string }, args: unknown) =>
        args === "skip" ? undefined : queries[fn.path],
    useMutation: () => vi.fn().mockResolvedValue(null),
    usePaginatedQuery: (_fn: unknown, args: unknown) => {
        paginated.args.push(args);
        return {
            results: args === "skip" ? [] : [ARCHIVED_ROW],
            status: args === "skip" ? "LoadingFirstPage" : paginated.status,
            loadMore: paginated.loadMore,
        };
    },
}));
vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({
        _id: "user-1",
        nickname: "Tester",
        isAdmin: currentUser.isAdmin,
    }),
}));
vi.mock("~/hooks/useUserDecks", () => ({ useUserDecks: () => [] }));
vi.mock("~/hooks/useStartMatchPrefetch", () => ({
    useStartMatchPrefetch: () => {},
}));

const SECTION = /Other players' archived decks/;

function mount(patch: Record<string, unknown> = {}) {
    localStorage.setItem(
        MATCH_SETUP_STORAGE_KEY,
        JSON.stringify({
            mode: "arena",
            opponent: "bot",
            matchFormat: "freeform",
            gamesFormat: 1,
            myDeckId: null,
            opponentDeckId: null,
            opponentDeckChosen: true,
            difficulty: "hard",
            joinTableId: null,
            joinTableFormat: null,
            ...patch,
        })
    );
    render(<MatchSetupFlow />);
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    paginated.args.length = 0;
    paginated.status = "Exhausted";
    paginated.loadMore.mockClear();
    currentUser.isAdmin = false;
    queries["decks.list"] = [];
    queries["gameReads.listOpenGames"] = [];
    queries["gameReads.myActiveGame"] = null;
    queries["formatBanlists.listAll"] = [];
});

describe("archived decks in the deck steps (issue #8411)", () => {
    for (const opponent of ["bot", "solo"]) {
        it(`an admin's ${opponent} Freeform step lists them and names the owner`, () => {
            currentUser.isAdmin = true;
            mount({ opponent });
            expect(screen.getByRole("heading", { name: SECTION })).toBeTruthy();
            expect(screen.getByText("Owner: Alice")).toBeTruthy();
        });
    }

    it("the second seat's step lists them too", () => {
        currentUser.isAdmin = true;
        queries["decks.list"] = [
            {
                presetId: "burn",
                name: "Burn",
                format: "freeform",
                colors: ["R"],
                cards: [],
                sideboard: [],
                featuredCardId: null,
                isLegal: true,
                reasons: [],
            },
        ];
        mount({ myDeckId: "burn", opponentDeckChosen: false });
        expect(
            document.querySelector('[data-setup-choice="mirror"]')
        ).toBeTruthy();
        expect(screen.getByText("Owner: Alice")).toBeTruthy();
    });

    it("a non-admin neither subscribes nor sees them", () => {
        mount();
        expect(paginated.args.every((a) => a === "skip")).toBe(true);
        expect(screen.queryByRole("heading", { name: SECTION })).toBeNull();
        expect(screen.queryByText("Owner: Alice")).toBeNull();
    });

    it("an admin hosting a table neither subscribes nor sees them", () => {
        currentUser.isAdmin = true;
        mount({ opponent: "host" });
        expect(paginated.args.every((a) => a === "skip")).toBe(true);
        expect(screen.queryByText("Owner: Alice")).toBeNull();
    });

    it("an admin under another Match Format neither subscribes nor sees them", () => {
        currentUser.isAdmin = true;
        mount({ matchFormat: "premodern" });
        expect(paginated.args.every((a) => a === "skip")).toBe(true);
    });

    it("Load more appears only while another page exists", () => {
        currentUser.isAdmin = true;
        mount();
        const name = "Load more archived decks";
        expect(screen.queryByRole("button", { name })).toBeNull();
        cleanup();
        paginated.status = "CanLoadMore";
        mount();
        fireEvent.click(screen.getByRole("button", { name }));
        expect(paginated.loadMore).toHaveBeenCalledTimes(1);
    });
});
