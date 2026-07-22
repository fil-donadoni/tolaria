// Regression (colour bug): Flash of Insight's flashback cost is "Exile X BLUE
// cards from your graveyard" (CR 105.2 / 202.2). A basic Island TAPS for blue
// but is COLOURLESS (CR 105.2a), so it must NOT be selectable in the exile-cost
// picker. The bug used getCardColors (deck-builder colour IDENTITY, which folds
// a land's produced mana into its colours) instead of the card's actual colour;
// the fix routes the eligibility filter through `cardHasColor`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { selectCastExileCost: {}, cancelCast: {} } },
}));
// Real-shaped defs: a blue creature ({1}{U}) vs a basic Island (no mana cost,
// Island subtype). `cardHasColor` (the real, unmocked function) reads mana-cost
// colours, so the Island resolves to colourless.
vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) =>
        id === "island-def"
            ? { name: "Island", types: ["Land"], subtypes: ["Island"] }
            : id === "blue-def"
              ? {
                    name: "Blue Elemental",
                    types: ["Creature"],
                    manaCost: { generic: 1, U: 1 },
                }
              : {
                    name: "Flash of Insight",
                    types: ["Instant"],
                    manaCost: { X: "X", generic: 1, U: 1 },
                },
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));

import CastExileCostDialog from "../cast-exile-cost-dialog";

function me(): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [
            {
                id: "foi",
                card: { id: "foi-def" },
                controllerId: "me",
                ownerId: "me",
                zone: "graveyard",
                isTapped: false,
            },
            {
                id: "blue1",
                card: { id: "blue-def" },
                controllerId: "me",
                ownerId: "me",
                zone: "graveyard",
                isTapped: false,
            },
            {
                id: "island1",
                card: { id: "island-def" },
                controllerId: "me",
                ownerId: "me",
                zone: "graveyard",
                isTapped: false,
            },
        ],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

describe("CastExileCostDialog blue-card filter (CR 105.2a — Island is colourless)", () => {
    beforeEach(cleanup);

    it("offers the blue card but NOT the Island as a payment for 'exile a blue card'", () => {
        render(
            <CastExileCostDialog
                choice={{ count: 1, color: "U", excludeInstanceId: "foi" }}
                me={me()}
                gameId={"g" as never}
                playerId="me"
            />
        );
        // The blue card is selectable...
        expect(
            screen.getByRole("button", { name: "Blue Elemental" })
        ).toBeTruthy();
        // ...the Island is not (colourless), and neither is Flash of Insight
        // (excluded as the flashback card itself).
        expect(screen.queryByRole("button", { name: "Island" })).toBeNull();
        expect(
            screen.queryByRole("button", { name: "Flash of Insight" })
        ).toBeNull();
    });
});
