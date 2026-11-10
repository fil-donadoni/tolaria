// Harmonize graveyard-cast affordance (CR 702.180). The label dispatch in
// `graveyard-flashback-button.tsx` defaults to "Flashback", and the creature
// to tap is part of the announcement (CR 702.180b): this file reds an
// unhandled `castKind` and a pick that never reaches `announceCast`.
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
        name: "Bears",
        types: ["Sorcery"],
        manaCost: { X: 2, U: 1 },
    }),
    tryGetDefinition: () => undefined,
    declaresCastPermission: () => false,
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: () => <div data-testid="selectable-card" />,
}));

import { announceCast } from "~/lib/testing/graveyard-cast-mocks";
import PlayerGraveyard from "~/components/board/player-graveyard";
import {
    makeTestPlayer,
    renderWithBoardContext,
} from "~/lib/testing/board-context";

function makeHarmonizeCard(
    legalActions: CardInstance["legalActions"] = ["cast"]
): CardInstance {
    return {
        id: "gy-stories",
        card: { id: "stories-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        legalActions,
        castKind: "harmonize",
    };
}

const BEAR: CardInstance = {
    id: "bf-bear",
    card: { id: "bear-def" },
    controllerId: "me",
    ownerId: "me",
    zone: "battlefield",
    isTapped: false,
    types: ["Creature"],
    subtypes: [],
    power: 2,
    toughness: 2,
};

function renderHarmonize(card: CardInstance, battlefield: CardInstance[]) {
    const player = makeTestPlayer({
        name: "Me",
        library: { count: 0 },
        graveyard: [card],
        battlefield,
    });
    return renderWithBoardContext(
        <PlayerGraveyard player={player} open onOpenChange={() => {}} />,
        {
            ctx: {
                playerId: "me",
                allPlayers: [player],
                onSwitchGame: () => {},
            },
        }
    );
}

describe("PlayerGraveyard harmonize cast affordance (CR 702.180)", () => {
    beforeEach(() => {
        announceCast.mockClear();
        cleanup();
    });

    it('labels the button "Harmonize", not the Flashback default', () => {
        renderHarmonize(makeHarmonizeCard(), []);
        expect(screen.getByRole("button", { name: "Harmonize" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Flashback" })).toBeNull();
    });

    it("explains the reduction in the disabled tooltip", () => {
        renderHarmonize(makeHarmonizeCard([]), []);
        const btn = screen.getByRole("button", { name: "Harmonize" });
        expect(btn.getAttribute("title")).toContain("harmonize cost");
    });

    it("with no untapped creature, announces at once with none", () => {
        renderHarmonize(makeHarmonizeCard(), [{ ...BEAR, isTapped: true }]);
        fireEvent.click(screen.getByRole("button", { name: "Harmonize" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).not.toHaveProperty(
            "harmonizeCreatureId"
        );
    });

    it("asks which creature to tap and sends the pick with the announcement", () => {
        renderHarmonize(makeHarmonizeCard(), [BEAR]);
        fireEvent.click(screen.getByRole("button", { name: "Harmonize" }));
        expect(announceCast).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole("button", { name: "Tap Bears (power 2)" })
        );
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "gy-stories",
            harmonizeCreatureId: "bf-bear",
        });
    });

    it('"Don\'t tap a creature" announces with none', () => {
        renderHarmonize(makeHarmonizeCard(), [BEAR]);
        fireEvent.click(screen.getByRole("button", { name: "Harmonize" }));
        fireEvent.click(
            screen.getByRole("button", { name: "Don't tap a creature" })
        );
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).not.toHaveProperty(
            "harmonizeCreatureId"
        );
    });
});
