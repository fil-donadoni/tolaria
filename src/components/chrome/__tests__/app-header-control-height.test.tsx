// Browse top bar tap targets (issue #3683, umbrella #2659): the nav links and
// the Admin trigger size from `--control-h` (44px coarse / 32px fine) with the
// `short-viewport:` `--control-h-xs` step, the split `AppContextBar` applies,
// so the 56px / 40px band heights never move. happy-dom has no layout, so the
// token classes are what is pinned here; `check:ui` measures the pixels.
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
    useCurrentUser: () => ({ _id: "user-1", nickname: "Tester" }),
}));
vi.mock("@convex-dev/auth/react", () => ({
    useAuthActions: () => ({ signOut: vi.fn() }),
}));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});
vi.mock("~/lib/adminGating", () => ({ canViewAdminSection: () => true }));

import AppHeader from "../app-header";

afterEach(() => cleanup());

const TOKENS = [
    "min-h-[var(--control-h)]",
    "short-viewport:min-h-[var(--control-h-xs)]",
];

function expectTokens(el: Element | null | undefined, what: string) {
    expect(el, `${what} renders`).toBeTruthy();
    const classes = (el as Element).className.split(/\s+/);
    for (const token of TOKENS) {
        expect(classes, `${what} carries ${token}`).toContain(token);
    }
}

describe("AppHeader — pointer control-height tokens (issue #3683)", () => {
    it("sizes the Home and Limited links from the control-height tokens", () => {
        const { container } = render(<AppHeader />);
        expectTokens(
            container.querySelector('a[href="/"][class*="relative"]'),
            "Home"
        );
        expectTokens(container.querySelector('a[href="/limited"]'), "Limited");
    });

    it("sizes the Admin trigger from the control-height tokens", () => {
        const { getByText } = render(<AppHeader />);
        expectTokens(getByText("Admin").closest("button"), "Admin trigger");
    });

    it("keeps the badge dot anchored to the link's top-right corner", () => {
        const { container } = render(<AppHeader gameBadge />);
        const home = container.querySelector('a[href="/"][class*="relative"]');
        const dot = home?.querySelector('[data-slot="nav-badge"]');
        expect(dot?.className).toContain("absolute");
        expect(dot?.className).toContain("top-0");
        expect(dot?.className).toContain("right-0");
    });
});
