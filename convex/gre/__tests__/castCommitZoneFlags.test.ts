// The Cast Commit kernel's zone-dependent stack flags (issue #4445, review
// finding 1). An ANNOUNCED graveyard cast of a flashback card IS a flashback
// cast — `locateCastSource` routed it through its flashback cost — so the
// item carries Flashback's `exileOnResolve` (CR 702.34a). A cast made DURING
// RESOLUTION under the resolving effect's own permission (Malcolm, Alluring
// Scoundrel's free cast of a discarded flashback card; `castDuringResolution`
// with `source: "graveyard"`) paid no flashback cost, so CR 702.34a exiles
// nothing: the item carries only the factual `castFromGraveyard`. Before the
// kernel the resolution-time primitive stamped no zone flag at all, and the
// first cut of the kernel stamped the announcement's set on both placements.
import { describe, expect, it } from "vitest";
import { commitCast, type CastCommitPlan } from "../castCommit";
import { getCardByName, getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const FLASHBACK_CARD = "Flash of Insight";

function graveyardPosition(): GameState {
    const def = getCardByName(FLASHBACK_CARD);
    return makeState({
        players: [
            makePlayer("p1", {
                graveyard: [
                    makeInstance(def.id, {
                        id: "spell",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

/** A free graveyard cast — the mana leg waived, no other leg — differing only
 *  in its placement. */
function freeGraveyardPlan(
    placement: CastCommitPlan["placement"]
): CastCommitPlan {
    return {
        casterId: "p1",
        cardInstanceId: "spell",
        cardDef: getDefinition(getCardByName(FLASHBACK_CARD).id),
        manaCost: {},
        source: { zone: "graveyard" },
        legs: {},
        record: {},
        mode: {},
        placement,
    };
}

describe("Cast Commit — zone flags follow the placement (CR 702.34a, issue #4445)", () => {
    it("an announced graveyard cast of a flashback card is exiled as it resolves", () => {
        const state = graveyardPosition();
        const item = commitCast(state, freeGraveyardPlan({ kind: "announce" }));
        expect(item).not.toBeNull();
        expect(item!.castFromGraveyard).toBe(true);
        expect(item!.exileOnResolve).toBe(true);
    });

    it("a cast made during resolution under another permission paid no flashback cost and is NOT exiled", () => {
        const state = graveyardPosition();
        const item = commitCast(
            state,
            freeGraveyardPlan({
                kind: "during-resolution",
                resolvingItemId: "resolver",
            })
        );
        expect(item).not.toBeNull();
        expect(item!.castFromGraveyard).toBe(true);
        expect(item!.exileOnResolve).toBeUndefined();
        expect(item!.escaped).toBeUndefined();
        expect(state.stack.map((s) => s.id)).toEqual(["spell"]);
    });
});
