// A face-down object (CR 708.2 permanent/spell, CR 406.3 exiled card) renders
// a FACE-DOWN FACE — never Scryfall art, and never a 404 fetch for the
// `face-down:2-2-vanilla` sentinel, which has no printing.
//
// Issue #2904 widened this on two axes:
//  - it holds for the CONTROLLER too, not just the viewers the projection
//    already hid the identity from. The board face used to prefer the
//    identification id, so a morph and a face-up copy of the same creature
//    were pixel-identical on their controller's own board.
//  - the face-down branch no longer returns BEFORE the `CardPreview` wrapper,
//    which used to leave a face-down card the one card on the board with no
//    hover/hold/pin preview at all.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FACE_DOWN_CARD_ID, getCardByName } from "@convex/cards";
import { makeInstance } from "@convex/cards/__tests__/setup";
import { turnFaceDown } from "@convex/gre/faceDown";
import type { CardInstance } from "~/types/game";

// CardPreview owns the hover dock (game-context / portals) — stub it to a
// MARKER around its children, so we observe both what CardImage emits AND
// whether the preview affordance was wrapped around it at all.
vi.mock("../card-preview", () => ({
    default: ({
        cardId,
        children,
    }: {
        cardId: string;
        children: React.ReactNode;
    }) => (
        <div data-testid="preview-wrapper" data-preview-card-id={cardId}>
            {children}
        </div>
    ),
}));
vi.mock("../card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));

import CardImage from "../card-image";

const SERRA = getCardByName("Serra Angel");

describe("CardImage face-down face (CR 708.2 / issue #2904)", () => {
    beforeEach(() => cleanup());

    it("renders the card back for the face-down sentinel id", () => {
        const { container, getByTestId } = render(
            <CardImage card={{ id: FACE_DOWN_CARD_ID }} />
        );
        expect(getByTestId("card-back")).toBeTruthy();
        // No <img> fetch for the non-existent sentinel art.
        expect(container.querySelector("img")).toBeNull();
    });

    it("is never preview-less — the affordance wraps the card back too", () => {
        const { getByTestId } = render(
            <CardImage card={{ id: FACE_DOWN_CARD_ID }} />
        );
        const wrapper = getByTestId("preview-wrapper");
        expect(wrapper.getAttribute("data-preview-card-id")).toBe(
            FACE_DOWN_CARD_ID
        );
        expect(wrapper.querySelector("[data-testid='card-back']")).toBeTruthy();
    });

    it("renders the card back for the CONTROLLER's own face-down permanent, not the real art", () => {
        const morph = makeInstance(SERRA.id, {
            id: "fd-serra",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        turnFaceDown(morph, "morph");
        // The controller's own projection carries the identification id (CR
        // 708.5). Before #2904 that id is what painted the board face.
        const controllerView = {
            ...morph,
            knownCardId: SERRA.id,
        } as unknown as CardInstance;

        const { container, getByTestId } = render(
            <CardImage card={controllerView} />
        );
        expect(getByTestId("card-back")).toBeTruthy();
        expect(container.querySelector("img")).toBeNull();
        // The preview — where CR 708.5's entitlement genuinely belongs — is
        // still offered, keyed on the sentinel.
        expect(
            getByTestId("preview-wrapper").getAttribute("data-preview-card-id")
        ).toBe(FACE_DOWN_CARD_ID);
    });
});
