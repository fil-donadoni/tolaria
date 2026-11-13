// The `check:ui` seam's trivial page (issue #9271): renders the server echo
// for the reserved `?__uiseam_echo=` parameter. Convex and the router's search
// hook are mocked; the gates themselves are `convex/__tests__/uiSeam.test.ts`'s
// and `router-ui-seam.test.ts`'s.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UI_SEAM_ECHO_PARAM } from "@convex/lib/uiSeamNamespace";

const useQueryMock = vi.fn();
const useSearchMock = vi.fn();

vi.mock("convex/react", () => ({
    useQuery: (...args: unknown[]) => useQueryMock(...args),
}));
vi.mock("@tanstack/react-router", () => ({
    useSearch: () => useSearchMock(),
}));

import UiSeamEchoRoute from "../ui-seam/ui-seam-echo.route";

describe("UiSeamEchoRoute (issue #9271)", () => {
    beforeEach(() => {
        useQueryMock.mockReset();
        useSearchMock.mockReset();
    });

    it("asks the seam to echo the reserved parameter and prints the answer", () => {
        useSearchMock.mockReturnValue({ [UI_SEAM_ECHO_PARAM]: "ping" });
        useQueryMock.mockReturnValue({ runId: "a1b2c3d4e5f6", value: "ping" });
        render(<UiSeamEchoRoute />);
        expect(useQueryMock.mock.calls[0][1]).toEqual({ value: "ping" });
        expect(screen.getByTestId("ui-seam-echo-run").textContent).toBe(
            "a1b2c3d4e5f6"
        );
        expect(screen.getByTestId("ui-seam-echo-value").textContent).toBe(
            "ping"
        );
        expect(document.title).toContain("UI seam echo");
    });

    it("shows a loading line until the query answers", () => {
        useSearchMock.mockReturnValue({});
        useQueryMock.mockReturnValue(undefined);
        render(<UiSeamEchoRoute />);
        expect(useQueryMock.mock.calls[0][1]).toEqual({ value: undefined });
        expect(screen.getByText("Loading…")).toBeTruthy();
    });
});
