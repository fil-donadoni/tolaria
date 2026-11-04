// CR 702.73a — a changeling token's placeholder has a line the width of a card
// to fill, so every creature type reads as one phrase.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CREATURE_SUBTYPES } from "@convex/oracle/grammar/shared/subtypes";
import TokenPlaceholder from "../token-placeholder";

describe("TokenPlaceholder on a changeling token (CR 702.73a)", () => {
    it("renders one phrase instead of every creature type", () => {
        render(
            <TokenPlaceholder
                name="Shapeshifter"
                types={["Creature"]}
                subtypes={[...CREATURE_SUBTYPES]}
            />
        );
        expect(
            screen.getByText("Token — Creature — Every creature type")
        ).toBeTruthy();
    });
});
