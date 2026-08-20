// Density Settings section (issue #2595): clicking an option saves through
// `updateUserSettings` with the new value, and the seeded (or previously
// saved) value shows as checked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import SettingsDensitySection from "../settings-density-section";

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

describe("SettingsDensitySection", () => {
    it("marks the saved density as checked", () => {
        useQueryMock.mockReturnValue({
            density: "compact",
            motion: "system",
            previewPreference: "computed",
        });
        const { getByRole } = render(<SettingsDensitySection />);
        // jest-dom's `toBeChecked` isn't type-checked in this project
        // (`tsconfig.app.json`'s restricted `types` array doesn't pick up
        // its augmentation — see `draft-lab-term-breakdown.test.tsx`), so
        // this reads the native `.checked` property directly.
        expect(
            (getByRole("radio", { name: /compact/i }) as HTMLInputElement)
                .checked
        ).toBe(true);
    });

    it("defaults to roomy for a user who has never saved (query resolves null)", () => {
        useQueryMock.mockReturnValue(null);
        const { getByRole } = render(<SettingsDensitySection />);
        expect(
            (getByRole("radio", { name: /roomy/i }) as HTMLInputElement).checked
        ).toBe(true);
    });

    it("picking a new option calls updateUserSettings with only the changed field", () => {
        useQueryMock.mockReturnValue({
            density: "roomy",
            motion: "system",
            previewPreference: "computed",
        });
        const { getByRole } = render(<SettingsDensitySection />);
        fireEvent.click(getByRole("radio", { name: /compact/i }));
        expect(update).toHaveBeenCalledWith({ density: "compact" });
    });
});
