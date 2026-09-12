// The client's tap affordance for a depletion land — CR 605.1a / 118.3,
// issue #2712.
//
// A depletion land's mana is gated behind a FIXED `cost.removeCounter` leg, and
// the client decides tappability from its OWN mirror of the engine's mana-
// ability resolution (`clientManaAbilities`, `src/lib/card-utils.ts`). Three
// consumers read that mirror — the tap affordance, the ability-menu entry and
// the cost affordance — and only ONE of them threads a board through to the
// shared `getManaTapOptions` authority. So a mirror with no counter gate is the
// "clickable but rejected" shape the codebase keeps warning about: the land
// reads as tappable, the click dispatches, and the server refuses.
//
// SURFACE test — every assertion runs on the card as it arrives through
// `projectPublicState`, not on a hand-built view (`convex/CLAUDE.md`
// § Proof-of-failure shape 3): the projection strips `card.card` to `{ id }`,
// and the counters this whole gate reads live on the instance, so a projection
// that dropped them would pass a GRE-only test and break the board.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup";
import { projectPublicState } from "../../../convex/gameProjections";
import { hickoryWoodlot } from "../../../convex/cards/sets/mmq/colorless";
import {
    getActivatedManaMenuEntry,
    hasManaAbility,
    canAffordManaAbilityCost,
} from "../card-utils";
import type { CardInstance } from "../../types/game";
import type { ManaPool } from "../../types/game";

const EMPTY_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

/** Hickory Woodlot on p1's battlefield with `counters` depletion counters,
 *  observed through the wire exactly as the board component sees it. */
function projectedWoodlot(counters: number): {
    card: CardInstance;
    players: { id: string; battlefield: CardInstance[] }[];
} {
    const land = makeInstance(hickoryWoodlot.id, {
        id: "woodlot",
        controllerId: "p1",
        ownerId: "p1",
        ...(counters > 0 ? { counters: { depletion: counters } } : {}),
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [land] }), makePlayer("p2")],
    });
    const projected = projectPublicState(state, 1, "p1");
    const slim = projected.players[0]!.battlefield.find(
        (c) => c.id === "woodlot"
    )! as unknown as CardInstance;
    return {
        card: slim,
        players: projected.players.map((p) => ({
            id: p.id,
            battlefield: p.battlefield as unknown as CardInstance[],
        })),
    };
}

describe("depletion land client affordance (CR 605.1a / 118.3, issue #2712)", () => {
    it("is tappable, menu-offered and affordable while a counter remains", () => {
        const { card, players } = projectedWoodlot(1);

        // The projection must carry the counters at all — everything below
        // reads them.
        expect(card.counters?.depletion).toBe(1);
        expect(hasManaAbility(card, undefined, players)).toBe(true);
        expect(getActivatedManaMenuEntry(card)?.id).toBe(
            "hickory-woodlot-mana"
        );
        // Empty pool: the land's own cost has no mana leg, so "can I afford
        // it" must not turn on a floating pool.
        expect(canAffordManaAbilityCost(card, EMPTY_POOL)).toBe(true);
    });

    it("is NOT tappable and offers no menu entry with its counters gone", () => {
        const { card, players } = projectedWoodlot(0);

        expect(card.counters?.depletion).toBeUndefined();
        // Without the gate the land reads as a live mana source on every one of
        // these surfaces and the server rejects the click.
        expect(hasManaAbility(card, undefined, players)).toBe(false);
        expect(hasManaAbility(card)).toBe(false);
        expect(getActivatedManaMenuEntry(card)).toBeNull();
    });
});
