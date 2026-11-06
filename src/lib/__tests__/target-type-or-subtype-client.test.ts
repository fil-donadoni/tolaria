// Issue #8230 — a "creature or Vehicle" target through the REAL wire projection:
// the client's offered set equals the server's, the prompt names the union, and
// the activation hint counts a candidate the same way.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { grizzlyBears, solRing } from "@convex/cards/sets/lea/index.cards";
import { registerTokenDefinition } from "@convex/cards";
import { makeVehicle } from "@convex/cards/abilities/vehicle";
import type { TargetRequirement } from "@convex/cards/types";
import { projectPublicState } from "@convex/gameProjections";
import {
    getLegalTargets,
    NO_TARGETING_SOURCE,
    pendingTargetFiltersFromRequirement,
} from "@convex/gre/rules";
import type { GameState } from "@convex/gre/state";
import { targetFilterRule } from "@convex/oracle/grammar/shared/targetFilter";
import {
    hasBattlefieldTargetCandidate,
    matchesPermanentTargetFilters,
    matchesTargetRequirement,
} from "~/lib/card-utils";
import { formatTargetLabel } from "~/lib/target-progress";
import type { CardInstance, PendingTarget, Player } from "~/types/game";

const VEHICLE_ID = "test-client-union-vehicle";
registerTokenDefinition(
    makeVehicle({
        id: VEHICLE_ID,
        name: "Test Client Union Vehicle",
        rarity: "common",
        manaCost: { X: 1 },
        oracleText: "Crew 1",
        power: 4,
        toughness: 3,
        crew: 1,
    })
);

/** The requirement the compiler emits, so the path starts at the grammar. */
function compiledRequirement(): TargetRequirement {
    const read = targetFilterRule.run("target creature or Vehicle", {
        card: { name: "Test" },
    });
    if (!read.ok) throw new Error(read.reason);
    return read.value;
}

function pendingFor(requirement: TargetRequirement): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "src",
        targetType: requirement.type,
        count: requirement.count,
        selected: [],
        ...pendingTargetFiltersFromRequirement(requirement, undefined),
    } as unknown as PendingTarget;
}

function board(cardIds: Record<string, string>): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: Object.entries(cardIds).map(([id, cardId]) =>
                    makeInstance(cardId, {
                        id,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

function projected(state: GameState) {
    const view = projectPublicState(state, 1, "p1");
    return view.players as unknown as Player[];
}

describe('"creature or Vehicle" on the client (issue #8230)', () => {
    it("rings exactly what the server offers, off the projected state", () => {
        const requirement = compiledRequirement();
        const state = board({
            bear: grizzlyBears().id,
            vehicle: VEHICLE_ID,
            ring: solRing().id,
        });
        const server = getLegalTargets(
            state,
            requirement,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        const pending = pendingFor(requirement);
        const players = projected(state);
        const client = players
            .flatMap((p) => p.battlefield as unknown as CardInstance[])
            .filter(
                (card) =>
                    matchesTargetRequirement(card, pending.targetType!) &&
                    matchesPermanentTargetFilters(
                        card,
                        pending,
                        players,
                        state.activePlayerId,
                        undefined
                    )
            )
            .map((c) => c.id);
        expect(client.sort()).toEqual(["bear", "vehicle"]);
        expect(client).toEqual([...server].sort());
    });

    it("the prompt names the union, never the widened card type", () => {
        const pending = pendingFor(compiledRequirement());
        expect(
            formatTargetLabel(
                pending.targetType!,
                pending.zone,
                pending.controller,
                pending.spellStackKind,
                pending.typeOrSubtypeFilter
            )
        ).toBe("a creature or a Vehicle");
    });

    it("CR 602.2b — a plain artifact alone is no candidate for the activation hint", () => {
        const requirement = compiledRequirement();
        const source = {
            id: "src",
            controllerId: "p1",
        } as unknown as CardInstance;
        const view = (state: GameState) => ({
            players: projected(state),
            activePlayerId: "p1",
        });
        expect(
            hasBattlefieldTargetCandidate(
                requirement,
                source,
                view(board({ ring: solRing().id })) as never
            )
        ).toBe(false);
        expect(
            hasBattlefieldTargetCandidate(
                requirement,
                source,
                view(board({ vehicle: VEHICLE_ID })) as never
            )
        ).toBe(true);
    });
});
