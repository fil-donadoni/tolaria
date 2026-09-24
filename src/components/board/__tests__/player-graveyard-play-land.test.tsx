// Play-lands-from-graveyard affordance (CR 305.1-analog, issue #1190 —
// Icetill Explorer). A LAND card in the viewer's own graveyard whose
// projection carries `legalActions` (no `castKind` — it's a "play", not a
// keyword cast) must be clickable/playable by its CONTROLLER from the
// Graveyard zone (routed through `playCard`, exactly like the hand/exile
// land-play paths), while the OPPONENT gets no affordance at all. Mirrors
// `player-exile-cast.test.tsx`'s cast-from-exile Play-button coverage
// (issue #946) for the graveyard-land case — this closes the "frontend
// wiring is not optional" gap: a card correct in the GRE (rules.ts /
// gameProjections.ts) is still dead in the UI unless a button component
// reads the projected `legalActions` and dispatches the right mutation.
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
// A def with no activatedAbilities (so getGraveyardStackAbilities never
// offers an Activate button ahead of the Play/Flashback branch) and no X/
// modes (so the commit fires in one click, no cost dialog).
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => ({ name: "Forest", types: ["Land"] }),
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

// The projection tags a graveyard LAND with `legalActions` (no `castKind`)
// only while `canPlayLandsFromGraveyard` holds for its controller
// (gameProjections.ts `projectGraveyardCard`).
function makeGraveyardLand(
    legalActions: CardInstance["legalActions"] = ["play"]
): CardInstance {
    return {
        id: "gy-land",
        card: { id: "forest-land-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions,
    };
}

describe("PlayerGraveyard play-lands-from-graveyard (#1190, CR 305.1-analog)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("offers a Play button (not a Flashback/Escape cast button) on a graveyard land under the permission", () => {
        renderGraveyardCard(makeGraveyardLand(), "me");
        expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Flashback" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Escape" })).toBeNull();
    });

    it("playing a graveyard land dispatches playCard via the public mutation", () => {
        renderGraveyardCard(makeGraveyardLand(), "me");
        fireEvent.click(screen.getByRole("button", { name: "Play" }));
        expect(playCard).toHaveBeenCalledTimes(1);
        expect(playCard.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "gy-land",
        });
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("offers NO play affordance to the opponent viewer", () => {
        renderGraveyardCard(makeGraveyardLand(), "opp");
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    });

    it("disables the Play button and dispatches nothing when 'play' is not legal (no land drop remaining)", () => {
        // The projection still tags the card with an (empty) `legalActions`
        // array while the permission is active but the drop is spent — the
        // button must render disabled instead of not rendering at all.
        renderGraveyardCard(makeGraveyardLand([]), "me");
        const playBtn = screen.getByRole("button", {
            name: "Play",
        }) as HTMLButtonElement;
        expect(playBtn.disabled).toBe(true);
        fireEvent.click(playBtn);
        expect(playCard).not.toHaveBeenCalled();
    });

    it("renders NO affordance at all once the permission is gone (legalActions undefined)", () => {
        // Once the granting source (Icetill Explorer) leaves the battlefield,
        // `projectGraveyardCard` stops attaching `legalActions` entirely.
        const card = makeGraveyardLand();
        delete (card as { legalActions?: unknown }).legalActions;
        renderGraveyardCard(card, "me");
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Flashback" })).toBeNull();
    });
});
