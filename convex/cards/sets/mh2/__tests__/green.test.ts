// Per-card tests for mh2/green.ts.
//
// Endurance's ETB is a CR 603.3d targeted trigger: "up to one target player"
// is a real target chosen when the ability is put on the stack, declared as a
// `targetRequirement: { type: "player", count: { min: 0, max: 1 } }` and
// driven through `raiseTriggerTargetSelection` + `finalizeTargetSelection`
// (issue #1193), NOT a resolution-time `requestChoice`. The effect leg still
// uses the `putGraveyardOnBottomOfLibrary` primitive (#1207), so this card
// earns a hand-written test at the GRE target path, the real finalize path,
// and the wire projection.
import { describe, it, expect } from "vitest";
import { endurance } from "../green";
import { swamp, forest, grizzlyBears } from "../../lea";
import {
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";

// Put Endurance on p1's battlefield and fire its ETB so the trigger sits on the
// stack with an un-set target slot (`triggerSourceId` pinned by
// `collectTriggers`). `p2`'s graveyard holds `gyCount` cards and library holds
// `libCount` cards. Nothing is resolved yet — the CR 603.3d target is chosen
// via `chooseEndurancePlayer` before `resolveTopOfStack`.
function setupEndurance(opts: { gyCount: number; libCount: number }): {
    state: GameState;
} {
    const end = makeInstance(endurance.id, {
        id: "end1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const p2Graveyard = Array.from({ length: opts.gyCount }, (_, i) =>
        makeInstance(i % 2 === 0 ? swamp.id : grizzlyBears.id, {
            id: `p2-gy-${i}`,
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        })
    );
    const p2Library = Array.from({ length: opts.libCount }, (_, i) =>
        makeInstance(forest.id, {
            id: `p2-lib-${i}`,
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [end] }),
            makePlayer("p2", { graveyard: p2Graveyard, library: p2Library }),
        ],
    });
    const triggers = collectTriggers(state, [
        {
            type: "PERMANENT_ENTERED",
            instanceId: "end1",
            controllerId: "p1",
            cardId: endurance.id,
            types: ["Creature"],
        },
    ]);
    // Isolate the ETB from the (dormant, non-evoked) evoke-sacrifice trigger.
    const etb = triggers.find((t) => t.triggeredAbilityId === "endurance-etb");
    expect(etb).toBeDefined();
    state.stack.push(etb!);
    return { state };
}

/** Drives the CR 603.3d target choice through the real machinery:
 *  `raiseTriggerTargetSelection` raises the `kind:"trigger"` PendingTarget
 *  (count 0..1), then `finalizeTargetSelection` writes the chosen player
 *  target (or the empty "decline" set) onto the on-stack trigger. Returns the
 *  PendingTarget as raised so callers can assert on it. */
function chooseEndurancePlayer(
    state: GameState,
    playerId: string | null
): PendingTarget {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    const pt = state.pendingTarget!;
    pt.selected = playerId ? [{ type: "player", id: playerId }] : [];
    finalizeTargetSelection(state, pt, pt.playerId);
    return pt;
}

describe("Endurance (CR 603.3d trigger-time player target; #1193, #1207)", () => {
    it("raises a trigger PendingTarget owed to the controller, every player eligible", () => {
        const { state } = setupEndurance({ gyCount: 3, libCount: 2 });
        const raised = raiseTriggerTargetSelection(state);
        expect(raised).toBe(true);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("trigger");
        expect(pt.playerId).toBe("p1");
        // "Up to one" — a zero pick is legal.
        expect(pt.count).toEqual({ min: 0, max: 1 });
    });

    it("chosen player's graveyard goes to the BOTTOM of their library; top order preserved", () => {
        const { state } = setupEndurance({ gyCount: 3, libCount: 2 });
        const gyIds = state.players[1].graveyard.map((c) => c.id);
        chooseEndurancePlayer(state, "p2");
        expect(resolveTopOfStack(state)).not.toBeNull();
        const p2 = state.players[1];
        expect(p2.graveyard).toEqual([]);
        expect(p2.library).toHaveLength(5);
        // The pre-existing top two library cards keep their positions.
        expect(p2.library.slice(0, 2).map((c) => c.id)).toEqual([
            "p2-lib-0",
            "p2-lib-1",
        ]);
        // The three graveyard cards now occupy the bottom (as a set — the order
        // among them is a seeded shuffle).
        expect(new Set(p2.library.slice(2).map((c) => c.id))).toEqual(
            new Set(gyIds)
        );
        expect(state.pendingTarget).toBeUndefined();
    });

    it("declining the target (empty selection) is a no-op", () => {
        const { state } = setupEndurance({ gyCount: 3, libCount: 2 });
        chooseEndurancePlayer(state, null);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.players[1].graveyard).toHaveLength(3);
        expect(state.players[1].library).toHaveLength(2);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("the controller may target their OWN graveyard", () => {
        // p1 (Endurance's controller) with a graveyard of its own.
        const end = makeInstance(endurance.id, {
            id: "end1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gy = [
            makeInstance(swamp.id, {
                id: "p1-gy-0",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [end], graveyard: gy }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "end1",
                controllerId: "p1",
                cardId: endurance.id,
                types: ["Creature"],
            },
        ]);
        const etb = triggers.find(
            (t) => t.triggeredAbilityId === "endurance-etb"
        )!;
        state.stack.push(etb);
        chooseEndurancePlayer(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toEqual([]);
        expect(state.players[0].library.map((c) => c.id)).toContain("p1-gy-0");
    });

    it("wire format — the bottomed graveyard survives the public projection", () => {
        const { state } = setupEndurance({ gyCount: 3, libCount: 2 });
        chooseEndurancePlayer(state, "p2");
        resolveTopOfStack(state);
        // Project for p1 viewing (p2 is the opponent). The opponent's library is
        // slimmed to a count and the graveyard is public — both must reflect the
        // move.
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players[1];
        expect(p2.graveyard).toHaveLength(0);
        expect(p2.library.count).toBe(5);
    });
});
