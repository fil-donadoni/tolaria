// Issue #2056 defect 3: `<main>` must be able to shrink below its content's
// natural height, or a page that renders more than the leftover viewport
// space (after the header band) grows `<main>` past it and the WHOLE
// document overflows — exactly the "document.scrollHeight > innerHeight"
// bug measured at 852x303 on `/limited/$eventId/build` and `/decks/create`.
// `min-h-0` is what lets a flex item shrink below its content's min-content
// size; without it, `flex-1` alone does nothing once the container itself
// only has `min-height` (not a hard `height`) to size against.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
    useRouterState: () => "/decks/create",
    Outlet: () => <div data-testid="outlet" />,
}));
vi.mock("../app-header", () => ({
    default: () => <div data-testid="app-header" />,
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

    it("keeps the shell's own root at min-h-dvh (the shell, not the page, owns the viewport height)", () => {
        const { getByTestId } = render(<AppShell />);
        const root = getByTestId("app-header").closest(
            "div.flex"
        ) as HTMLElement;
        expect(root.className).toContain("min-h-dvh");
        // The shell root is never a hard `h-dvh` — that would make it exactly
        // one viewport regardless of the header band's own height, instead of
        // "at least one viewport, taller if a page's content legitimately
        // needs to scroll the page (not the deckbuilder's overflow bug)".
        expect(root.className.split(/\s+/)).not.toContain("h-dvh");
    });
});
