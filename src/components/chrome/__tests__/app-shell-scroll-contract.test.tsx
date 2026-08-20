// Issue #2274 — the AppShell scroll contract, pinned at EVERY height.
//
// Issue #2056 moved the app's scroll container from the document to `<main>`
// for every route. The move was verified by a browser pass only at viewport
// heights under 300px — entirely inside the `max-height: 500px` media branch —
// yet the change is not media-gated: it applies at every height. The defect was
// therefore never a visible symptom, it was an UNVERIFIED CONTRACT applied far
// wider than it was tested.
//
// jsdom computes no layout, so asserting `main.className` contains
// `overflow-y-auto` proves nothing about scrolling. These tests instead read
// the shell's structural flags OFF THE REAL RENDERED DOM (`deriveShellModel`)
// and run them through the shell's layout arithmetic (`resolveShellLayout`,
// unit-tested in `src/lib/__tests__/shellLayout.test.ts`) across a sweep of
// desktop heights. Delete `h-dvh`, `min-h-0` or `overflow-y-auto` from
// `app-shell.tsx` and the derived model changes, so the arithmetic's verdict
// changes with it — which is what makes this a behavioural assertion rather
// than a class-name snapshot.
//
// v3 (issue #2582) widened the shell from one band to FOUR — the Browse top
// bar, the Immersive contextual bar, the return banner, and the phone-portrait
// bottom nav. Every one of them is a `shrink-0` sibling of `<main>` in the same
// flex column, and every one is read off the real DOM below. The bottom nav is
// the one that makes this widening load-bearing rather than cosmetic: it is the
// first band this app has ever had BELOW `<main>`, and a band the height model
// does not know about leaves the last row of every page under the nav.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ViewportMode } from "~/hooks/useViewportMode";

let pathname = "/decks/create";
let viewport: ViewportMode = "desktop";
let session = { game: null, event: null, loading: false };

vi.mock("@tanstack/react-router", () => ({
    useRouterState: () => pathname,
    Outlet: () => <div data-testid="outlet" />,
}));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => viewport,
}));
vi.mock("~/hooks/useActiveSession", () => ({
    useActiveSession: () => session,
}));
// The four bands are mocked to bare markers on purpose: what this file tests
// is the SHELL's box chain — which bands it mounts and what flex classes it
// puts on them — not what each band renders inside itself. Each band's own
// contents have their own test file.
vi.mock("../app-header", () => ({
    default: () => <div data-testid="app-header" />,
}));
vi.mock("../app-bottom-nav", () => ({
    default: () => <div data-testid="app-bottom-nav" />,
}));
vi.mock("../app-context-bar", () => ({
    default: () => <div data-testid="app-context-bar" />,
}));
vi.mock("../app-return-banner", () => ({
    default: () => <div data-testid="app-return-banner" />,
}));

import AppShell from "../app-shell";
import { resolveShellChrome } from "@/lib/shellChrome";
import {
    SHELL_BOTTOM_NAV_BAND_PX,
    SHELL_BROWSE_BAND_PX,
    SHELL_CONTEXTUAL_BAND_PX,
    deriveShellModel,
    resolveShellLayout,
    shellBands,
    type RouteRootOverflow,
    type ShellHeightClaim,
    type ShellHeightClaimKind,
    type ShellModel,
} from "@/lib/shellLayout";

/** The representative top band for the sweeps below (Browse, desktop). */
const SHELL_HEADER_BAND_PX = SHELL_BROWSE_BAND_PX;

afterEach(() => {
    cleanup();
    pathname = "/decks/create";
    viewport = "desktop";
    session = { game: null, event: null, loading: false };
});
/**
 * A route root's height claim. `overflow` and `shrinks` are stated at every
 * call site because `ShellHeightClaim` makes them REQUIRED — a claim that
 * could omit its overflow is what certified the clipping lobby as correct
 * twice (issue #2274). `shrinks` defaults to `true`, the CLAMPABLE case: a
 * route root is a shrinkable flex child of `<main>` unless it says otherwise.
 */
function claim(
    kind: ShellHeightClaimKind,
    overflow: RouteRootOverflow,
    heightPx = 0,
    shrinks = true
): ShellHeightClaim {
    return { kind, heightPx, overflow, shrinks };
}

/**
 * Render the real `<AppShell>` and read its contract out of the rendered DOM.
 * Every flag comes from an element the shell actually produced — nothing here
 * is hand-written, which is what stops this test from passing against a shell
 * that has lost the class it depends on.
 */
function renderedShellModel(): ShellModel {
    const { getByTestId, container } = render(<AppShell />);
    const main = getByTestId("outlet").closest("main") as HTMLElement;
    const root = container.firstElementChild as HTMLElement;
    // The TOP band is whichever bar the mode produced — the Browse header or
    // the Immersive contextual bar. Reading "whichever is there" rather than
    // hard-coding the header is what lets the Immersive sweeps below run the
    // same contract as the Browse ones.
    const topBand =
        container.querySelector('[data-testid="app-header"]')?.parentElement ??
        container.querySelector('[data-testid="app-context-bar"]')
            ?.parentElement ??
        null;
    const bottomBand =
        container.querySelector('[data-testid="app-bottom-nav"]')
            ?.parentElement ?? null;
    return deriveShellModel({
        root: root.className,
        headerWrapper: topBand ? topBand.className : null,
        main: main.className,
        bottomBand: bottomBand ? bottomBand.className : null,
    });
}

/** Desktop heights the app is used at — including both HITL browser sizes. */
const DESKTOP_HEIGHTS_PX = [500, 600, 720, 768, 800, 900, 1080, 1200, 1440];

describe("AppShell scroll contract — structural, at desktop heights (issue #2274)", () => {
    it("the rendered shell has all four contract properties: bounded root, pinned header band, shrinkable main, scrollable main", () => {
        expect(renderedShellModel()).toEqual({
            rootBounded: true,
            headerPinned: true,
            bottomPinned: true,
            mainCanShrink: true,
            mainScrolls: true,
        });
    });

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: a route taller than the viewport can be scrolled to its own bottom, through <main> and only <main>",
        (viewportHeightPx) => {
            const model = renderedShellModel();
            const contentPx = viewportHeightPx * 3;
            const layout = resolveShellLayout(
                model,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("intrinsic", "spills", contentPx)
            );
            // No double scrollbar: exactly one box scrolls, and it is `<main>`.
            expect(layout.scrollers).toEqual(["main"]);
            expect(layout.documentMaxScrollTopPx).toBe(0);
            // The bottom is reachable: `<main>`'s scroll range covers the
            // whole deficit, exactly.
            expect(layout.mainMaxScrollTopPx).toBe(
                contentPx - layout.mainHeightPx
            );
            expect(layout.bottomReachable).toBe(true);
        }
    );

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: a route claiming the shell's remainder needs no scrollbar at all — nothing regresses issue #2275's deckbuilder shape",
        (viewportHeightPx) => {
            // PR #2276 (issue #2275) fixed the deckbuilder by wrapping its
            // growable content in the route's OWN `overflow-y-auto` region, so
            // the deficit is absorbed there and the shell's fallback scroll
            // never engages. That de-escalation only holds while the route's
            // root still claims exactly the shell's remainder — assert it does.
            const layout = resolveShellLayout(
                renderedShellModel(),
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("remaining", "scrolls", viewportHeightPx * 3)
            );
            expect(layout.mainOverflowPx).toBe(0);
            expect(layout.mainMaxScrollTopPx).toBe(0);
            expect(layout.clippedPx).toBe(0);
            expect(layout.scrollers).toEqual([]);
        }
    );

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: the header band survives the loss of <main>'s `min-h-0` — which is the only thing `shrink-0` is FOR",
        (viewportHeightPx) => {
            // `headerPinned` has no consequence in the shipped configuration:
            // with `mainCanShrink: true` the overshoot is always 0, so a test
            // that only sweeps the shipped model asserts the flag structurally
            // and nothing more (dropping `shrink-0` reddened exactly one
            // structural equality, and zero behavioural assertions).
            //
            // `shrink-0` is defence in depth: it is what keeps the header at
            // full height if `<main>` ever stops being able to shrink. So drive
            // the RENDERED model through exactly that scenario — the flag comes
            // from `app-shell.tsx`'s real DOM, the consequence is a height.
            const rendered = renderedShellModel();
            const layout = resolveShellLayout(
                { ...rendered, mainCanShrink: false },
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("intrinsic", "spills", viewportHeightPx * 4)
            );
            expect(layout.headerHeightPx).toBe(SHELL_HEADER_BAND_PX);
            // ...and the band is not merely preserved, it is preserved WHOLE:
            // an unpinned band would be squeezed to nothing at these heights.
            expect(
                resolveShellLayout(
                    { ...rendered, mainCanShrink: false, headerPinned: false },
                    {
                        viewportHeightPx,
                        headerBandHeightPx: SHELL_HEADER_BAND_PX,
                        bottomBandHeightPx: 0,
                    },
                    claim("intrinsic", "spills", viewportHeightPx * 4)
                ).headerHeightPx
            ).toBeLessThan(SHELL_HEADER_BAND_PX);
        }
    );

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: the header band is never squeezed by the page below it",
        (viewportHeightPx) => {
            const layout = resolveShellLayout(
                renderedShellModel(),
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("intrinsic", "spills", viewportHeightPx * 4)
            );
            expect(layout.headerHeightPx).toBe(SHELL_HEADER_BAND_PX);
        }
    );
});

describe("AppShell scroll contract — the fullscreen route (issue #2274)", () => {
    it("`/game` renders no band at all, and the same contract still holds with the whole viewport", () => {
        pathname = "/game";
        expect(resolveShellChrome(pathname).ownChrome).toBe(true);
        const model = renderedShellModel();
        expect(model).toEqual({
            rootBounded: true,
            headerPinned: true,
            bottomPinned: true,
            mainCanShrink: true,
            mainScrolls: true,
        });
        const layout = resolveShellLayout(
            model,
            {
                viewportHeightPx: 1080,
                headerBandHeightPx: 0,
                bottomBandHeightPx: 0,
            },
            claim("remaining", "scrolls", 3000)
        );
        expect(layout.mainHeightPx).toBe(1080);
        expect(layout.scrollers).toEqual([]);
    });

    it("no band is in the DOM on /game (so the 0px bands above are the shell's, not the test's assumption)", () => {
        pathname = "/game";
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-header")).toBeNull();
        expect(queryByTestId("app-context-bar")).toBeNull();
        expect(queryByTestId("app-bottom-nav")).toBeNull();
        expect(queryByTestId("app-return-banner")).toBeNull();
    });

    it("keeps the board bandless even on a portrait phone with a game running", () => {
        // The one configuration where every OTHER route grows two bands.
        pathname = "/game";
        viewport = "portrait";
        session = {
            game: { gameId: "g1", name: "n", status: "playing", solo: true },
            event: { eventId: "e1", type: "draft" },
            loading: false,
        } as never;
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-bottom-nav")).toBeNull();
        expect(queryByTestId("app-return-banner")).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The v3 shell modes (issue #2582). Each case renders the REAL `<AppShell>` at
// a route + viewport and checks two things together: which bands it mounted,
// and whether the shell's own arithmetic (`shellBands` → `resolveShellLayout`)
// still leaves `<main>` the exact remainder. Neither half alone is evidence —
// a band the DOM has and the model doesn't is precisely issues #2056/#2274.
// ────────────────────────────────────────────────────────────────────────────
describe("AppShell — Browse mode bands (issue #2582)", () => {
    it("mounts the top bar and NO bottom nav on desktop", () => {
        pathname = "/";
        viewport = "desktop";
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-header")).not.toBeNull();
        expect(queryByTestId("app-bottom-nav")).toBeNull();
        expect(queryByTestId("app-context-bar")).toBeNull();
    });

    it("mounts the top bar and NO bottom nav on a landscape phone", () => {
        // A landscape phone has ~390px of height: the bar is CUT to 40px, not
        // supplemented with a second band.
        pathname = "/";
        viewport = "landscape-compact";
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-header")).not.toBeNull();
        expect(queryByTestId("app-bottom-nav")).toBeNull();
    });

    it("swaps the top bar for the bottom nav on a portrait phone", () => {
        pathname = "/";
        viewport = "portrait";
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-header")).toBeNull();
        expect(queryByTestId("app-bottom-nav")).not.toBeNull();
    });

    it("pins the phone-portrait bottom nav, so a long page cannot squeeze it away", () => {
        pathname = "/";
        viewport = "portrait";
        expect(renderedShellModel().bottomPinned).toBe(true);
    });

    it("leaves <main> exactly the remainder on a portrait phone, so the last row is not under the nav", () => {
        pathname = "/";
        viewport = "portrait";
        const bands = shellBands({
            mode: "browse",
            ownChrome: false,
            viewport: "portrait",
            returnBanner: false,
            safeAreaBottomPx: 34,
        });
        const layout = resolveShellLayout(
            renderedShellModel(),
            { viewportHeightPx: 844, ...bands },
            claim("intrinsic", "spills", 3000)
        );
        expect(layout.mainHeightPx).toBe(844 - SHELL_BOTTOM_NAV_BAND_PX - 34);
        expect(layout.scrollers).toEqual(["main"]);
        expect(layout.documentMaxScrollTopPx).toBe(0);
        expect(layout.bottomReachable).toBe(true);
    });
});

describe("AppShell — Immersive mode bands (issue #2582)", () => {
    it.each([
        "/decks/create",
        "/decks/goblins/edit",
        "/presets/create",
        "/presets/burn/edit",
        "/limited/e123/build",
    ])("mounts the contextual bar and no navigation on %s", (path) => {
        pathname = path;
        viewport = "desktop";
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-context-bar")).not.toBeNull();
        expect(queryByTestId("app-header")).toBeNull();
        expect(queryByTestId("app-bottom-nav")).toBeNull();
    });

    it("keeps Immersive bandless of a bottom nav even on a portrait phone", () => {
        // The mode, not the viewport, decides: a bottom nav on the deck
        // builder would be exactly the space this mode exists to reclaim.
        pathname = "/decks/goblins/edit";
        viewport = "portrait";
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-bottom-nav")).toBeNull();
        expect(queryByTestId("app-context-bar")).not.toBeNull();
    });

    it("leaves <main> the viewport minus the 44px contextual bar", () => {
        pathname = "/decks/goblins/edit";
        viewport = "desktop";
        const layout = resolveShellLayout(
            renderedShellModel(),
            {
                viewportHeightPx: 900,
                ...shellBands({
                    mode: "immersive",
                    ownChrome: false,
                    viewport: "desktop",
                    returnBanner: false,
                }),
            },
            claim("remaining", "scrolls", 3000)
        );
        expect(layout.mainHeightPx).toBe(900 - SHELL_CONTEXTUAL_BAND_PX);
        expect(layout.scrollers).toEqual([]);
    });
});

describe("AppShell — the return banner is a BAND, not an overlay (issue #2582)", () => {
    const RUNNING = {
        game: { gameId: "g1", name: "Solo", status: "playing", solo: true },
        event: null,
        loading: false,
    } as never;

    it("mounts above <main> on a Browse route with a game running", () => {
        // NOT `/`: the lobby owns the return in full and the shell stands down
        // there (`ownsReturn`). Any other Browse route is where the band lives.
        pathname = "/decks/goblins";
        session = RUNNING;
        const { queryByTestId, getByTestId } = render(<AppShell />);
        const banner = queryByTestId("app-return-banner");
        expect(banner).not.toBeNull();
        // Above `<main>` in document order — an overlay would occlude a card
        // row instead of costing height, which is a probe `occ` failure.
        const main = getByTestId("outlet").closest("main") as HTMLElement;
        expect(
            banner!.parentElement!.compareDocumentPosition(main) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it("mounts on an Immersive route too — the surfaces the lobby notice never reached", () => {
        pathname = "/decks/goblins/edit";
        session = RUNNING;
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-return-banner")).not.toBeNull();
    });

    it("is absent when nothing is in flight", () => {
        pathname = "/";
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-return-banner")).toBeNull();
    });

    it("costs <main> exactly its own height, in both modes", () => {
        for (const mode of ["browse", "immersive"] as const) {
            pathname = mode === "browse" ? "/" : "/decks/goblins/edit";
            session = RUNNING;
            cleanup();
            const model = renderedShellModel();
            const withBanner = resolveShellLayout(
                model,
                {
                    viewportHeightPx: 900,
                    ...shellBands({
                        mode,
                        ownChrome: false,
                        viewport: "desktop",
                        returnBanner: true,
                    }),
                },
                claim("remaining", "scrolls", 3000)
            );
            const withoutBanner = resolveShellLayout(
                model,
                {
                    viewportHeightPx: 900,
                    ...shellBands({
                        mode,
                        ownChrome: false,
                        viewport: "desktop",
                        returnBanner: false,
                    }),
                },
                claim("remaining", "scrolls", 3000)
            );
            expect(
                withoutBanner.mainHeightPx - withBanner.mainHeightPx,
                mode
            ).toBe(36);
        }
    });
});
