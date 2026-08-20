// The shell's ACTIVE SESSION, wired end to end (issue #2582, #2619 review).
//
// `app-shell-modes.test.tsx` mocks `useActiveSession` away and asks what each
// mode renders. This file is the layer under that one: the REAL hook, driven
// by a `useQuery` mock that records what it was asked for, so the two things
// the review found — a duplicated affordance and a subscription nobody reads —
// are asserted where they actually happen, in the composition.
//
// Both are invisible to a test that stubs the hook:
//
//  1. DUPLICATED RESUME. The lobby has resumed a game since #155
//     (`ActiveGameNotice`) and listed live events since #2357
//     (`DashboardLimitedBox`). The shell band stacked a second, weaker resume
//     on top of the first — same game, two buttons, 36px of a 390x844
//     viewport, against ADR 0069's "one banner". Only rendering the band AND
//     the surface's own notice together can catch that, which is why the
//     mocked `<Outlet/>` below renders the real `ActiveGameNotice` exactly as
//     `lobby.tsx` does. (The whole `Lobby` is not rendered: it opens a dozen
//     unrelated subscriptions and none of them are what this is about.)
//
//  2. DEAD SUBSCRIPTIONS. `AppShell` mounts on EVERY route, so before the fix
//     the board held `myActiveGame` and `myCurrentLimitedEvents` open while
//     rendering no band that could ever show either. The second scans the fat
//     `limitedEvents` table and re-runs on every draft pick anywhere in the
//     app; this repo bills a read by the whole document.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
    pathname: "/",
    outlet: null as ReactNode,
    /** Every `useQuery` call this render made: `path` is the api member that
     *  was subscribed to, `args` is `"skip"` when it was NOT subscribed. */
    calls: [] as { path: string; args: unknown }[],
    results: {} as Record<string, unknown>,
    /** What `useCurrentUser` answers — `undefined` is the frame where its own
     *  subscription has not resolved yet, which is NOT the same thing as
     *  "signed out". */
    user: undefined as
        | { _id: string; nickname: string; email: string }
        | undefined,
    navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
    useRouterState: () => h.pathname,
    useNavigate: () => h.navigate,
    Outlet: () => <>{h.outlet}</>,
    Link: ({
        to,
        children,
        ...rest
    }: React.PropsWithChildren<{ to?: string } & Record<string, unknown>>) => {
        const props = Object.fromEntries(
            Object.entries(rest).filter(
                ([key]) =>
                    !["activeProps", "activeOptions", "params"].includes(key)
            )
        );
        return (
            <a href={to} {...props}>
                {children}
            </a>
        );
    },
}));

// A path-carrying api stand-in: `api.game.myActiveGame` reads back as the
// string `"game.myActiveGame"`, which is what lets the `useQuery` mock below
// tell the two subscriptions apart instead of counting anonymous calls.
vi.mock("@convex/_generated/api", () => {
    const node = (path: string): unknown =>
        new Proxy(
            {},
            {
                get: (_target, prop) =>
                    prop === "__path"
                        ? path
                        : node(path ? `${path}.${String(prop)}` : String(prop)),
            }
        );
    return { api: node("") };
});

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: (ref: { __path: string }, args: unknown) => {
        h.calls.push({ path: ref.__path, args });
        return args === "skip" ? undefined : h.results[ref.__path];
    },
}));

vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => "desktop" as const,
}));
vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => h.user,
}));
vi.mock("@convex-dev/auth/react", () => ({
    useAuthActions: () => ({ signOut: vi.fn() }),
}));
vi.mock("~/lib/adminGating", () => ({ canViewAdminSection: () => false }));

import type { Id } from "@convex/_generated/dataModel";
import AppShell from "../app-shell";
import ActiveGameNotice, {
    type ActiveGame,
} from "~/components/lobby/active-game-notice";

const GAME_QUERY = "game.myActiveGame";
const EVENTS_QUERY = "limitedEvents.myCurrentLimitedEvents";

const RUNNING_GAME: ActiveGame = {
    gameId: "g1" as Id<"games">,
    matchId: "m1" as Id<"matches">,
    name: "Solo game",
    status: "playing",
    solo: true,
    vsAi: true,
    mode: null,
};

const SIGNED_IN = {
    _id: "user-1",
    nickname: "Tester",
    email: "tester@example.com",
};

beforeEach(() => {
    h.user = SIGNED_IN;
});

afterEach(() => {
    cleanup();
    h.pathname = "/";
    h.outlet = null;
    h.calls = [];
    h.results = {};
    h.navigate.mockReset();
});

/** Every resume affordance on screen, wherever it came from — the shell's
 *  band, the lobby's notice, or (the bug) both. Counted by accessible name so
 *  a second copy under a different component still shows up. */
function resumeAffordances(container: HTMLElement): string[] {
    return [...container.querySelectorAll("button")]
        .map((button) => button.textContent?.trim() ?? "")
        .filter((label) => /^(resume|return to (game|event))/i.test(label));
}

describe("one resume affordance per screen (ADR 0069, #2619 review)", () => {
    it("leaves the lobby's own notice alone and adds no second banner at /", () => {
        h.pathname = "/";
        h.results[GAME_QUERY] = RUNNING_GAME;
        h.results[EVENTS_QUERY] = [];
        h.outlet = (
            <ActiveGameNotice
                activeGame={RUNNING_GAME}
                userId={"user-1" as Id<"users">}
            />
        );

        const { container } = render(<AppShell />);

        expect(resumeAffordances(container)).toEqual(["Resume"]);
        expect(
            container.querySelector('[data-slot="app-return-banner"]')
        ).toBeNull();
    });

    it("shows the band, and only the band, one route away from the lobby", () => {
        // The regression guard's mirror image: suppressing the band everywhere
        // would pass the assertion above and delete the whole feature.
        h.pathname = "/decks/goblins";
        h.results[GAME_QUERY] = RUNNING_GAME;
        h.results[EVENTS_QUERY] = [];

        const { container } = render(<AppShell />);

        expect(resumeAffordances(container)).toEqual(["Return to game"]);
        expect(
            container.querySelector('[data-slot="app-return-banner"]')
        ).not.toBeNull();
    });

    it("adds no second event re-entry at /, where the Limited box lists them", () => {
        h.pathname = "/";
        h.results[GAME_QUERY] = null;
        h.results[EVENTS_QUERY] = [{ _id: "e1", type: "draft" }];

        const { container } = render(<AppShell />);

        expect(
            container.querySelector('[data-slot="app-return-banner"]')
        ).toBeNull();
    });
});

describe("no dead subscriptions on the board (#2619 review)", () => {
    /** What `useQuery` was passed for `path` on the render just performed. */
    function argsFor(path: string): unknown[] {
        return h.calls.filter((call) => call.path === path).map((c) => c.args);
    }

    it("skips BOTH session reads on the route that draws its own chrome", () => {
        h.pathname = "/game";
        h.results[GAME_QUERY] = RUNNING_GAME;
        h.results[EVENTS_QUERY] = [{ _id: "e1", type: "draft" }];

        const { container } = render(<AppShell />);

        expect(argsFor(GAME_QUERY)).toEqual(["skip"]);
        expect(argsFor(EVENTS_QUERY)).toEqual(["skip"]);
        // ...and the render is unchanged by the skip, because nothing on the
        // board could read the answer in the first place.
        expect(
            container.querySelector('[data-slot="app-return-banner"]')
        ).toBeNull();
        expect(container.querySelector("nav")).toBeNull();
    });

    it("still subscribes on a Browse route, where the bands consume it", () => {
        h.pathname = "/decks/goblins";
        h.results[GAME_QUERY] = RUNNING_GAME;
        h.results[EVENTS_QUERY] = [];

        render(<AppShell />);

        expect(argsFor(GAME_QUERY)).toEqual([{}]);
        expect(argsFor(EVENTS_QUERY)).toEqual([{}]);
    });

    it("still subscribes on an Immersive route that DOES wear shell chrome", () => {
        // `ownChrome` is the gate, not `immersive` — the deck builder wears a
        // contextual bar and a return banner, so it needs the reads.
        h.pathname = "/decks/goblins/edit";
        h.results[GAME_QUERY] = RUNNING_GAME;
        h.results[EVENTS_QUERY] = [];

        const { container } = render(<AppShell />);

        expect(argsFor(GAME_QUERY)).toEqual([{}]);
        expect(argsFor(EVENTS_QUERY)).toEqual([{}]);
        expect(
            container.querySelector('[data-slot="app-return-banner"]')
        ).not.toBeNull();
    });
});

describe("the band the shell reserved is the band it renders (#2619 review)", () => {
    /** The precedence `AppReturnBanner` shows by has to be the one
     *  `shellShowsReturnBanner` mounted it by and `shellBands` charged 36px
     *  for — `shellReturnAffordance`, once, not re-derived per consumer. The
     *  two used to disagree for one frame, because `useCurrentUser` is its own
     *  subscription and resolves independently of the game read. */
    it("renders the game band with its action disabled while the user read is still in flight", () => {
        h.pathname = "/decks/goblins";
        h.results[GAME_QUERY] = RUNNING_GAME;
        h.results[EVENTS_QUERY] = [];
        h.user = undefined;

        const { container } = render(<AppShell />);

        const banner = container.querySelector(
            '[data-slot="app-return-banner"]'
        );
        expect(banner).not.toBeNull();
        expect(banner!.textContent).toContain("A game is in progress.");
        const button = banner!.querySelector("button")!;
        expect(button.textContent?.trim()).toBe("Return to game");
        expect(button.disabled).toBe(true);
    });

    it("enables the action once the user read lands", () => {
        h.pathname = "/decks/goblins";
        h.results[GAME_QUERY] = RUNNING_GAME;
        h.results[EVENTS_QUERY] = [];

        const { container } = render(<AppShell />);

        const button = container
            .querySelector('[data-slot="app-return-banner"]')!
            .querySelector("button")!;
        expect(button.disabled).toBe(false);
    });

    it("keeps a game ahead of an event, whoever asks", () => {
        // The precedence itself, through the composition: both in flight, one
        // band, and it is the game's — the answer `shellReturnAffordance`
        // gives `shellShowsReturnBanner` and `shellBands` at the same time.
        h.pathname = "/decks/goblins";
        h.results[GAME_QUERY] = RUNNING_GAME;
        h.results[EVENTS_QUERY] = [{ _id: "e1", type: "draft" }];

        const { container } = render(<AppShell />);

        const banners = container.querySelectorAll(
            '[data-slot="app-return-banner"]'
        );
        expect(banners).toHaveLength(1);
        expect(banners[0].textContent).toContain("A game is in progress.");
    });
});
