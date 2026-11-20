// Auto-order Settings section (issue #9988): off by default, and toggling it
// saves only `autoOrderPrompts` through `updateUserSettings`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import SettingsAutoOrderSection from "../settings-auto-order-section";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const update = vi.fn().mockResolvedValue(undefined);

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
    useMutationMock.mockReturnValue(update);
});

afterEach(() => {
    cleanup();
});

describe("SettingsAutoOrderSection", () => {
    it("is off for a user who has never saved", () => {
        useQueryMock.mockReturnValue(null);
        const { getByRole } = render(<SettingsAutoOrderSection />);
        expect(getByRole("checkbox").getAttribute("aria-checked")).toBe(
            "false"
        );
    });

    it("shows the saved value as on", () => {
        useQueryMock.mockReturnValue({ autoOrderPrompts: true });
        const { getByRole } = render(<SettingsAutoOrderSection />);
        expect(getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    });

    it("toggling saves only autoOrderPrompts", () => {
        useQueryMock.mockReturnValue(null);
        const { getByRole } = render(<SettingsAutoOrderSection />);
        fireEvent.click(getByRole("checkbox"));
        expect(update).toHaveBeenCalledWith({ autoOrderPrompts: true });
    });
});
