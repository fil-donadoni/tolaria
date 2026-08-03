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
    pendingTargetingSource,
    raiseTriggerTargetSelection,
} from "../gre/rules";
import { collectTriggers } from "../gre/triggers";
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

// ─────────────────────────────────────────────────────────────────────────
// Offered-set / accepted-set parity for a TRIGGER source (issue #1120 review)
// ─────────────────────────────────────────────────────────────────────────
//
// Round 1: the OFFERED side dropped CR 205.4a supertypes for triggers.
// Round 2 moved the divergence rather than closing it: the ACCEPTED side
// (`selectTarget`'s guard) still computed `isSpell: guardSourceKind !==
// "ability"`, i.e. it called a TRIGGERED ability a spell (CR 113.3), while the
// offered side had moved to the shared bundle.
//
// A test that checks only ONE side is what let round 2's divergence survive —
// so every case here drives BOTH: `getLegalTargets` (offered) and the real
// `selectTarget` handler (accepted), and asserts they agree.

const HALFDANE = "2e939761-3542-4044-9038-d1d30c6a38fc"; // Legendary Creature, mandatory-target upkeep trigger
const LURKER = "b39eb671-e17e-4c5a-8913-1e3be7faedfb"; // "can't be the target of SPELLS unless it attacked/blocked"

/** Halfdane's upkeep trigger on the stack with a `kind: "trigger"`
 *  PendingTarget owed to p1, and `others` on p2's battlefield. */
function halfdaneTriggerState(others: string[]): GameState {
    const halfdane = makeInstance(HALFDANE, {
        id: "halfdane",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase: "UPKEEP",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [halfdane] }),
            makePlayer("p2", {
                battlefield: others.map((cardId, i) =>
                    makeInstance(cardId, {
                        id: `t${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                    })
                ),
            }),
        ],
    });
    state.stack.push(
        ...collectTriggers(state, [
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p1" },
        ]).filter((t) => t.triggeredAbilityId === "halfdane-copy-pt")
    );
    raiseTriggerTargetSelection(state);
    return state;
}

/** The OFFERED set for the raised trigger, via the shared bundle. */
function triggerOffered(state: GameState): string[] {
    const pt = state.pendingTarget!;
    return getLegalTargets(
        state,
        { type: "Creature", count: 1 },
        pendingTargetingSource(state, pt.cardInstanceId, "trigger"),
        pt.playerId
    ).map((t) => t.id);
}

const runTriggerSelect = (
    ctx: Parameters<typeof runMutation>[1],
    targetId: string
) =>
    runMutation<SelectTargetArgs, void>(
        selectTarget as unknown as Handler<SelectTargetArgs, void>,
        ctx,
        { gameId: GAME_ID, playerId: "p1", targetType: "permanent", targetId }
    );

describe("offered/accepted parity for a kind:'trigger' source", () => {
    it("CR 113.3 — Lurker's SPELL-only guard does not bar a triggered ability, on BOTH sides", async () => {
        // Two creatures so a real choice is owed (no auto-select).
        const state = halfdaneTriggerState([LURKER, GRIZZLY_BEARS]);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");

        // OFFERED: Lurker is a legal target of a triggered ability.
        expect(triggerOffered(state)).toContain("t0");

        // ACCEPTED: the mutation must take the very same pick. Before the fix
        // the guard reported `isSpell: true` for a trigger and threw
        // "Target can't be the target of spells or abilities".
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runTriggerSelect(harness.ctx, "t0");
        // A `count: 1` trigger auto-finalizes onto the stack item, clearing
        // `pendingTarget` — read the committed target off the trigger.
        expect(harness.state().stack[0].targets).toEqual([
            { type: "permanent", id: "t0" },
        ]);
    });

    it("CR 702.16b — a protected permanent is refused by BOTH sides", async () => {
        // Halfdane is a legendary creature; Tsabo Tavoc has protection from
        // legendary creatures. Two other creatures keep a real choice open.
        const state = halfdaneTriggerState([
            TSABO_TAVOC,
            GRIZZLY_BEARS,
            GRIZZLY_BEARS,
        ]);
        expect(state.pendingTarget?.kind).toBe("trigger");

        expect(triggerOffered(state)).not.toContain("t0");
        expect(triggerOffered(state)).toContain("t1");

        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(runTriggerSelect(harness.ctx, "t0")).rejects.toThrow(
            /protection/i
        );
        expect(harness.state().pendingTarget?.selected ?? []).toHaveLength(0);
    });

    it("must-NOT — the unprotected creature is accepted by the same handler", async () => {
        const state = halfdaneTriggerState([
            TSABO_TAVOC,
            GRIZZLY_BEARS,
            GRIZZLY_BEARS,
        ]);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runTriggerSelect(harness.ctx, "t1");
        expect(harness.state().stack[0].targets).toEqual([
            { type: "permanent", id: "t1" },
        ]);
    });
});
