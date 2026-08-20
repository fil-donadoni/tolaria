// `UserPreferencesEffect` (issue #2595) is the mechanism that makes a
// Settings change "switch the tokens live" — it publishes the saved
// density/motion onto `<html>` as `[data-density]`/`[data-motion]`, which
// `src/index.css` reads. Mounted once at the router root; this test proves
// the live-switch end to end: change what `useUserPreferences` (backed by
// the Convex query) resolves to, and `document.documentElement.dataset`
// updates on the next render — no page reload.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import UserPreferencesEffect from "../user-preferences-effect";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

beforeEach(() => {
    vi.clearAllMocks();
    useMutationMock.mockReturnValue(vi.fn());
    delete document.documentElement.dataset.density;
    delete document.documentElement.dataset.motion;
});

afterEach(() => {
    cleanup();
});

describe("UserPreferencesEffect", () => {
    it("renders nothing", () => {
        useQueryMock.mockReturnValue(null);
        const { container } = render(<UserPreferencesEffect />);
        // jest-dom's `toBeEmptyDOMElement` isn't type-checked in this
        // project (`tsconfig.app.json`'s restricted `types` array — see
        // `draft-lab-term-breakdown.test.tsx`), so this reads the raw markup.
        expect(container.innerHTML).toBe("");
    });

    it("publishes the saved density/motion onto <html> on mount", () => {
        useQueryMock.mockReturnValue({
            density: "compact",
            motion: "reduced",
            previewPreference: "computed",
        });
        render(<UserPreferencesEffect />);
        expect(document.documentElement.dataset.density).toBe("compact");
        expect(document.documentElement.dataset.motion).toBe("reduced");
    });

    it("falls back to the app's previous hard-coded defaults for a user who never saved", () => {
        useQueryMock.mockReturnValue(null);
        render(<UserPreferencesEffect />);
        expect(document.documentElement.dataset.density).toBe("roomy");
        expect(document.documentElement.dataset.motion).toBe("system");
    });

    it("switches the tokens LIVE — a re-render with a new saved value updates <html> without a reload", () => {
        useQueryMock.mockReturnValue({
            density: "roomy",
            motion: "system",
            previewPreference: "computed",
        });
        const { rerender } = render(<UserPreferencesEffect />);
        expect(document.documentElement.dataset.density).toBe("roomy");

        useQueryMock.mockReturnValue({
            density: "compact",
            motion: "reduced",
            previewPreference: "computed",
        });
        rerender(<UserPreferencesEffect />);
        expect(document.documentElement.dataset.density).toBe("compact");
        expect(document.documentElement.dataset.motion).toBe("reduced");
    });
});
