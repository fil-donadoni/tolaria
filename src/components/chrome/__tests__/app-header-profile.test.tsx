// Issue #2056 defect 3 amplification: the browser measurement called out
// AppHeaderProfile's avatar (40px, the tallest element in the nav row) and
// its "two-line identity block" (nickname + email) as the AppHeader content
// row's height drivers. This pins the short-viewport shrink/hide on both.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, fireEvent, cleanup } from "@testing-library/react";

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
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

import AppHeaderProfile from "../app-header-profile";

afterEach(() => cleanup());

describe("AppHeaderProfile — short-viewport chrome treatment (issue #2056 defect 3 amplification)", () => {
    it("shrinks the avatar circle under short-viewport", () => {
        const { getByText } = render(<AppHeaderProfile />);
        const avatar = getByText("T"); // initial of "Tester"
        const classes = avatar.className.split(/\s+/);
        expect(classes).toContain("short-viewport:h-6");
        expect(classes).toContain("short-viewport:w-6");
    });

    it("hides the email line under short-viewport, keeping the row single-line", () => {
        const { getByText } = render(<AppHeaderProfile />);
        const email = getByText("tester@example.com");
        expect(email.className.split(/\s+/)).toContain("short-viewport:hidden");
    });

    it("does NOT hide the nickname under short-viewport — only the second line drops", () => {
        const { getByText } = render(<AppHeaderProfile />);
        const nickname = getByText("Tester");
        expect(nickname.className.split(/\s+/)).not.toContain(
            "short-viewport:hidden"
        );
    });
});

describe("AppHeaderProfile — Settings entry point (issue #2595)", () => {
    it("navigates to /settings when clicked", () => {
        const { getByRole } = render(<AppHeaderProfile />);
        fireEvent.click(getByRole("button", { name: /settings/i }));
        expect(navigate).toHaveBeenCalledWith({ to: "/settings" });
    });
});

describe("AppHeaderProfile — coarse-pointer touch target (issue #2595 round-3 fixup)", () => {
    // Browser-measured (five viewports, ADR 0101): Settings and Sign out are
    // `Button size="sm"`, which resolves its height off `--control-h-sm` —
    // the DELIBERATELY dense rung 4px under `--control-h` that pills like
    // `.segment-pill` use on purpose (40px on a coarse pointer). Settings and
    // Sign out ARE the touch target here, not a dense pill, so they need the
    // full `--control-h` rung — 44px under `pointer: coarse`, same fix
    // `EditingActionButton` already applies for the same WCAG 2.5.8 reason
    // (`src/components/editing/editing-action-button.tsx`).
    it("Settings and Sign out opt into the full --control-h rung, not the dense --control-h-sm one", () => {
        const { getByRole } = render(<AppHeaderProfile />);
        const settings = getByRole("button", { name: /settings/i });
        const signOut = getByRole("button", { name: /sign out/i });
        for (const el of [settings, signOut]) {
            const classes = el.className.split(/\s+/);
            expect(classes).toContain("min-h-[var(--control-h)]");
            expect(classes).not.toContain("min-h-[var(--control-h-sm)]");
        }
    });

    // The other half of the ≥44px acceptance criterion (mirrors
    // `peek-panel.test.tsx`'s CTA-row proof): the class above commits to the
    // token; this asserts the token itself is 44px under `pointer: coarse` —
    // neither alone proves the contract.
    it("--control-h resolves to 44px on a coarse pointer", () => {
        const css = readFileSync(
            resolve(process.cwd(), "src/index.css"),
            "utf8"
        );
        expect(css).toMatch(/--control-h-coarse:\s*44px/);
        const coarseBlock = css.slice(css.indexOf("@media (pointer: coarse)"));
        expect(coarseBlock).toMatch(/--control-h:\s*var\(--control-h-coarse\)/);
    });
});
