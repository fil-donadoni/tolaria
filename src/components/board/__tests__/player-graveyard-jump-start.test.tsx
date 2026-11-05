// Jump-start graveyard-cast affordance (CR 702.133a). The label dispatch in
// `graveyard-flashback-button.tsx` defaults to "Flashback", so an unhandled
// `castKind` renders a silently wrong label with no type error: this file is
// what turns that into a red test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";

vi.mock("convex/react", () =>
    import("~/lib/testing/graveyard-cast-mocks").then((m) => m.convexReactMock)
);
vi.mock("@convex/_generated/api", () =>
    import("~/lib/testing/graveyard-cast-mocks").then((m) => m.gameApiMock)
);
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => ({
        name: "Idea",
        types: ["Instant"],
        manaCost: { X: 1, U: 1 },
    }),
    tryGetDefinition: () => undefined,
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: () => <div data-testid="selectable-card" />,
}));

import { announceCast } from "~/lib/testing/graveyard-cast-mocks";
import { renderGraveyardCard } from "~/lib/testing/render-graveyard";

function makeJumpStartCard(
    legalActions: CardInstance["legalActions"] = ["cast"]
): CardInstance {
    return {
        id: "gy-idea",
        card: { id: "idea-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions,
        castKind: "jump-start",
    };
}

describe("PlayerGraveyard jump-start cast affordance (CR 702.133a)", () => {
    beforeEach(() => {
        announceCast.mockClear();
        cleanup();
    });

    it('labels the button "Jump-start", not the Flashback default', () => {
        renderGraveyardCard(makeJumpStartCard(), "me");
        expect(screen.getByRole("button", { name: "Jump-start" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Flashback" })).toBeNull();
    });

    it("explains the discard in the disabled tooltip", () => {
        renderGraveyardCard(makeJumpStartCard([]), "me");
        const btn = screen.getByRole("button", { name: "Jump-start" });
        expect(btn.getAttribute("title")).toContain("discarding a card");
    });

    it("dispatches announceCast through the public mutation", () => {
        renderGraveyardCard(makeJumpStartCard(), "me");
        fireEvent.click(screen.getByRole("button", { name: "Jump-start" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "gy-idea",
        });
    });
});
