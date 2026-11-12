// Client highlight of Break the Ice's targets (CR 205.4a / 106.7): the REAL
// wire projection feeds `matchesPermanentTargetFilters`, so a dropped field
// would show up as an unclickable land.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup.helper";
import { breakTheIce } from "../../../convex/cards/sets/mh2/index.cards";
import { forest } from "../../../convex/cards/sets/lea/index.cards";
import { stripMine } from "../../../convex/cards/sets/atq/index.cards";
import { snowCoveredForest } from "../../../convex/cards/sets/ice/index.cards";
import { pendingTargetFiltersFromRequirement } from "../../../convex/gre/rules";
import { projectPublicState } from "../../../convex/gameProjections";
import type { PendingTarget } from "../../../convex/gre/state";
import { matchesPermanentTargetFilters } from "../card-utils";

describe("matchesPermanentTargetFilters — snow or could produce {C} (CR 205.4a / 106.7)", () => {
    it("highlights the snow land and the {C} land, not the plain Forest", () => {
        const req = breakTheIce().targetRequirement!;
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(forest().id, {
                            id: "forest",
                            controllerId: "p2",
                        }),
                        makeInstance(snowCoveredForest().id, {
                            id: "snow-forest",
                            controllerId: "p2",
                        }),
                        makeInstance(stripMine().id, {
                            id: "strip-mine",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "ice",
                targetType: req.type,
                count: 1,
                selected: [],
                ...pendingTargetFiltersFromRequirement(req, undefined),
            } as PendingTarget,
        });
        const projected = projectPublicState(state, 1, "p1");
        const pending = projected.pendingTarget as PendingTarget;
        const matches = (id: string) =>
            matchesPermanentTargetFilters(
                projected.players[1].battlefield.find((c) => c.id === id)!,
                pending,
                projected.players,
                projected.activePlayerId,
                undefined
            );
        expect(matches("snow-forest")).toBe(true);
        expect(matches("strip-mine")).toBe(true);
        expect(matches("forest")).toBe(false);
    });
});
