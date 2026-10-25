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

// CR 601.2c + CR 404.1 (issue #2912) — "cards from target player's graveyard":
// the lowered `zoneOwnerId` on the pending target reaches the same registry
// check the server runs, so only the announced player's graveyard is clickable.
describe("matchesGraveyardTarget — the announced player's graveyard", () => {
    const owned: PendingTarget = {
        ...pending([], false),
        zoneOwnerId: "p2",
    };

    it("marks only the announced player's graveyard cards", () => {
        expect(
            matchesGraveyardTarget(gyCard("b1"), "p2", owned, "p1", "p1")
        ).toBe(true);
        expect(
            matchesGraveyardTarget(gyCard("a1"), "p1", owned, "p1", "p1")
        ).toBe(false);
    });
});
