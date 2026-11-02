// Issue #3231 — the draw-replacement `win` outcome, FULL PATH in one test:
// GRE board → wire (`projectPublicState`) → the client ability view
// (`getStackAbilities`) → `activateAbilityOnState` (the `convex/game.ts`
// activation seam) → resolution → the draw seam's win.
//
// The single-layer suites are `convex/gre/__tests__/drawReplacement.test.ts`
// (plan/commit) and `convex/cards/sets/war/__tests__/blue.test.ts` (the card).
// What only this file can catch: the loyalty abilities reaching the button the
// player presses (gated on the projected loyalty), and the −8 resolving through
// the real activation seam into a won game.
import { describe, it, expect } from "vitest";
import { getStackAbilities } from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import { resolveTopOfStack } from "@convex/gre/state";
import { activateAbilityOnState } from "@convex/game";

/** Jace, Wielder of Mysteries — WAR 54. Registry id, not a set-module import. */
const JACE = "6adb7d73-4482-4930-8497-cffd169b57e2";
const PLUS1 = "jace-wielder-plus1";
const MINUS8 = "jace-wielder-minus8";
/** Grizzly Bears — any registered card fills a library. */
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";

/** `makeState` defaults are the CR 606.3 window: p1 active with priority,
 *  PRECOMBAT_MAIN, empty stack. */
function board(loyalty: number, librarySize: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(JACE, {
                        id: "jace",
                        controllerId: "p1",
                        counters: { loyalty },
                    }),
                ],
                library: Array.from({ length: librarySize }, (_, i) =>
                    makeInstance(BEARS, {
                        id: `lib-${i}`,
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2", {
                library: [
                    makeInstance(BEARS, { id: "opp-lib", ownerId: "p2" }),
                ],
            }),
        ],
    });
}

function projectedJace(state: GameState): CardInstance {
    return projectPublicState(state, 1, "p1")
        .players.flatMap((p) => p.battlefield)
        .find((c) => c.id === "jace") as unknown as CardInstance;
}

describe("Jace, Wielder of Mysteries — full path (issue #3231)", () => {
    it("offers only the +1 at starting loyalty, both abilities at eight", () => {
        expect(
            getStackAbilities(projectedJace(board(4, 5))).map((a) => a.id)
        ).toEqual([PLUS1]);
        expect(
            getStackAbilities(projectedJace(board(8, 5))).map((a) => a.id)
        ).toEqual([PLUS1, MINUS8]);
    });

    it("the −8 from a three-card library resolves into a won game, never a decked loss", () => {
        const state = board(8, 3);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "jace",
            abilityId: MINUS8,
        });
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });
});
