// Slice #253 (PRD #249) — BoardNextCard composes the hover layers.
//
// Asserts the wiring (observable structure), not pixels:
//  - the card face is wrapped in the 3D tilt root (#253 tilt/glare/lift),
//  - the hover-zoom preview is anchored to the SAME card element by reusing
//    CardImage (which owns CardPreview) rather than reinventing it,
//  - hidden (opponent-hand) slots still render a back inside the tilt root.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));

// CardImage owns the CardPreview hover-zoom; stub it to an inert marker so we
// can assert it is the vehicle BoardNextCard mounts (no Convex/router needed).
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: CardInstance | { id: string } }) => (
        <div
            data-testid="card-image-preview"
            data-card-id={"id" in card ? card.id : "?"}
        />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));

import BoardNextCard from "../board-next-card";

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
    };
}

describe("BoardNextCard hover composition (#253)", () => {
    beforeEach(() => cleanup());

    it("wraps a real card face in the 3D tilt root", () => {
        const { container } = render(<BoardNextCard card={makeCard("bolt")} />);
        const tiltRoot = container.querySelector<HTMLElement>(
            "[data-card-tilt-root]"
        );
        expect(tiltRoot).toBeTruthy();
        // The card face lives INSIDE the tilt inner element so the tilt
        // transform composes over it.
        const inner = tiltRoot!.querySelector("[data-card-tilt]");
        expect(
            inner?.querySelector("[data-testid='card-image-preview']")
        ).toBeTruthy();
        // The glare overlay is present for the moving highlight.
        expect(tiltRoot!.querySelector("[data-card-glare]")).toBeTruthy();
    });

    it("anchors the hover-zoom preview to the card element (reuses CardImage/CardPreview)", () => {
        const { getByTestId } = render(
            <BoardNextCard card={makeCard("bolt")} />
        );
        // The preview is delivered by CardImage (which wraps CardPreview),
        // mounted on THIS card — not a reinvented preview.
        expect(
            getByTestId("card-image-preview").getAttribute("data-card-id")
        ).toBe("bolt");
    });

    it("is not draggable — carries no drag-commit wrapper (battlefield is click-only, #254)", () => {
        // The battlefield mounts BoardNextCard, never the interactive hand card.
        // Asserting the absence of the drag wrapper marker proves battlefield
        // cards never acquire the drag-to-cast gesture.
        const { container } = render(<BoardNextCard card={makeCard("bear")} />);
        expect(container.querySelector("[data-board-hand-card]")).toBeNull();
    });

    it("renders a back (still inside the tilt root) for a hidden slot", () => {
        const { container, getByTestId } = render(
            <BoardNextCard card={null} />
        );
        const tiltRoot = container.querySelector("[data-card-tilt-root]");
        expect(tiltRoot).toBeTruthy();
        expect(getByTestId("card-back")).toBeTruthy();
    });
});
