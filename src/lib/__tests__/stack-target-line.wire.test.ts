// Frontend wire-format test for the stack panel's target LINE (ADR 0103,
// issue #2727), pinning issue #1735 review round 3 finding 1: a `resolveTargetName`
// hit on a battlefield/stack target must resolve display name through
// `displayCardId`, not the raw `card.card.id` — a face-down permanent's
// `card.card.id` is the CR 708.2 sentinel for EVERY viewer, including its own
// controller, and this file was missed by the round-2 census because it
// arrived from #2847/#2727 through the review's rebase, after the census ran.
//
// Per the frontend-wiring mandate the SURFACE assertion runs through the real
// `projectPublicState` for BOTH viewers, exactly like
// `battlefield-stacks.wire.test.ts`'s face-down coverage.

import { describe, it, expect } from "vitest";
import { stackTargetNames } from "../stack-target-line";
import { mahamotiDjinn } from "@convex/cards/sets/lea/blue";
import { lightningBolt } from "@convex/cards/sets/lea/red";
import { turnFaceDown } from "@convex/gre/faceDown";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import type { Player, StackItem } from "~/types/game";

/** p1's face-down Mahamoti Djinn on the battlefield, targeted by p2's
 *  Lightning Bolt still on the stack. */
function stateWithBoltOnFaceDownDjinn() {
    const djinn = makeInstance(mahamotiDjinn.id, {
        id: "djinn-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    turnFaceDown(djinn);
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [djinn] }), makePlayer("p2")],
    });
    pushSpell(state, lightningBolt.id, "p2", [
        { type: "permanent", id: "djinn-1" },
    ]);
    return state;
}

describe("stackTargetNames resolves a face-down target's display name (issue #1735 review round 3)", () => {
    // `knownCardId` is a wire-projection-only field (`projectStackItem` /
    // `projectBattlefieldCard`, `convex/gameProjections.ts`) — on the fat
    // engine state `displayCardId` is a correct no-op for every card, face
    // down or not, so the only meaningful assertion is post-projection, for
    // BOTH viewers (mirrors `battlefield-stacks.wire.test.ts`'s face-down
    // coverage, which is projection-only for the same reason).
    it("survives projectPublicState for BOTH viewers — controller keeps the real name, opponent sees the sentinel", () => {
        const state = stateWithBoltOnFaceDownDjinn();

        const p1View = projectPublicState(state, 1, "p1");
        const p1Names = stackTargetNames(
            p1View.stack[0] as unknown as StackItem,
            p1View.players as unknown as Player[],
            p1View.stack as unknown as StackItem[]
        );
        expect(p1Names).toEqual(["Mahamoti Djinn"]);

        const p2View = projectPublicState(state, 1, "p2");
        const p2Names = stackTargetNames(
            p2View.stack[0] as unknown as StackItem,
            p2View.players as unknown as Player[],
            p2View.stack as unknown as StackItem[]
        );
        expect(p2Names).toEqual(["Face-down creature"]);
    });
});
