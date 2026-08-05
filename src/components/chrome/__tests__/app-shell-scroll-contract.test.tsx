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
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

let pathname = "/decks/create";

vi.mock("@tanstack/react-router", () => ({
    useRouterState: () => pathname,
    Outlet: () => <div data-testid="outlet" />,
}));
vi.mock("../app-header", () => ({
    default: () => <div data-testid="app-header" />,
}));

import AppShell from "../app-shell";
import { shellShowsHeader } from "@/lib/shellChrome";
import {
    SHELL_HEADER_BAND_PX,
    deriveShellModel,
    resolveShellLayout,
    type ShellModel,
} from "@/lib/shellLayout";

afterEach(() => {
    cleanup();
    pathname = "/decks/create";
});

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
    const headerWrapper = container.querySelector(
        '[data-testid="app-header"]'
    )?.parentElement;
    return deriveShellModel({
        root: root.className,
        headerWrapper: headerWrapper ? headerWrapper.className : null,
        main: main.className,
    });
}

/** Desktop heights the app is used at — including both HITL browser sizes. */
const DESKTOP_HEIGHTS_PX = [500, 600, 720, 768, 800, 900, 1080, 1200, 1440];

describe("AppShell scroll contract — structural, at desktop heights (issue #2274)", () => {
    it("the rendered shell has all four contract properties: bounded root, pinned header band, shrinkable main, scrollable main", () => {
        expect(renderedShellModel()).toEqual({
            rootBounded: true,
            headerPinned: true,
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
                },
                { kind: "intrinsic", heightPx: contentPx }
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
                },
                { kind: "remaining" }
            );
            expect(layout.mainOverflowPx).toBe(0);
            expect(layout.mainMaxScrollTopPx).toBe(0);
            expect(layout.scrollers).toEqual([]);
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
                },
                { kind: "intrinsic", heightPx: viewportHeightPx * 4 }
            );
            expect(layout.headerHeightPx).toBe(SHELL_HEADER_BAND_PX);
        }
    );
});

describe("AppShell scroll contract — the fullscreen route (issue #2274)", () => {
    it("`/game` renders no header band, and the same contract still holds with the whole viewport", () => {
        pathname = "/game/abc123";
        expect(shellShowsHeader(pathname)).toBe(false);
        const model = renderedShellModel();
        expect(model).toEqual({
            rootBounded: true,
            headerPinned: true,
            mainCanShrink: true,
            mainScrolls: true,
        });
        const layout = resolveShellLayout(
            model,
            { viewportHeightPx: 1080, headerBandHeightPx: 0 },
            { kind: "remaining" }
        );
        expect(layout.mainHeightPx).toBe(1080);
        expect(layout.scrollers).toEqual([]);
    });

    it("the header band really is absent from the DOM on /game (so the 0px band above is the shell's, not the test's assumption)", () => {
        pathname = "/game/abc123";
        const { queryByTestId } = render(<AppShell />);
        expect(queryByTestId("app-header")).toBeNull();
    });
});
