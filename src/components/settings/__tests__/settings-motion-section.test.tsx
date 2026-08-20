// Motion Settings section (issue #2595) — same wiring as density, over the
// motion field.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import SettingsMotionSection from "../settings-motion-section";

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

describe("SettingsMotionSection", () => {
    it("marks the saved motion as checked", () => {
        useQueryMock.mockReturnValue({
            density: "roomy",
            motion: "reduced",
            previewPreference: "computed",
        });
        const { getByRole } = render(<SettingsMotionSection />);
        // jest-dom's `toBeChecked` isn't type-checked in this project
        // (`tsconfig.app.json`'s restricted `types` array — see
        // `draft-lab-term-breakdown.test.tsx`), so this reads the native
        // `.checked` property directly.
        expect(
            (getByRole("radio", { name: /reduced/i }) as HTMLInputElement)
                .checked
        ).toBe(true);
    });

    it("defaults to system for a user who has never saved", () => {
        useQueryMock.mockReturnValue(null);
        const { getByRole } = render(<SettingsMotionSection />);
        expect(
            (getByRole("radio", { name: /^system/i }) as HTMLInputElement)
                .checked
        ).toBe(true);
    });

    it("picking Reduced calls updateUserSettings with only motion", () => {
        useQueryMock.mockReturnValue({
            density: "roomy",
            motion: "system",
            previewPreference: "computed",
        });
        const { getByRole } = render(<SettingsMotionSection />);
        fireEvent.click(getByRole("radio", { name: /reduced/i }));
        expect(update).toHaveBeenCalledWith({ motion: "reduced" });
    });
});
