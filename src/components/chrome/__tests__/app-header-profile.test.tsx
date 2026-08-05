// Issue #2056 defect 3 amplification: the browser measurement called out
// AppHeaderProfile's avatar (40px, the tallest element in the nav row) and
// its "two-line identity block" (nickname + email) as the AppHeader content
// row's height drivers. This pins the short-viewport shrink/hide on both.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

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
