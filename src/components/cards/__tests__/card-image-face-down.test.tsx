// A face-down permanent (CR 708.2, ADR 0013) reaches non-controller viewers as
// the `face-down:2-2-vanilla` sentinel id (gameProjections hides the real
// identity). The sentinel has no Scryfall art — CardImage must render the card
// back, NOT fetch a 404 URL like
// `https://cards.scryfall.io/normal/front/f/a/face-down:2-2-vanilla.jpg`.
// The same path covers Memory Jar's face-down exile shown to the opponent.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FACE_DOWN_CARD_ID } from "@convex/cards";

// CardPreview owns the hover dock (game-context / portals) — stub to children
// so we observe exactly what CardImage emits.
vi.mock("../card-preview", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));

import CardImage from "../card-image";

describe("CardImage face-down sentinel", () => {
    beforeEach(() => cleanup());

    it("renders the card back for the face-down sentinel id", () => {
        const { container, getByTestId } = render(
            <CardImage card={{ id: FACE_DOWN_CARD_ID }} />
        );
        expect(getByTestId("card-back")).toBeTruthy();
        // No <img> fetch for the non-existent sentinel art.
        expect(container.querySelector("img")).toBeNull();
    });
});
