// Issue #2056 defect 3: `<main>` must be able to shrink below its content's
// natural height, or a page that renders more than the leftover viewport
// space (after the header band) grows `<main>` past it and the WHOLE
// document overflows — exactly the "document.scrollHeight > innerHeight"
// bug measured at 852x303 on `/limited/$eventId/build` and `/decks/create`.
// `min-h-0` is what lets a flex item shrink below its content's min-content
// size; without it, `flex-1` alone does nothing once the container itself
// only has `min-height` (not a hard `height`) to size against.
//
// A first attempt at this fix gave the shell root `min-h-dvh` (a MINIMUM)
// and relied on `<main>`'s `min-h-0` alone — browser-measured regression:
// `document.scrollHeight` went from 471 (pre-fix bug) to 1199 on the SAME
// viewport, because an unbounded-height ancestor makes `flex-1` resolve
// against content, not the viewport. The chain needs a hard bound
// somewhere above `<main>`, not just `min-h-0` on `<main>` itself — that is
// what these tests pin.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
    useRouterState: () => "/",
    Outlet: () => <div data-testid="outlet" />,
}));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => "desktop",
}));
vi.mock("~/hooks/useActiveSession", () => ({
    useActiveSession: () => ({ game: null, event: null, loading: false }),
}));
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

afterEach(() => cleanup());

describe("AppShell (issue #2056 defect 3)", () => {
    it("gives <main> both flex-1 (fill remaining space) and min-h-0 (allow it to shrink below content size)", () => {
        const { getByTestId } = render(<AppShell />);
        const main = getByTestId("outlet").closest("main") as HTMLElement;
        const classes = main.className.split(/\s+/);
        expect(classes).toContain("flex-1");
        expect(classes).toContain("min-h-0");
    });

    it("bounds the shell's own root at a hard h-dvh, never a bare min-h-dvh (the amplified regression)", () => {
        const { getByTestId } = render(<AppShell />);
        const root = getByTestId("app-header").closest(
            "div.flex"
        ) as HTMLElement;
        const classes = root.className.split(/\s+/);
        // `h-dvh` is a HARD bound: exactly one viewport, which is what gives
        // `<main>`'s `flex-1 min-h-0` something real to shrink against. A
        // bare `min-h-dvh` (no `h-dvh` anywhere on the chain) is the shape
        // that regressed — `flex-1` resolves against content instead of the
        // viewport and `<main>` grows past the leftover space instead of
        // being clipped/scrolled internally.
        expect(classes).toContain("h-dvh");
    });

    it("gives <main> overflow-y-auto, so an ordinary long page (no internal scroller of its own) scrolls INSIDE main instead of overflowing the now hard-bounded document", () => {
        const { getByTestId } = render(<AppShell />);
        const main = getByTestId("outlet").closest("main") as HTMLElement;
        expect(main.className.split(/\s+/)).toContain("overflow-y-auto");
    });

    it("the route surface (<Outlet>) sits inside a height-bounded ancestor chain — walks parentElement up from the outlet and requires an h-dvh class somewhere above it", () => {
        const { getByTestId } = render(<AppShell />);
        let node: HTMLElement | null = getByTestId("outlet");
        let found = false;
        while (node) {
            if (node.className?.split(/\s+/).includes("h-dvh")) {
                found = true;
                break;
            }
            node = node.parentElement;
        }
        expect(found).toBe(true);
    });
});

// Issue #2056 defect 3 amplification found the header wrapper's `pt-6` (24px)
// plus AppHeader's own band at 112px total, and answered it with a
// `short-viewport:pt-0` override. v3 (issue #2582) answers it structurally
// instead: the wrapper has NO vertical padding at any viewport, so the band is
// the bar's own height and `SHELL_BROWSE_BAND_PX` can be ONE number rather than
// a sum nobody can check. A padding override would put the sum back.
describe("AppShell — the top band is the bar's own height (issue #2582)", () => {
    it("gives the header wrapper no vertical padding at any viewport", () => {
        const { getByTestId } = render(<AppShell />);
        const wrapper = getByTestId("app-header").parentElement as HTMLElement;
        const classes = wrapper.className.split(/\s+/);
        expect(
            classes.filter((c) => /(^|:)(p|pt|pb|py)-/.test(c)),
            "vertical padding on the header wrapper makes the band a sum, not a height"
        ).toEqual([]);
    });

    it("keeps the header wrapper shrink-0 — the band must not be squeezed", () => {
        const { getByTestId } = render(<AppShell />);
        const wrapper = getByTestId("app-header").parentElement as HTMLElement;
        expect(wrapper.className.split(/\s+/)).toContain("shrink-0");
    });
});
