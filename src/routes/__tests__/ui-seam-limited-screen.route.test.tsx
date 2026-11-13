// The `check:ui` seam's Limited screen page (issue #9560): the fixture's event
// resolved once, then the screen the URL names; a refusal printed where the
// lane reads it. The server half is `convex/__tests__/uiSeam.test.ts`'s.
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    UI_SEAM_FIXTURE_PARAM,
    UI_SEAM_SCREEN_PARAM,
} from "@convex/lib/uiSeamNamespace";

const query = vi.fn();
const navigate = vi.fn();
const useSearchMock = vi.fn();

vi.mock("convex/react", () => ({
    useConvex: () => ({ query }),
}));
vi.mock("@tanstack/react-router", () => ({
    useSearch: () => useSearchMock(),
    useNavigate: () => navigate,
}));

import UiSeamLimitedScreenRoute from "../ui-seam/ui-seam-limited-screen.route";

describe("UiSeamLimitedScreenRoute (issue #9560)", () => {
    beforeEach(() => {
        query.mockReset();
        navigate.mockReset();
        useSearchMock.mockReset();
    });

    it.each([
        ["draft", "/limited/$eventId/draft"],
        ["build", "/limited/$eventId/build"],
        ["event", "/limited/$eventId"],
    ])("routes the %s screen to %s once", async (screenName, to) => {
        useSearchMock.mockReturnValue({
            [UI_SEAM_FIXTURE_PARAM]: "ui-gate/abc/draft",
            [UI_SEAM_SCREEN_PARAM]: screenName,
        });
        query.mockResolvedValue("evt1");
        render(
            <StrictMode>
                <UiSeamLimitedScreenRoute />
            </StrictMode>
        );
        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][1]).toEqual({ label: "ui-gate/abc/draft" });
        expect(navigate).toHaveBeenCalledWith({
            to,
            params: { eventId: "evt1" },
            replace: true,
        });
    });

    it("prints a refusal and stays put", async () => {
        useSearchMock.mockReturnValue({
            [UI_SEAM_FIXTURE_PARAM]: "ui-gate/abc/draft",
            [UI_SEAM_SCREEN_PARAM]: "draft",
        });
        query.mockRejectedValue(new Error("ui seam: holds no seat"));
        render(<UiSeamLimitedScreenRoute />);
        expect(
            (await screen.findByTestId("ui-seam-limited-screen-error"))
                .textContent
        ).toContain("holds no seat");
        expect(navigate).not.toHaveBeenCalled();
    });

    it("calls nothing for an unknown screen", async () => {
        useSearchMock.mockReturnValue({
            [UI_SEAM_FIXTURE_PARAM]: "ui-gate/abc/draft",
            [UI_SEAM_SCREEN_PARAM]: "lobby",
        });
        render(<UiSeamLimitedScreenRoute />);
        expect(
            (await screen.findByTestId("ui-seam-limited-screen-error"))
                .textContent
        ).toContain(UI_SEAM_SCREEN_PARAM);
        expect(query).not.toHaveBeenCalled();
    });
});
