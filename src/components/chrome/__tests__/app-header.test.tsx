// Issue #2056 defect 3 amplification: the coordinator's browser measurement
// at 852x277 found the AppShell nav band alone (the `px-6 pt-6` wrapper in
// `app-shell.tsx` plus AppHeader's own ~88px `panel-physical` band) at 112px
// — 40% of the viewport, and OUTSIDE the original short-viewport treatment
// entirely (it lives above `<main>`, in `app-shell.tsx`). This pins the
// structural cuts that bring it down toward the ~40-44px target: jsdom can't
// resolve a pixel height, so these assert the CLASSES that drive the cut are
// present on the right elements, same pattern as the rest of the #2056 suite.
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

afterEach(() => cleanup());

describe("AppHeader — short-viewport chrome treatment (issue #2056 defect 3 amplification)", () => {
    it("the content row carries short-viewport padding/gap overrides", () => {
        const { container } = render(<AppHeader />);
        const contentRow = container.querySelector(
            "header > div.flex.flex-col"
        ) as HTMLElement;
        const classes = contentRow.className.split(/\s+/);
        expect(classes).toContain("short-viewport:py-1");
        expect(classes).toContain("short-viewport:gap-2");
    });

    it("hides the ornamental divider under short-viewport", () => {
        const { container } = render(<AppHeader />);
        const divider = container.querySelector(
            '[data-slot="ornamental-divider"]'
        ) as HTMLElement;
        expect(divider.className.split(/\s+/)).toContain(
            "short-viewport:hidden"
        );
    });

    it("hides the decorative corner-filigree frame under short-viewport", () => {
        const { container } = render(<AppHeader />);
        const frame = container.querySelector(
            '[data-slot="corner-filigree-frame"]'
        ) as HTMLElement;
        expect(frame.className.split(/\s+/)).toContain("short-viewport:hidden");
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
