// Per-card graveyard-cast grant affordance (CR 601.3 / 118.9, issue
// #1344 — Malcolm, Alluring Scoundrel). A NON-LAND card in the viewer's own
// graveyard whose projection carries `legalActions` + `castKind:
// "graveyard-grant"` (gameProjections.ts `projectGraveyardCard`) must render
// a "Cast" button (GraveyardFlashbackButton, which also handles the
// Flashback/Escape/graveyard-permission labels) and dispatch `announceCast`
// — exactly like the BROAD `"graveyard-permission"` cast (issue #1149), but
// SPECIFIC to one granted card — while the OPPONENT gets no affordance at
// all. Mirrors `player-graveyard-cast-permission.test.tsx`'s coverage for
// the SAME button component's new `castKind` branch — closes the "frontend
// wiring is not optional" gap for the new Op.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";

// Capture the dispatch. useHandCardCommit calls useMutation(api.game.*).
vi.mock("convex/react", () =>
    import("~/lib/testing/graveyard-cast-mocks").then((m) => m.convexReactMock)
);
vi.mock("@convex/_generated/api", () =>
    import("~/lib/testing/graveyard-cast-mocks").then((m) => m.gameApiMock)
);
// A def with no X/kicker/modes/alt-costs (so onCastClick dispatches
// announceCast in one click, no dialog) and no activatedAbilities (so
// getGraveyardStackAbilities never offers an Activate button ahead of the
// Cast branch).
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => ({
        name: "Bear",
        types: ["Creature"],
        manaCost: { X: 2, G: 1 },
    }),
    tryGetDefinition: () => undefined,
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: () => <div data-testid="selectable-card" />,
}));

import { announceCast, playCard } from "~/lib/testing/graveyard-cast-mocks";
import { renderGraveyardCard } from "~/lib/testing/render-graveyard";

// The projection tags the SPECIFIC discarded card with `legalActions` +
// `castKind: "graveyard-grant"` only while it carries
// `castableFromGraveyardBy === viewerId` (gameProjections.ts
// `projectGraveyardCard`, issue #1344).
function makeGrantedGraveyardCard(
    legalActions: CardInstance["legalActions"] = ["cast"]
): CardInstance {
    return {
        id: "gy-malcolm-discard",
        card: { id: "bear-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions,
        castKind: "graveyard-grant",
    };
}

describe("PlayerGraveyard per-card graveyard-cast grant (issue #1344, CR 601.3 / 118.9)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("offers a Cast button (not Play/Flashback/Escape) on the granted card", () => {
        renderGraveyardCard(makeGrantedGraveyardCard(), "me");
        expect(screen.getByRole("button", { name: "Cast" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Flashback" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Escape" })).toBeNull();
    });

    it("casting the granted card dispatches announceCast via the public mutation", () => {
        renderGraveyardCard(makeGrantedGraveyardCard(), "me");
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "gy-malcolm-discard",
        });
        expect(playCard).not.toHaveBeenCalled();
    });

    it("offers NO cast affordance to the opponent viewer", () => {
        renderGraveyardCard(makeGrantedGraveyardCard(), "opp");
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
    });

    it("disables the Cast button and dispatches nothing when 'cast' is not legal (e.g. not sorcery timing)", () => {
        renderGraveyardCard(makeGrantedGraveyardCard([]), "me");
        const castBtn = screen.getByRole("button", {
            name: "Cast",
        }) as HTMLButtonElement;
        expect(castBtn.disabled).toBe(true);
        fireEvent.click(castBtn);
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("renders NO affordance at all once the grant has expired (legalActions undefined)", () => {
        // Once CLEANUP clears a "this-turn" window, `projectGraveyardCard`
        // stops attaching `legalActions`/`castKind`.
        const card = makeGrantedGraveyardCard();
        delete (card as { legalActions?: unknown }).legalActions;
        delete (card as { castKind?: unknown }).castKind;
        renderGraveyardCard(card, "me");
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    });
});
