// Frontend wire-format tests for the stack row's Targets block (issue #9326,
// superseding the phone-only name line of ADR 0103 / issue #2727).
//
// Per the frontend-wiring mandate every SURFACE assertion runs through the real
// `projectPublicState`: the projection strips fat fields, so a resolver that
// only works on the engine state passes here while the client breaks.
//
// - A graveyard-card target line needs the target's OWNER id and INSTANCE id
//   (which graveyard, which of three identical copies), and the targeted
//   graveyard in its viewer order — its position is the line's "#N".
// - A spell target line needs the targeted STACK ITEM id and the stack order:
//   "#N on the stack" is the number the stack panel shows on that row.
// - A face-down permanent target (issue #1735 review round 3) resolves its
//   display name through `displayCardId`: the controller keeps the real name,
//   the opponent sees the sentinel.

import { describe, it, expect } from "vitest";
import { stackTargetLines } from "../stack-target-line";
import { mahamotiDjinn } from "@convex/cards/sets/lea/blue.cards";
import { counterspell } from "@convex/cards/sets/lea/blue.cards";
import { llanowarElves } from "@convex/cards/sets/lea/green.cards";
import { lightningBolt } from "@convex/cards/sets/lea/red.cards";
import { reanimate } from "@convex/cards/sets/tmp/black.cards";
import { turnFaceDown } from "@convex/gre/faceDown";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import type { Player, StackItem } from "~/types/game";
import { NO_BOARD_LAYER_VIEW } from "../../../convex/gre/layers";

/** Project for `viewer` and resolve the lines of stack item `index`. */
function linesFor(
    state: ReturnType<typeof makeState>,
    viewer: string,
    index: number
) {
    const view = projectPublicState(state, 1, viewer);
    const stack = view.stack as unknown as StackItem[];
    return stackTargetLines(
        stack[index],
        view.players as unknown as Player[],
        stack,
        viewer
    );
}

/** p1's face-down Mahamoti Djinn on the battlefield, targeted by p2's
 *  Lightning Bolt still on the stack. */
function stateWithBoltOnFaceDownDjinn() {
    const djinn = makeInstance(mahamotiDjinn().id, {
        id: "djinn-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    turnFaceDown(NO_BOARD_LAYER_VIEW, djinn, "morph");
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [djinn] }), makePlayer("p2")],
    });
    pushSpell(state, lightningBolt().id, "p2", [
        { type: "permanent", id: "djinn-1" },
    ]);
    return state;
}

/** Three identical Llanowar Elves in p2's graveyard; p1's Reanimate targets
 *  the MIDDLE one, and p2's Counterspell targets the Reanimate. */
function stateWithReanimateOnMiddleElf() {
    const elves = ["elf-a", "elf-b", "elf-c"].map((id) =>
        makeInstance(llanowarElves().id, {
            id,
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        })
    );
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2", { graveyard: elves })],
    });
    const reanimateItem = pushSpell(state, reanimate().id, "p1", [
        { type: "graveyard-card", id: "elf-b", playerId: "p2" },
    ]);
    pushSpell(state, counterspell().id, "p2", [
        { type: "spell", id: reanimateItem.id },
    ]);
    return state;
}

describe("stack target lines survive projectPublicState (issue #9326)", () => {
    it("a graveyard-card line names WHICH copy (#2 of three identical) and WHOSE graveyard", () => {
        const state = stateWithReanimateOnMiddleElf();
        // Reanimate is stack[0] (bottom); Counterspell stack[1] (top).
        const p1Lines = linesFor(state, "p1", 0);
        expect(p1Lines).toHaveLength(1);
        expect(p1Lines[0].title).toBe("Llanowar Elves");
        expect(p1Lines[0].where).toBe("#2 in p2's graveyard");
        expect(p1Lines[0].card?.id).toBe("elf-b");
        expect(p1Lines[0].target).toMatchObject({
            type: "graveyard-card",
            id: "elf-b",
            playerId: "p2",
        });

        // The graveyard's owner reads it as their own.
        expect(linesFor(state, "p2", 0)[0].where).toBe("#2 in your graveyard");
    });

    it("a spell line names the stack row number the panel shows on the target", () => {
        const state = stateWithReanimateOnMiddleElf();
        const lines = linesFor(state, "p1", 1);
        expect(lines).toHaveLength(1);
        expect(lines[0].title).toBe("Reanimate");
        // Two items: the top (Counterspell) is row #1, Reanimate row #2.
        expect(lines[0].where).toBe("#2 on the stack (spell)");
    });
});

describe("stack target lines resolve a face-down target's display name (issue #1735 review round 3)", () => {
    // `knownCardId` is a wire-projection-only field (`projectStackItem` /
    // `projectBattlefieldCard`, `convex/gameProjections.ts`) — on the fat
    // engine state `displayCardId` is a correct no-op for every card, face
    // down or not, so the only meaningful assertion is post-projection, for
    // BOTH viewers.
    it("survives projectPublicState for BOTH viewers — controller keeps the real name, opponent sees the sentinel", () => {
        const state = stateWithBoltOnFaceDownDjinn();
        expect(linesFor(state, "p1", 0).map((l) => l.title)).toEqual([
            "Mahamoti Djinn",
        ]);
        expect(linesFor(state, "p2", 0).map((l) => l.title)).toEqual([
            "Face-down creature",
        ]);
        expect(linesFor(state, "p1", 0)[0].where).toBe("on your battlefield");
    });
});
