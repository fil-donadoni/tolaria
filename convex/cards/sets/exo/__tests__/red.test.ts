// Per-card behavior tests for red cards in `convex/cards/sets/exo/red.ts`
// (Exodus, split by colour per ADR 0043). Fixtures from
// `convex/cards/__tests__/setup.ts`.
import { describe, it, expect } from "vitest";
import { priceOfProgress } from "..";
import { mountain } from "../../lea/colorless";
import { wasteland } from "../../tmp/colorless";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

// Price of Progress — "Price of Progress deals damage to each player equal to
// twice the number of nonbasic lands that player controls." (CR 120.1 damage,
// CR 122 counting, CR 205.4a supertypes.) DSL-first (ADR 0045): forEach over
// players → dealDamage($each) with amount `count(nonbasic Lands controlled by
// $each) × 2`. Exercises the `count.times` multiplier and the
// `excludeSupertype: "Basic"` filter across a mixed manabase; the nonbasic vs
// basic distinction resolves through the LIVE registry supertypes (real
// Mountain / Wasteland card ids, not synthetic instances).
describe("Price of Progress (damage per nonbasic land, issue #999)", () => {
    function land(
        def: { id: string },
        id: string,
        controller: string
    ): CardInstanceState {
        return makeInstance(def.id, {
            id,
            controllerId: controller,
            ownerId: controller,
        });
    }

    it("deals each player 2× their nonbasic-land count; basics contribute 0", () => {
        const state = makeState({
            players: [
                // p1: 2 Wasteland (nonbasic) + 1 Mountain (basic) → 2 → 4 damage.
                makePlayer("p1", {
                    life: 20,
                    battlefield: [
                        land(wasteland, "p1-w1", "p1"),
                        land(wasteland, "p1-w2", "p1"),
                        land(mountain, "p1-m1", "p1"),
                    ],
                }),
                // p2: 1 Wasteland (nonbasic) + 2 Mountain (basic) → 1 → 2 damage.
                makePlayer("p2", {
                    life: 20,
                    battlefield: [
                        land(wasteland, "p2-w1", "p2"),
                        land(mountain, "p2-m1", "p2"),
                        land(mountain, "p2-m2", "p2"),
                    ],
                }),
            ],
        });

        pushSpell(state, priceOfProgress.id, "p1");
        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").life).toBe(16); // 20 - 2*2
        expect(getPlayer(state, "p2").life).toBe(18); // 20 - 1*2

        // Wire format: the resulting life totals (the board-visible effect)
        // survive projection.
        const projected = projectPublicState(state, 0, "p1");
        expect(projected.players[0].life).toBe(16);
        expect(projected.players[1].life).toBe(18);
    });

    it("deals 0 to a player controlling only basic lands", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [
                        land(mountain, "p1-only-m1", "p1"),
                        land(mountain, "p1-only-m2", "p1"),
                    ],
                }),
                makePlayer("p2", {
                    life: 20,
                    battlefield: [land(wasteland, "p2-solo-w", "p2")],
                }),
            ],
        });

        pushSpell(state, priceOfProgress.id, "p1");
        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").life).toBe(20); // only basics → 0
        expect(getPlayer(state, "p2").life).toBe(18); // 1 nonbasic → 2
    });
});
