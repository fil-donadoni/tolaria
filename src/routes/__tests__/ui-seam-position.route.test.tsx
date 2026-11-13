// The `check:ui` seam's declared-position page (issue #9272): one load per
// mount with the args the URL carries, the load recorded for the lane, then
// the board; a refusal printed where the lane reads it. Convex and the
// router are mocked; the server half is `convex/__tests__/uiSeamShortcuts.test.ts`'s.
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    UI_SEAM_POSITION_PARAM,
    UI_SEAM_POSITION_RECORD_KEY,
    UI_SEAM_UNLESS_AT_PARAM,
} from "@convex/lib/uiSeamNamespace";

const loadPosition = vi.fn();
const navigate = vi.fn();
const useSearchMock = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: () => loadPosition,
}));
vi.mock("@tanstack/react-router", () => ({
    useSearch: () => useSearchMock(),
    useNavigate: () => navigate,
}));

import UiSeamPositionRoute from "../ui-seam/ui-seam-position.route";

describe("UiSeamPositionRoute (issue #9272)", () => {
    beforeEach(() => {
        loadPosition.mockReset();
        navigate.mockReset();
        useSearchMock.mockReset();
        sessionStorage.clear();
    });

    it("loads once — even under StrictMode — records the load, then routes to the board", async () => {
        useSearchMock.mockReturnValue({
            [UI_SEAM_POSITION_PARAM]: "ui-gate board",
            [UI_SEAM_UNLESS_AT_PARAM]: "game1@7",
        });
        loadPosition.mockResolvedValue({
            gameId: "game1",
            seq: 7,
            loaded: false,
        });
        render(
            <StrictMode>
                <UiSeamPositionRoute />
            </StrictMode>
        );
        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(loadPosition).toHaveBeenCalledTimes(1);
        expect(loadPosition).toHaveBeenCalledWith({
            label: "ui-gate board",
            unlessAt: { gameId: "game1", seq: 7 },
        });
        expect(
            JSON.parse(sessionStorage.getItem(UI_SEAM_POSITION_RECORD_KEY)!)
        ).toEqual({
            label: "ui-gate board",
            gameId: "game1",
            seq: 7,
            loaded: false,
        });
        expect(navigate).toHaveBeenCalledWith({ to: "/game", replace: true });
    });

    it("prints a refusal and stays put", async () => {
        useSearchMock.mockReturnValue({
            [UI_SEAM_POSITION_PARAM]: "ui-gate board",
        });
        loadPosition.mockRejectedValue(
            new Error("ui seam: the lane account has no solo game in play")
        );
        render(<UiSeamPositionRoute />);
        expect(
            (await screen.findByTestId("ui-seam-position-error")).textContent
        ).toContain("no solo game in play");
        expect(navigate).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(UI_SEAM_POSITION_RECORD_KEY)).toBeNull();
    });

    it("calls nothing without a label", async () => {
        useSearchMock.mockReturnValue({});
        render(<UiSeamPositionRoute />);
        expect(
            (await screen.findByTestId("ui-seam-position-error")).textContent
        ).toContain(UI_SEAM_POSITION_PARAM);
        expect(loadPosition).not.toHaveBeenCalled();
    });
});
