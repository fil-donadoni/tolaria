import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import ManaPileView from "../mana-pile-view";

vi.mock("~/components/cards/card-image", () => ({ default: () => null }));

describe("ManaPileView (issue #8387)", () => {
    it("piles an alternate printing by its definition's Mana Value, not in the Catch-All", () => {
        const { getByText, queryByText } = render(
            <ManaPileView
                cards={[
                    {
                        cardId: "aaaaaaaa-0000-4000-8000-000000000001",
                        cardName: "Lightning Bolt",
                    },
                ]}
            />
        );
        expect(queryByText("Catch-All")).toBeNull();
        expect(getByText("MV 1")).toBeTruthy();
    });
});
