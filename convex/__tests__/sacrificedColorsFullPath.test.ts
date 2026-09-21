// The cost-sacrificed COLOUR read, end to end (CR 105.2 / 601.2f / 608.2h,
// issue #3806).
//
// Mind Extraction's "discards all cards of each of the sacrificed creature's
// colors" reads a permanent that is already in the graveyard: the additional
// cost is paid at ANNOUNCEMENT (CR 601.2f), long before the spell resolves, so
// the colours can only be last known information (CR 608.2h). This file covers
// the whole path in one place, per the project's crosses-GRE→game.ts→UI rule:
//
//   - Integration: the exact function the mutation calls —
//     `finalizeTargetSelection` (the targeted cast commit) over real GRE state.
//     The project has no convex-test harness for game.ts mutations (ADR 0001);
//     this is the established substitute `additionalCostLegChoice.test.ts` and
//     `delveCastCost.test.ts` use.
//   - Resolution: the stamped snapshot drives the discard, and a colourless
//     victim discards NOTHING (CR 105.2c) rather than the whole hand.
//   - Layer 5: the victim's colour is read through the layer pipeline
//     (CR 613.1e), so a painted creature is snapshotted painted.
//   - Wire format: the snapshot survives `projectPublicState` and the
//     `compactState`/`expandState` round trip un-slimmed — a stack item that
//     lost its colours across a save would resolve into an empty discard on
//     the very next tick.
//   - Search sandbox + Bot reachability: split out to
//     `convex/gre/__tests__/sacrificedColorsInSearch.bot.test.ts` (the
//     bot-suite boundary keeps every bot-module importer in the bot suite).

import { describe, expect, it } from "vitest";
import { finalizeTargetSelection } from "../game";
import { projectPublicState } from "../gameProjections";
import { compactState, expandState } from "../gre/serialize";
import {
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
} from "../gre/state";
import { getDefinition } from "../cards/index";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { Color } from "../cards/types";

const MIND_EXTRACTION = getDefinition("7d77ddcc-e66b-4036-8a55-ec42953918d1");
const SWAMP = "6176936d-72e2-4205-8871-4c5a4f1cb2d8";
/** Grizzly Bears — {1}{G}, the green victim. */
const GREEN_CREATURE = "ce2d603a-3231-4a8c-bf39-1617586ea870";
/** Ornithopter — colourless (CR 105.2c). */
const COLORLESS_CREATURE = "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0";
/** Dark Ritual — black. */
const BLACK_CARD = "ebb6664d-23ca-456e-9916-afcd6f26aa7f";
/** Lightning Bolt — red. */
const RED_CARD = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

/** p1 holds Mind Extraction with three Swamps and ONE creature to sacrifice
 *  (exactly one, so the cost auto-resolves rather than parking); p2 holds a
 *  green creature, a black card and a red card. */
function board(victimDef: string, victimColors?: Color[]): GameState {
    const spell = makeInstance(MIND_EXTRACTION.id, {
        id: "mx",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const victim = makeInstance(victimDef, {
        id: "victim",
        controllerId: "p1",
        ownerId: "p1",
    });
    if (victimColors) victim.colorOverride = victimColors;
    const lands = Array.from({ length: 3 }, (_, i) =>
        makeInstance(SWAMP, {
            id: `swamp${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const hand = [GREEN_CREATURE, BLACK_CARD, RED_CARD].map((defId, i) =>
        makeInstance(defId, {
            id: `h${i}`,
            zone: "hand",
            controllerId: "p2",
            ownerId: "p2",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                battlefield: [victim, ...lands],
                manaPool: { B: 1, C: 2 },
            }),
            makePlayer("p2", { hand }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** The `pendingTarget` `announceCast` writes for a targeted Mind Extraction. */
function pendingTarget(): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "mx",
        requirement: MIND_EXTRACTION.targetRequirement!,
        selected: [{ type: "player", id: "p2" }],
        keepPriority: false,
    } as unknown as PendingTarget;
}

describe("Mind Extraction — the cost sacrifice snapshots its COLOURS (CR 105.2 / 601.2f / 608.2h, issue #3806)", () => {
    it("commits the cast, sacrifices the creature and stamps its colours on the stack item", () => {
        const state = board(GREEN_CREATURE);
        finalizeTargetSelection(state, pendingTarget(), "p1");
        expect(state.stack).toHaveLength(1);
        const snap = state.stack[0].additionalSacrificeSnapshot;
        expect(snap?.cardInstanceId).toBe("victim");
        expect(snap?.colors).toEqual(["G"]);
        // The victim really left the battlefield to pay the cost (CR 701.21).
        expect(
            state.players[0].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("victim");
    });

    it("resolves into exactly the discard of that colour (CR 701.9)", () => {
        const state = board(GREEN_CREATURE);
        finalizeTargetSelection(state, pendingTarget(), "p1");
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["h0"]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h1", "h2"]);
    });

    // CR 105.2c — the whole-hand fail-open this field is built against.
    it("a COLOURLESS victim discards NOTHING, not the whole hand (CR 105.2c)", () => {
        const state = board(COLORLESS_CREATURE);
        finalizeTargetSelection(state, pendingTarget(), "p1");
        expect(state.stack[0].additionalSacrificeSnapshot?.colors).toEqual([]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toEqual([
            "h0",
            "h1",
            "h2",
        ]);
    });

    // CR 613.1e layer 5 — a Painter's Servant-style colour override is the
    // colour the card IS, so the snapshot must read the derivation, never the
    // printed mana cost.
    it("snapshots the LAYER-5 colour, not the printed one (CR 613.1e)", () => {
        const state = board(GREEN_CREATURE, ["B", "R"]);
        finalizeTargetSelection(state, pendingTarget(), "p1");
        expect(
            [
                ...(state.stack[0].additionalSacrificeSnapshot?.colors ?? []),
            ].sort()
        ).toEqual(["B", "R"]);
        resolveTopOfStack(state);
        // The black and red cards go; the printed-green reading would have
        // taken h0 instead.
        expect(state.players[1].graveyard.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
        ]);
    });

    it("survives the wire projection and the persistence round trip un-slimmed", () => {
        const state = board(GREEN_CREATURE);
        finalizeTargetSelection(state, pendingTarget(), "p1");
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.stack[0].additionalSacrificeSnapshot?.colors).toEqual([
            "G",
        ]);
        const restored = expandState(compactState(state));
        expect(restored.stack[0].additionalSacrificeSnapshot?.colors).toEqual([
            "G",
        ]);
        // ... and the restored state resolves identically: a snapshot that
        // lost its colours across a save discards nothing on the next tick.
        resolveTopOfStack(restored);
        expect(restored.players[1].graveyard.map((c) => c.id)).toEqual(["h0"]);
    });
});
