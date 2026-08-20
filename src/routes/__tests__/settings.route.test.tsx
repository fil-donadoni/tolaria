// /settings route smoke test (issue #2595): all four sections mount, and the
// page sets its document title.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import SettingsRoute from "../settings.route";

vi.mock("convex/react", () => ({
    useQuery: () => null,
    useMutation: () => vi.fn(),
}));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});
vi.mock("~/components/board/phase-stop-dot", () => ({
    default: ({
        active,
        onClick,
        ariaLabel,
    }: {
        active: boolean;
        onClick: () => void;
        ariaLabel: string;
    }) => (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            onClick={onClick}
        />
    ),
}));

afterEach(() => cleanup());

describe("SettingsRoute", () => {
    it("sets the document title", () => {
        render(<SettingsRoute />);
        expect(document.title).toContain("Settings");
    });

    it("renders all four Settings sections", () => {
        const { getByRole } = render(<SettingsRoute />);
        // `getByRole` throws when nothing matches, so a bare call already
        // proves presence — jest-dom's `toBeInTheDocument` isn't
        // type-checked in this project (`tsconfig.app.json`'s restricted
        // `types` array — see `draft-lab-term-breakdown.test.tsx`).
        expect(getByRole("heading", { name: "Density" })).toBeTruthy();
        expect(getByRole("heading", { name: "Motion" })).toBeTruthy();
        expect(getByRole("heading", { name: "Phase stops" })).toBeTruthy();
        expect(
            getByRole("heading", { name: "Card preview default" })
        ).toBeTruthy();
    });
});
