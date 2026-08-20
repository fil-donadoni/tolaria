// Card preview default Settings section (issue #2595) — same wiring as
// density/motion, over the previewPreference field.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import SettingsPreviewSection from "../settings-preview-section";

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

describe("SettingsPreviewSection", () => {
    it("marks the saved preview preference as checked", () => {
        useQueryMock.mockReturnValue({
            density: "roomy",
            motion: "system",
            previewPreference: "printed",
        });
        const { getByRole } = render(<SettingsPreviewSection />);
        // jest-dom's `toBeChecked` isn't type-checked in this project
        // (`tsconfig.app.json`'s restricted `types` array — see
        // `draft-lab-term-breakdown.test.tsx`), so this reads the native
        // `.checked` property directly.
        expect(
            (getByRole("radio", { name: /^printed/i }) as HTMLInputElement)
                .checked
        ).toBe(true);
    });

    it("defaults to Oracle (computed) for a user who has never saved", () => {
        useQueryMock.mockReturnValue(null);
        const { getByRole } = render(<SettingsPreviewSection />);
        expect(
            (getByRole("radio", { name: /oracle/i }) as HTMLInputElement)
                .checked
        ).toBe(true);
    });

    it("picking Printed calls updateUserSettings with only previewPreference", () => {
        useQueryMock.mockReturnValue({
            density: "roomy",
            motion: "system",
            previewPreference: "computed",
        });
        const { getByRole } = render(<SettingsPreviewSection />);
        fireEvent.click(getByRole("radio", { name: /^printed/i }));
        expect(update).toHaveBeenCalledWith({ previewPreference: "printed" });
    });
});
