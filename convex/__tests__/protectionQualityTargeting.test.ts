// CR 702.16b end-to-end (issue #1120) — protection from a NON-COLOUR quality
// across the GRE → `game.ts` mutation boundary.
//
// The Phelia bug class: the OFFERED set (`getLegalTargets`, what the board
// lets you click) and the ACCEPTED set (the `selectTarget` mutation, what the
// server lets you commit) are two separate call sites. A quality honoured by
// one and not the other is a shipped bug in whichever direction it diverges —
// either an illegal target the server takes, or a legal one it refuses. This
// file drives BOTH through the real path for the same board and asserts they
// agree, for the quality row AND its must-NOT row.
//
// Harness discipline follows `distinctTargets.test.ts`: a stub `MutationCtx`
// driving the REGISTERED mutation's own `_handler`, never a reimplementation.

import { describe, it, expect } from "vitest";
import { selectTarget } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import {
    getLegalTargets,
    getPendingTargetSourceSupertypes,
    getPendingTargetSourceTypes,
    NO_TARGETING_SOURCE,
} from "../gre/rules";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

const TSABO_TAVOC = "ccbe2539-7a7c-468b-a270-7ca1bdcccb1e"; // Legendary Creature w/ protection from legendary creatures
const BARKTOOTH = "0ea52228-f8ad-4623-9e05-f162473bfc03"; // Legendary Creature
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // plain Creature

type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent" | "player" | "spell" | "graveyard-card";
    targetId: string;
};

const runSelectTarget = (
    ctx: Parameters<typeof runMutation>[1],
    targetId: string
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p2",
            targetType: "permanent",
            targetId,
        }
    );

/** p2 controls `sourceCardId` and is mid-selection for a "target creature"
 *  activated ability from it. p1 controls Tsabo Tavoc plus a plain bear. */
function boardWithPendingAbility(sourceCardId: string): GameState {
    const source = makeInstance(sourceCardId, {
        id: "source",
        controllerId: "p2",
        ownerId: "p2",
    });
    const tsabo = makeInstance(TSABO_TAVOC, {
        id: "tsabo",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bystander = makeInstance(GRIZZLY_BEARS, {
        id: "bystander",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [tsabo, bystander] }),
            makePlayer("p2", { battlefield: [source] }),
        ],
        pendingTarget: {
            playerId: "p2",
            cardInstanceId: "source",
            targetType: "Creature",
            // Open-ended max so a successful pick does NOT auto-finalize into
            // the ability-commit path (which needs an `abilityId` this harness
            // doesn't seed) — the sibling `distinctTargets.test.ts` convention.
            // The gate under test runs before finalization either way.
            count: { min: 1, max: 3 },
            kind: "ability",
            selected: [],
        },
    });
}

/** The OFFERED set, built exactly the way `legalActions.ts` builds it. */
function offered(state: GameState): string[] {
    return getLegalTargets(
        state,
        { type: "Creature", count: 1 },
        {
            ...NO_TARGETING_SOURCE,
            types: getPendingTargetSourceTypes(state, "source", "ability"),
            supertypes: getPendingTargetSourceSupertypes(
                state,
                "source",
                "ability"
            ),
            isSpell: false,
        },
        "p2",
        undefined,
        [],
        undefined
    ).map((t) => t.id);
}

describe("CR 702.16b — protection from a non-colour quality across GRE → game.ts", () => {
    it("a LEGENDARY CREATURE source: neither offered nor accepted", async () => {
        const state = boardWithPendingAbility(BARKTOOTH);
        // Offered set (what the board would make clickable).
        expect(offered(state)).not.toContain("tsabo");
        expect(offered(state)).toContain("bystander");

        // Accepted set (what the mutation commits).
        const harness = makeMutationCtx("p2", [gameStateSeed(state)]);
        await expect(runSelectTarget(harness.ctx, "tsabo")).rejects.toThrow(
            /protection/i
        );
        expect(harness.state().pendingTarget?.selected ?? []).toHaveLength(0);
    });

    it("must-NOT — a NON-legendary source: both offered AND accepted", async () => {
        const state = boardWithPendingAbility(GRIZZLY_BEARS);
        expect(offered(state)).toContain("tsabo");

        const harness = makeMutationCtx("p2", [gameStateSeed(state)]);
        await runSelectTarget(harness.ctx, "tsabo");
        expect(
            (harness.state().pendingTarget?.selected ?? []).map((s) => s.id)
        ).toEqual(["tsabo"]);
    });

    it("the legendary source can still commit an UNPROTECTED target", async () => {
        // Proves the rejection above is the protection gate specifically, not
        // a blanket failure of the mutation on this board.
        const state = boardWithPendingAbility(BARKTOOTH);
        const harness = makeMutationCtx("p2", [gameStateSeed(state)]);
        await runSelectTarget(harness.ctx, "bystander");
        expect(
            (harness.state().pendingTarget?.selected ?? []).map((s) => s.id)
        ).toEqual(["bystander"]);
    });
});
