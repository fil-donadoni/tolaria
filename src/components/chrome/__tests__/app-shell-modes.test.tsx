// The v3 shell, rendered WHOLE (issue #2582, ADR 0101, PRD #2405 stories 6-8).
//
// `app-shell-scroll-contract.test.tsx` mocks every band down to a marker div,
// because what it measures is the shell's box chain. This file is the opposite
// half: the bands are the REAL components, so what a user would actually find
// in each mode is what is asserted — the destinations under the thumb, the Exit
// out of an immersive surface, the banner back to a running game.
//
// That distinction is the point. A shell that mounts `<AppBottomNav/>` in the
// right band and a bottom nav that renders nothing are indistinguishable to a
// test that mocks the component away, and "the affordance never appeared
// although every server-side test passed" is this repo's most-repeated bug
// class (`.claude/rules/gre-development.md` § Frontend wiring analysis).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ViewportMode } from "~/hooks/useViewportMode";
import type { ActiveSession } from "~/hooks/useActiveSession";

let pathname = "/";
let viewport: ViewportMode = "desktop";
let session: ActiveSession = { game: null, event: null, loading: false };
const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useRouterState: () => pathname,
    useNavigate: () => navigate,
    Outlet: () => <div data-testid="outlet" />,
    // Router-only props are STRIPPED rather than destructured-and-ignored:
    // React warns about `activeProps` reaching a DOM node, and the lint rule
    // rightly refuses unused bindings.
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
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => viewport,
}));
vi.mock("~/hooks/useActiveSession", () => ({
    useActiveSession: () => session,
}));
vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({
        _id: "user-1",
        nickname: "Tester",
        email: "tester@example.com",
    }),
}));
vi.mock("@convex-dev/auth/react", () => ({
    useAuthActions: () => ({ signOut: vi.fn() }),
}));
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => undefined,
}));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});
vi.mock("~/lib/adminGating", () => ({ canViewAdminSection: () => false }));

import AppShell from "../app-shell";

afterEach(() => {
    cleanup();
    navigate.mockReset();
    pathname = "/";
    viewport = "desktop";
    session = { game: null, event: null, loading: false };
});

const RUNNING_GAME: ActiveSession = {
    game: { gameId: "g1", name: "Solo game", status: "playing", solo: true },
    event: null,
    loading: false,
} as ActiveSession;

const RUNNING_DRAFT: ActiveSession = {
    game: null,
    event: { eventId: "e1", type: "draft", packSlots: ["lea"] },
    loading: false,
} as ActiveSession;

describe("Browse mode — phone portrait bottom nav (PRD #2405 story 6)", () => {
    it("puts the primary destinations under the thumb and removes the top bar", () => {
        viewport = "portrait";
        const { getByRole, queryByRole } = render(<AppShell />);
        const nav = getByRole("navigation", { name: "Primary" });
        expect(nav).not.toBeNull();
        // The top bar's own nav landmark must be gone, not merely hidden: two
        // navigations would cost ~112px of an 844px viewport.
        expect(queryByRole("navigation", { name: "Main" })).toBeNull();
    });

    it("renders every destination as a real link, not a decorative label", () => {
        viewport = "portrait";
        const { getByRole } = render(<AppShell />);
        const nav = getByRole("navigation", { name: "Primary" });
        const hrefs = [...nav.querySelectorAll("a")].map((a) =>
            a.getAttribute("href")
        );
        expect(hrefs).toEqual(["/", "/limited"]);
    });

    it("pads the nav for the home indicator's safe area", () => {
        // Without this the last row of items sits under the gesture bar on
        // every modern phone. It is also the term `shellBands` adds on top of
        // `SHELL_BOTTOM_NAV_BAND_PX`.
        viewport = "portrait";
        const { getByRole } = render(<AppShell />);
        expect(
            getByRole("navigation", { name: "Primary" }).className
        ).toContain("pb-[env(safe-area-inset-bottom)]");
    });

    it("keeps every destination at the coarse-pointer touch target", () => {
        // WCAG 2.5.8 / ADR 0101: `--control-h-coarse` is the 44px target.
        viewport = "portrait";
        const { getByRole } = render(<AppShell />);
        for (const link of getByRole("navigation", {
            name: "Primary",
        }).querySelectorAll("a")) {
            expect(link.className, link.getAttribute("href") ?? "").toContain(
                "min-h-[var(--control-h-coarse)]"
            );
        }
    });

    it("keeps the profile / sign-out entry reachable with no top bar to hold it", () => {
        viewport = "portrait";
        const { getByRole } = render(<AppShell />);
        expect(getByRole("button", { name: /me/i })).not.toBeNull();
    });

    it("shows the top bar and no bottom nav on desktop", () => {
        const { getByRole, queryByRole } = render(<AppShell />);
        expect(getByRole("navigation", { name: "Main" })).not.toBeNull();
        expect(queryByRole("navigation", { name: "Primary" })).toBeNull();
    });

    it("shows the top bar and no bottom nav on a landscape phone", () => {
        viewport = "landscape-compact";
        const { getByRole, queryByRole } = render(<AppShell />);
        expect(getByRole("navigation", { name: "Main" })).not.toBeNull();
        expect(queryByRole("navigation", { name: "Primary" })).toBeNull();
    });
});

describe("Immersive mode — Exit and overflow (PRD #2405 story 7)", () => {
    it.each([
        ["/decks/create", "New deck", "/"],
        ["/decks/goblins/edit", "Edit deck", "/decks/goblins"],
        ["/presets/create", "New preset", "/"],
        ["/limited/e1/build", "Build your deck", "/limited/e1"],
    ])("%s shows its title and an Exit to %s", (path, title, exit) => {
        pathname = path;
        const { getByText, getByRole } = render(<AppShell />);
        expect(getByText(title)).not.toBeNull();
        expect(getByRole("link", { name: /exit/i }).getAttribute("href")).toBe(
            exit
        );
    });

    it("offers no persistent navigation at all", () => {
        pathname = "/decks/goblins/edit";
        const { queryByRole } = render(<AppShell />);
        expect(queryByRole("navigation", { name: "Main" })).toBeNull();
        expect(queryByRole("navigation", { name: "Primary" })).toBeNull();
    });

    it("still offers an overflow, so an immersive surface is not a dead end", () => {
        pathname = "/decks/goblins/edit";
        const { getByRole } = render(<AppShell />);
        expect(getByRole("button", { name: "More" })).not.toBeNull();
    });

    it("keeps the contextual bar off the board, which owns its chrome", () => {
        pathname = "/game";
        const { queryByRole, container } = render(<AppShell />);
        expect(queryByRole("link", { name: /exit/i })).toBeNull();
        expect(
            container.querySelector('[data-slot="app-context-bar"]')
        ).toBeNull();
    });
});

// Every case below is set somewhere OTHER than `/`: the lobby owns both
// returns in full (`ownsReturn` in `SHELL_ROUTE_RULES`) and the shell stands
// down there, which `app-shell-session.test.tsx` asserts against the real
// `ActiveGameNotice`. What this block is for is everywhere else — the routes
// where the lobby's notice was simply never reachable.
describe("Return banner + nav badge (PRD #2405 story 8)", () => {
    it("offers a way back to a running game from an ordinary Browse route", () => {
        pathname = "/decks/goblins";
        session = RUNNING_GAME;
        const { getByRole, getByText } = render(<AppShell />);
        expect(getByText(/game is in progress/i)).not.toBeNull();
        expect(getByRole("button", { name: /return to game/i })).not.toBeNull();
    });

    it("offers it from an IMMERSIVE route too — the surfaces the lobby notice never reached", () => {
        pathname = "/decks/goblins/edit";
        session = RUNNING_GAME;
        const { getByRole } = render(<AppShell />);
        expect(getByRole("button", { name: /return to game/i })).not.toBeNull();
    });

    it("offers a way back to a running draft", () => {
        pathname = "/decks/goblins";
        session = RUNNING_DRAFT;
        const { getByText, getByRole } = render(<AppShell />);
        expect(getByText(/draft is in progress/i)).not.toBeNull();
        expect(
            getByRole("button", { name: /return to event/i })
        ).not.toBeNull();
    });

    it("does not offer the draft banner on that draft's own pages", () => {
        pathname = "/limited/e1";
        session = RUNNING_DRAFT;
        const { queryByRole } = render(<AppShell />);
        expect(queryByRole("button", { name: /return to event/i })).toBeNull();
    });

    it("renders nothing at all when nothing is in flight", () => {
        const { container } = render(<AppShell />);
        expect(
            container.querySelector('[data-slot="app-return-banner"]')
        ).toBeNull();
    });

    it("badges the top bar's Home destination while a game runs", () => {
        session = RUNNING_GAME;
        const { getByRole } = render(<AppShell />);
        const home = getByRole("navigation", { name: "Main" }).querySelector(
            'a[href="/"]'
        )!;
        expect(home.querySelector('[data-slot="nav-badge"]')).not.toBeNull();
    });

    it("badges the top bar's Limited destination while a draft runs", () => {
        session = RUNNING_DRAFT;
        const { getByRole } = render(<AppShell />);
        const limited = getByRole("navigation", { name: "Main" }).querySelector(
            'a[href="/limited"]'
        )!;
        expect(limited.querySelector('[data-slot="nav-badge"]')).not.toBeNull();
    });

    it("badges the phone bottom nav too — the badge follows the destinations", () => {
        viewport = "portrait";
        session = RUNNING_GAME;
        const { getByRole } = render(<AppShell />);
        const play = getByRole("navigation", { name: "Primary" }).querySelector(
            'a[href="/"]'
        )!;
        expect(play.querySelector('[data-slot="nav-badge"]')).not.toBeNull();
    });

    it("shows no banner and no chrome on the board itself", () => {
        pathname = "/game";
        session = RUNNING_GAME;
        const { container } = render(<AppShell />);
        expect(
            container.querySelector('[data-slot="app-return-banner"]')
        ).toBeNull();
        expect(container.querySelector("header")).toBeNull();
    });
});
