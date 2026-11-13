// The `check:ui` seam's sideboarding page (issue #9560): the gate forced once
// per mount, then the board; a refusal printed where the lane reads it. The
// server half is `convex/uiSeam.ts`'s `forceSideboarding`.
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const force = vi.fn();
const navigate = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: () => force,
}));
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

import UiSeamSideboardingRoute from "../ui-seam/ui-seam-sideboarding.route";

describe("UiSeamSideboardingRoute (issue #9560)", () => {
    beforeEach(() => {
        force.mockReset();
        navigate.mockReset();
    });

    it("forces the gate once, then routes to the board", async () => {
        force.mockResolvedValue({ gameId: "g1", forced: true });
        render(
            <StrictMode>
                <UiSeamSideboardingRoute />
            </StrictMode>
        );
        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(force).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith({ to: "/game", replace: true });
    });

    it("prints a refusal and stays put", async () => {
        force.mockRejectedValue(new Error("ui seam: no solo game in play"));
        render(<UiSeamSideboardingRoute />);
        expect(
            (await screen.findByTestId("ui-seam-sideboarding-error"))
                .textContent
        ).toContain("no solo game in play");
        expect(navigate).not.toHaveBeenCalled();
    });
});
