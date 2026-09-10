// Issue #2932 — the card preview must SAY a permanent is a token. CR 111.1 (a
// token represents a permanent not represented by a card) and CR 111.7 (a token
// in a zone other than the battlefield ceases to exist, as an SBA) make this
// gameplay-relevant rather than cosmetic. Walks the real reducer
// (`buildPreviewBody`) into the real face component, so a field dropped in
// EITHER place fails here — a hand-built `PreviewBodyContent` would only pin
// the component half.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { getCardByName } from "@convex/cards";
import { buildPreviewBody } from "~/lib/preview-body";
import CardPreviewFace from "../card-preview-face";
import type { CardInstance } from "~/types/game";

const SERRA = getCardByName("Serra Angel");
const CLONE = getCardByName("Clone");

const TOKEN_LINE = /Token — ceases to exist if it leaves the battlefield\./;

function instance(overrides: Partial<CardInstance>): CardInstance {
    return {
        id: "inst-1",
        card: { id: SERRA.id },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: SERRA.types,
        subtypes: SERRA.subtypes ?? [],
        staticAbilities: SERRA.staticAbilities ?? [],
        ...overrides,
    } as CardInstance;
}

function renderFace(card: CardInstance) {
    const body = buildPreviewBody(card.card.id, card);
    return render(<CardPreviewFace {...body} size="md" />);
}

describe("card preview token line (issue #2932, CR 111.1 / 111.7)", () => {
    beforeEach(() => cleanup());

    it("states that a token is a token", () => {
        const { getByText } = renderFace(instance({ isToken: true }));
        expect(getByText(TOKEN_LINE)).toBeTruthy();
    });

    it("still states it for a token that COPIES a real card (CR 707.2)", () => {
        // Presents as Serra Angel — same name, same art, same characteristics.
        // Only the flag distinguishes it, so the line must ride on the flag.
        const { getByText } = renderFace(
            instance({ isToken: true, copiedFrom: CLONE.id })
        );
        expect(getByText(TOKEN_LINE)).toBeTruthy();
    });

    it("says nothing for a non-token permanent", () => {
        const { queryByText } = renderFace(instance({}));
        expect(queryByText(TOKEN_LINE)).toBeNull();
    });

    it("says nothing on the ORIGINAL (printed) face of a copy", () => {
        // That face is built with no live instance — it states the COPIED
        // card's printed identity, which is not itself a token.
        const original = buildPreviewBody(CLONE.id);
        const { queryByText } = render(
            <CardPreviewFace {...original} size="md" />
        );
        expect(queryByText(TOKEN_LINE)).toBeNull();
    });
});
