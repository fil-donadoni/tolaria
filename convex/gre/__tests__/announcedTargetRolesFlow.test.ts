// Full path for issue #4193 — announcement → prompt payload → the two picks →
// resolution, on the one catalogue card whose kicked announcement is
// ASYMMETRIC (CR 702.33g + CR 601.2c): Jilt returns announced slot 0 to its
// owner's hand and deals 2 damage to announced slot 1.
//
// The point of this file is the JOIN, which no unit test covers: that the
// halves the prompt states per announced target are the halves resolution
// applies, in the order the caster clicked. The roles are NOT hand-written
// here — they come from `announcedTargetRoleFields`, the very helper
// `announceCast` spreads onto the `PendingTarget` — so a fixture that
// re-stated them would pass with the derivation broken.
//
// What this does NOT cover, said plainly: `announceCast`'s one-line SPREAD of
// that helper. There is no convex-test harness for a `game.ts` mutation (ADR
// 0001) and this file calls the helper itself, so deleting the spread leaves
// every test here green — the same coverage level every other announcement
// field on `PendingTarget` has (`kickerPayments`, `buybackPaid`,
// `chosenModeIds`). Everything below the announcement is the real exported
// path: `applyOneTargetSelection` → `advanceTargetGroupOrFinalize` →
// `finalizeTargetSelection` → `resolveTopOfStack`.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { announcedTargetRoleFields, applyOneTargetSelection } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { getPlayer, resolveTopOfStack, type GameState } from "../state";
import { pendingTargetFiltersFromRequirement } from "../rules";

const JILT = getCardByName("Jilt");

/** The two creatures the caster must tell apart. Grizzly Bears (2/2) dies to
 *  the 2 damage; Serra Angel (4/4) does not, so bouncing the WRONG one is a
 *  different, and worse, spell. */
const BEARS = getCardByName("Grizzly Bears");
const ANGEL = getCardByName("Serra Angel");

/** A board with Jilt in p1's hand, kicked, and p2's two creatures out —
 *  paused exactly where `announceCast` leaves it: a live `pendingTarget` for
 *  the widened kicked group, with no pick made yet. */
function announcedKickedJilt(): GameState {
    const jilt = makeInstance(JILT.id, {
        id: "jilt",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const angel = makeInstance(ANGEL.id, {
        id: "angel",
        controllerId: "p2",
        ownerId: "p2",
    });
    const bears = makeInstance(BEARS.id, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [jilt],
                manaPool: { W: 0, U: 4, B: 0, R: 4, G: 0, C: 4 },
            }),
            makePlayer("p2", { battlefield: [angel, bears] }),
        ],
    });
    const requirement = JILT.kickedTargetRequirement!;
    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: "jilt",
        targetType: requirement.type,
        count: 2,
        selected: [],
        kickerPayments: { kicker: 1 },
        ...pendingTargetFiltersFromRequirement(requirement, undefined),
        // The announcement's own derivation — see the file header.
        ...announcedTargetRoleFields(JILT, undefined, 2),
    };
    return state;
}

/** Click a permanent, the way `selectTarget` does. */
function pick(state: GameState, id: string): void {
    applyOneTargetSelection(state, "p1", {
        targetType: "permanent",
        targetId: id,
    });
}

describe("Jilt — the announced targets are told apart, and resolution obeys it (issue #4193)", () => {
    it("states each announced target's half before either pick is made", () => {
        const state = announcedKickedJilt();
        expect(state.pendingTarget?.announcedTargetRoles).toEqual([
            "returned to its owner's hand",
            "dealt 2 damage",
        ]);
    });

    it("carries the roles across the wire (projectPublicState, ADR 0074)", () => {
        // The prompt is a view of the engine's answer; a projection that
        // stripped this would leave the board rendering the pre-fix prompt
        // while every server test passed — the recurring drop-a-field class.
        const state = announcedKickedJilt();
        const view = projectPublicState(state, 1, "p1");
        expect(view.pendingTarget?.announcedTargetRoles).toEqual([
            "returned to its owner's hand",
            "dealt 2 damage",
        ]);
    });

    it("applies the halves to the targets in the order the prompt numbered them", () => {
        const state = announcedKickedJilt();
        // Row 1 said "returned to its owner's hand" — the first click.
        pick(state, "angel");
        // Row 2 said "dealt 2 damage" — the second.
        pick(state, "bears");
        resolveTopOfStack(state);

        const p2 = getPlayer(state, "p2");
        expect(p2.hand.map((c) => c.id)).toEqual(["angel"]);
        expect(p2.battlefield.map((c) => c.id)).toEqual([]);
        // Grizzly Bears is a 2/2 — 2 damage is lethal, so SBAs put it in the
        // graveyard rather than leaving it marked (CR 704.5g).
        expect(p2.graveyard.map((c) => c.id)).toEqual(["bears"]);
    });

    it("assigns the OTHER way round when the caster clicks the other way round", () => {
        // The same two objects, the opposite clicks: a different spell, which
        // is exactly why the prompt has to say which is which.
        const state = announcedKickedJilt();
        pick(state, "bears");
        pick(state, "angel");
        resolveTopOfStack(state);

        const p2 = getPlayer(state, "p2");
        expect(p2.hand.map((c) => c.id)).toEqual(["bears"]);
        // Serra Angel is a 4/4 — it survives the 2 damage, marked.
        const angel = p2.battlefield.find((c) => c.id === "angel");
        expect(angel?.damageMarked ?? 0).toBe(2);
    });

    it("an UNKICKED Jilt announces one target and carries no per-Target text", () => {
        // CR 702.33g — the base requirement, `count: 1`. Nothing to tell
        // apart, so the prompt is unchanged.
        expect(JILT.targetRequirement?.count).toBe(1);
        expect(announcedTargetRoleFields(JILT, undefined, 1)).toEqual({});
    });
});
