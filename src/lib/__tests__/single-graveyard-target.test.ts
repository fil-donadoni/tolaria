// CR 404.1 + CR 601.2c — the client mirror of "from a single graveyard":
// `matchesGraveyardTarget` greys out the other graveyard once one card is
// picked, from the same registry check the server's `selectTarget` runs.

import { describe, it, expect } from "vitest";
import type { CardInstance, PendingTarget } from "~/types/game";
import { matchesGraveyardTarget } from "~/lib/graveyard-targets";

const gyCard = (id: string): CardInstance =>
    ({ id, types: ["Creature"] }) as unknown as CardInstance;

const pending = (
    selected: PendingTarget["selected"],
    sameController: boolean
): PendingTarget => ({
    playerId: "p1",
    cardInstanceId: "spell",
    targetType: "card",
    zone: "graveyard",
    controller: "any",
    sameController,
    count: { min: 0, max: 3 },
    selected,
});

describe("matchesGraveyardTarget — a single graveyard", () => {
    const picked: PendingTarget["selected"] = [
        { type: "graveyard-card", id: "a1", playerId: "p1" },
    ];

    it("greys out the other graveyard once one card is picked", () => {
        expect(
            matchesGraveyardTarget(
                gyCard("b1"),
                "p2",
                pending(picked, true),
                "p1",
                "p1"
            )
        ).toBe(false);
        expect(
            matchesGraveyardTarget(
                gyCard("a2"),
                "p1",
                pending(picked, true),
                "p1",
                "p1"
            )
        ).toBe(true);
    });

    it("offers both graveyards when the requirement is not constrained", () => {
        expect(
            matchesGraveyardTarget(
                gyCard("b1"),
                "p2",
                pending(picked, false),
                "p1",
                "p1"
            )
        ).toBe(true);
    });
});
