// The `check:ui` seam's Limited deck page (issue #9272): one save per mount
// for the fixture the URL names, then the Limited Deck Archive; a refusal
// printed where the lane reads it. The server half is
// `convex/__tests__/uiSeamShortcuts.test.ts`'s.
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    UI_SEAM_DECK_NAME_PARAM,
    UI_SEAM_FIXTURE_PARAM,
} from "@convex/lib/uiSeamNamespace";

const saveDeck = vi.fn();
const navigate = vi.fn();
const useSearchMock = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: () => saveDeck,
}));
vi.mock("@tanstack/react-router", () => ({
    useSearch: () => useSearchMock(),
    useNavigate: () => navigate,
}));

import UiSeamLimitedDeckRoute from "../ui-seam/ui-seam-limited-deck.route";

describe("UiSeamLimitedDeckRoute (issue #9272)", () => {
    beforeEach(() => {
        saveDeck.mockReset();
        navigate.mockReset();
        useSearchMock.mockReset();
    });

    it("saves the fixture seat's deck once, then routes to the archive", async () => {
        useSearchMock.mockReturnValue({
            [UI_SEAM_FIXTURE_PARAM]: "ui-gate-draft-1",
            [UI_SEAM_DECK_NAME_PARAM]: "ui-gate archive deck",
        });
        saveDeck.mockResolvedValue({ deckId: "d1", created: true });
        render(
            <StrictMode>
                <UiSeamLimitedDeckRoute />
            </StrictMode>
        );
        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(saveDeck).toHaveBeenCalledTimes(1);
        expect(saveDeck).toHaveBeenCalledWith({
            label: "ui-gate-draft-1",
            name: "ui-gate archive deck",
        });
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/decks",
            replace: true,
        });
    });

    it("prints a refusal and stays put", async () => {
        useSearchMock.mockReturnValue({
            [UI_SEAM_FIXTURE_PARAM]: "ui-gate-draft-1",
        });
        saveDeck.mockRejectedValue(new Error("ui seam: holds no seat"));
        render(<UiSeamLimitedDeckRoute />);
        expect(
            (await screen.findByTestId("ui-seam-limited-deck-error"))
                .textContent
        ).toContain("holds no seat");
        expect(navigate).not.toHaveBeenCalled();
    });

    it("calls nothing without a fixture label", async () => {
        useSearchMock.mockReturnValue({});
        render(<UiSeamLimitedDeckRoute />);
        expect(
            (await screen.findByTestId("ui-seam-limited-deck-error"))
                .textContent
        ).toContain(UI_SEAM_FIXTURE_PARAM);
        expect(saveDeck).not.toHaveBeenCalled();
    });
});
