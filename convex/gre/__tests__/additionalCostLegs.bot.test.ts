// Bot visibility for the CR 601.2b caster-chosen ADDITIONAL cost (issue #2379).
//
// The half of `convex/__tests__/additionalCostLegChoice.test.ts` that touches
// bot-only modules — split out because `bot-suite-boundary.test.ts` requires
// every importer of `gre/moves` / `gre/applyMove` to run in the bot suite.
//
// Two seams, both of which fail SILENTLY if missed:
//   • ENUMERATION — one `cast-spell` Move per PAYABLE leg. Without it the Bot
//     announces a cast with no `additionalCostLegId` and `announceCast` throws
//     "must choose which additional cost to pay", stalling it on a move it
//     generated itself (the bot-freeze shape, ADR 0047).
//   • CHARGE — the search sandbox actually pays the leg it announced. Bitter
//     Triumph's two legs differ ONLY in cost, so an uncharged leg makes the two
//     Moves indistinguishable and the pick pure rollout noise.

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { getPlayer, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { bitterTriumph } from "../../cards/sets/lci";
import { grizzlyBears, lightningBolt } from "../../cards/sets/lea";

const SWAMP = "6176936d-72e2-4205-8871-4c5a4f1cb2d8";

/** A board where p1 holds Bitter Triumph plus `spare` other hand cards, has
 *  `life` life and two untapped Swamps, and p2 has a Grizzly Bears to kill. */
function board(opts: { life: number; spare: number }): GameState {
    const triumph = makeInstance(bitterTriumph.id, {
        id: "bt",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const spares = Array.from({ length: opts.spare }, (_, i) =>
        makeInstance(lightningBolt.id, {
            id: `spare${i}`,
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const lands = Array.from({ length: 2 }, (_, i) =>
        makeInstance(SWAMP, {
            id: `swamp${i}`,
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const bears = makeInstance(grizzlyBears.id, {
        id: "bears",
        zone: "battlefield",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [triumph, ...spares],
                battlefield: lands,
                life: opts.life,
                manaPool: { B: 2 },
            }),
            makePlayer("p2", { battlefield: [bears] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("Bitter Triumph — Bot visibility (one Move per payable leg)", () => {
    it("enumerates a cast per payable leg, and none when no leg is payable", () => {
        const state = board({ life: 20, spare: 2 });
        const legIds = enumerateMoves(state, "p1")
            .filter((m) => m.kind === "cast-spell" && m.cardInstanceId === "bt")
            .map((m) =>
                m.kind === "cast-spell" ? m.additionalCostLegId : undefined
            );
        expect(new Set(legIds)).toEqual(new Set(["discard", "pay-3-life"]));

        const broke = board({ life: 2, spare: 0 });
        expect(
            enumerateMoves(broke, "p1").filter(
                (m) => m.kind === "cast-spell" && m.cardInstanceId === "bt"
            )
        ).toEqual([]);
    });

    it("offers ONLY the payable leg when the other is not (empty hand)", () => {
        const state = board({ life: 20, spare: 0 });
        const legIds = enumerateMoves(state, "p1")
            .filter((m) => m.kind === "cast-spell" && m.cardInstanceId === "bt")
            .map((m) =>
                m.kind === "cast-spell" ? m.additionalCostLegId : undefined
            );
        expect(new Set(legIds)).toEqual(new Set(["pay-3-life"]));
    });

    it("the search sandbox CHARGES the leg it announced (never a free cast)", () => {
        const state = board({ life: 20, spare: 2 });
        const casts = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "bt"
        );
        const lifeMove = casts.find(
            (m) =>
                m.kind === "cast-spell" &&
                m.additionalCostLegId === "pay-3-life"
        )!;
        const discardMove = casts.find(
            (m) =>
                m.kind === "cast-spell" && m.additionalCostLegId === "discard"
        )!;

        const afterLife = applyMoveForSearch(state, "p1", lifeMove);
        const lp = getPlayer(afterLife, "p1");
        expect(lp.life).toBe(17);
        expect(lp.graveyard.filter((c) => c.id.startsWith("spare"))).toEqual(
            []
        );

        const afterDiscard = applyMoveForSearch(state, "p1", discardMove);
        const dp = getPlayer(afterDiscard, "p1");
        expect(dp.life).toBe(20);
        expect(
            dp.graveyard.filter((c) => c.id.startsWith("spare"))
        ).toHaveLength(1);
    });
});
