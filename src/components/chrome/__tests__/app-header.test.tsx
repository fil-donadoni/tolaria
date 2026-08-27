// The v3 Browse top bar (issue #2582, ADR 0101).
//
// Issue #2056 measured the ORNATE header at 852x277 and found it 112px tall —
// 40% of that viewport — and answered it with `short-viewport:` overrides on a
// filigree frame, an ornamental divider and a two-row stack. v3 removed all
// three: the bar is now ONE row of `h-14` that becomes `short-viewport:h-10`,
// and those numbers are `SHELL_BROWSE_BAND_PX` / `SHELL_BROWSE_COMPACT_BAND_PX`
// in `shellLayout.ts`, which is what `<main>` is sized against.
//
// jsdom resolves no pixel height, so these assert the CLASSES that carry the
// band — the same pattern as the rest of the #2056 suite — plus the ONE thing
// the height model would silently disagree with: a height class on the bar that
// does not match the constant the shell subtracts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
    Link: ({
        to,
        children,
        ...props
    }: React.PropsWithChildren<{ to?: string } & Record<string, unknown>>) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
    useNavigate: () => vi.fn(),
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
}));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});
vi.mock("~/lib/adminGating", () => ({ canViewAdminSection: () => false }));

import AppHeader from "../app-header";
import {
    SHELL_BROWSE_BAND_PX,
    SHELL_BROWSE_COMPACT_BAND_PX,
} from "@/lib/shellLayout";

afterEach(() => cleanup());

/** Tailwind's `h-N` scale is 0.25rem per step at the app's 16px root. */
const REM_STEP_PX = 4;

describe("AppHeader — the Browse band (issue #2582)", () => {
    it("is ONE row whose height matches SHELL_BROWSE_BAND_PX", () => {
        // The assertion that matters: the class on the bar and the number
        // `shellBands` subtracts from `<main>` are the same height. They lived
        // apart before v3 (an ~88px bar plus a 24px wrapper padding), and a
        // band nobody could check is issue #2274's whole shape.
        const { container } = render(<AppHeader />);
        const bar = container.querySelector("header") as HTMLElement;
        const classes = bar.className.split(/\s+/);
        expect(classes).toContain(`h-${SHELL_BROWSE_BAND_PX / REM_STEP_PX}`);
        expect(classes).toContain(
            `short-viewport:h-${SHELL_BROWSE_COMPACT_BAND_PX / REM_STEP_PX}`
        );
    });

    it("carries no second row — the ornate stack was a height term, not a taste call", () => {
        const { container } = render(<AppHeader />);
        expect(
            container.querySelector("header > div.flex.flex-col"),
            "a `flex-col` row inside the bar is the two-row stack v3 removed"
        ).toBeNull();
    });

    it("drops the ornamental divider and both corner frames entirely (ADR 0103 §5, issue #2734)", () => {
        const { container } = render(<AppHeader />);
        expect(
            container.querySelector('[data-slot="ornamental-divider"]')
        ).toBeNull();
        expect(
            container.querySelector('[data-slot="corner-filigree-frame"]')
        ).toBeNull();
        expect(
            container.querySelector('[data-slot="corner-bracket-frame"]')
        ).toBeNull();
    });

    it("shrinks the wordmark logo and text under short-viewport", () => {
        const { container, getByAltText } = render(<AppHeader />);
        const logo = getByAltText("") as HTMLImageElement;
        expect(logo.className.split(/\s+/)).toContain("short-viewport:h-4");
        const wordmarkLink = container.querySelector(
            'a[href="/"]'
        ) as HTMLElement;
        expect(wordmarkLink.className.split(/\s+/)).toContain(
            "short-viewport:text-sm"
        );
    });
});

describe("AppHeader — the in-progress badge (issue #2582, PRD #2405 story 8)", () => {
    it("renders no badge when nothing is in flight", () => {
        const { container } = render(<AppHeader />);
        expect(
            container.querySelectorAll('[data-slot="nav-badge"]')
        ).toHaveLength(0);
    });

    it("badges Home when a game is running", () => {
        const { container } = render(<AppHeader gameBadge />);
        const home = container.querySelector('a[href="/"][class*="relative"]');
        expect(
            home?.querySelector('[data-slot="nav-badge"]'),
            "the Home nav link carries the badge"
        ).not.toBeNull();
    });

    it("badges Limited when an event is running", () => {
        const { container } = render(<AppHeader limitedBadge />);
        const limited = container.querySelector('a[href="/limited"]');
        expect(
            limited?.querySelector('[data-slot="nav-badge"]')
        ).not.toBeNull();
    });

    it("announces the badge in text, not only as a dot", () => {
        // A coloured dot is invisible to a screen reader; the dot is the
        // redundant half of the signal, not the signal.
        const { getByText } = render(<AppHeader gameBadge />);
        expect(getByText("(in progress)", { exact: false })).not.toBeNull();
    });
});
