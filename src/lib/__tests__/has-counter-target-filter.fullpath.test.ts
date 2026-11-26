// Client highlight of Floodpits Drowner's shuffle target (CR 122.1 — "target
// creature with a stun counter on it"): the REAL requirement, lowered by the
// engine and carried through the wire projection, feeds
// `matchesPermanentTargetFilters`, so a `hasCounter` dropped by either the
// lowering or the projection shows up as a wrong highlight.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup.helper";
import { getDefinition } from "../../../convex/cards";
import { pendingTargetFiltersFromRequirement } from "../../../convex/gre/rules";
import { projectPublicState } from "../../../convex/gameProjections";
import type { PendingTarget } from "../../../convex/gre/state";
import { matchesPermanentTargetFilters } from "../card-utils";

const FLOODPITS_DROWNER = "a6a62aa3-8edb-4000-8ebd-15ec4b00eed7";
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";

describe("matchesPermanentTargetFilters — a creature with a stun counter (CR 122.1)", () => {
    it("highlights the stunned creature, not the one without a counter", () => {
        const req = getDefinition(FLOODPITS_DROWNER).activatedAbilities!.find(
            (a) => a.id === "floodpits-drowner-shuffle"
        )!.targetRequirement!;
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(FLOODPITS_DROWNER, {
                            id: "drowner",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(GRIZZLY_BEARS, {
                            id: "stunned",
                            controllerId: "p2",
                            counters: { stun: 1 },
                        }),
                        makeInstance(GRIZZLY_BEARS, {
                            id: "plain",
                            controllerId: "p2",
                        }),
                    ],
                }),
            ],
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "drowner",
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
        expect(matches("stunned")).toBe(true);
        expect(matches("plain")).toBe(false);
    });
});
