// Catalogue-wide frontend affordability sweep for CAST-TIME caster-chosen
// ADDITIONAL costs (CR 601.2b / 118.8 / 601.2h — issue #2379).
//
// Same doctrine as `activation-affordability.catalogue.test.ts`, different
// surface. That sweep guards `ActivatedAbility.cost` shapes through
// `getStackAbilities` / `buildTriggerStateView` — an ON-BOARD ability's
// affordance. It reads `ActivatedAbility.cost` and NOTHING else, so it can
// never see `CardDefinition.additionalCosts`: appending a `discard`/`oneOf`
// member to its `Shape` union would be inert. The equivalent contract for a
// cast-time additional cost lives here instead.
//
// The bug class is identical: the GRE pays the leg correctly, the mutation
// accepts it, every server-side test is green — and the client's picker never
// offers it (or offers a leg the mutation rejects) because a view reducer
// dropped a field the gate reads. `payableAdditionalCostLegsForCard`
// (src/lib/card-utils.ts) is that gate: `useHandCardCommit` opens
// `AdditionalCostPicker` for exactly the legs it returns.
//
// For EVERY catalogue card declaring `additionalCosts.oneOf` this asserts,
// THROUGH the real `projectPublicState` reducer:
//   • SURFACE — with a full hand and full life, every declared leg is offered;
//   • HIDE — with an empty hand, no `discard` leg is offered; with 1 life, no
//     `payLife` leg is offered; with an empty battlefield, no `sacrificeFilter`
//     leg is offered;
//   • NEITHER — with every satisfiable leg broken at once, no leg at all is
//     offered, which is precisely the "no creature AND empty hand ⇒
//     uncastable" acceptance case (Bone Shards) and the "empty hand AND
//     life < 3" one (Bitter Triumph).
// A new card reusing these shapes is picked up automatically — zero per-card
// authoring — and the sweep fails if it ever becomes vacuous, so deleting the
// last such card cannot hide the regression.

import { describe, it, expect } from "vitest";
import { getAllCards } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import type { AdditionalCostLeg } from "@convex/cards/types";
import { payableAdditionalCostLegsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

/** A filler hand card that satisfies an untyped "discard a card" requirement,
 *  and — on the battlefield — an untyped "sacrifice a creature" one. A
 *  `filter`ed discard leg, or a sacrifice leg filtered to anything but a plain
 *  creature, would need a matching card; the sweep reports those as a skip
 *  rather than a false green. */
const FILLER = "Grizzly Bears";

/** Whether a `sacrificeFilter` leg is satisfied by a plain vanilla creature —
 *  i.e. the filter asks for a creature and nothing more (Bone Shards). Any
 *  narrower filter is reported as an unsatisfiable shape, so a card the filler
 *  cannot pay for surfaces loudly instead of passing on a subset. */
function isPlainCreatureSacrifice(leg: AdditionalCostLeg): boolean {
    const f = leg.sacrificeFilter;
    if (!f) return false;
    const keys = Object.keys(f);
    return keys.length === 1 && keys[0] === "types" && f.types === "Creature";
}

const oneOfCards = getAllCards().filter(
    (c) => (c.additionalCosts?.oneOf?.length ?? 0) > 0
);

/** Runs the client gate through the wire projection — a hand-built view would
 *  mask a stripped field, which is the whole bug class this guards. */
function offeredLegIds(opts: {
    cardId: string;
    life: number;
    spares: number;
    /** Creatures on the caster's battlefield — the sacrifice leg's candidates. */
    creatures?: number;
}): string[] {
    const inst = makeInstance(opts.cardId, {
        id: "probe",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const spares = Array.from({ length: opts.spares }, (_, i) =>
        makeInstance(getAllCards().find((c) => c.name === FILLER)!.id, {
            id: `filler${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        })
    );
    const battlefield = Array.from({ length: opts.creatures ?? 0 }, (_, i) =>
        makeInstance(getAllCards().find((c) => c.name === FILLER)!.id, {
            id: `body${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [inst, ...spares],
                battlefield,
                life: opts.life,
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const projected = projectPublicState(state, 1, "p1") as unknown as {
        players: Player[];
    };
    const card = projected.players[0].hand.find(
        (c) => c?.id === "probe"
    ) as CardInstance;
    return payableAdditionalCostLegsForCard(card, "p1", projected.players).map(
        (l) => l.id
    );
}

describe("cast-time additional-cost legs — client picker gate (CR 601.2b)", () => {
    it("the sweep is not vacuous (at least one card declares a disjunction)", () => {
        expect(oneOfCards.length).toBeGreaterThan(0);
    });

    for (const def of oneOfCards) {
        const legs = def.additionalCosts!.oneOf!;
        const untypedDiscardLegs = legs.filter(
            (l) => l.discard !== undefined && l.discard.filter === undefined
        );
        const lifeLegs = legs.filter((l) => (l.payLife ?? 0) > 0);
        const sacrificeLegs = legs.filter(isPlainCreatureSacrifice);
        const skipped = legs.filter(
            (l) =>
                !untypedDiscardLegs.includes(l) &&
                !lifeLegs.includes(l) &&
                !sacrificeLegs.includes(l)
        );

        describe(`${def.name}`, () => {
            it("SURFACE — every leg is offered with a full hand and full life", () => {
                // Skipped shapes (a FILTERED discard, a sacrifice/exile leg)
                // cannot be generically satisfied from a filler hand; surface
                // them explicitly rather than silently passing on a subset.
                expect(
                    skipped.map((l) => l.id),
                    "unsatisfiable leg shape — extend this sweep"
                ).toEqual([]);
                expect(
                    offeredLegIds({
                        cardId: def.id,
                        life: 20,
                        spares: 3,
                        creatures: 1,
                    }).sort()
                ).toEqual(legs.map((l) => l.id).sort());
            });

            if (untypedDiscardLegs.length > 0) {
                it("HIDE — an EMPTY hand removes every discard leg (CR 601.2a: the spell can't pay for itself)", () => {
                    const offered = offeredLegIds({
                        cardId: def.id,
                        life: 20,
                        spares: 0,
                        creatures: 1,
                    });
                    for (const l of untypedDiscardLegs) {
                        expect(offered).not.toContain(l.id);
                    }
                });
            }

            if (lifeLegs.length > 0) {
                it("HIDE — 1 life removes every 'pay N life' leg (CR 119.4)", () => {
                    const offered = offeredLegIds({
                        cardId: def.id,
                        life: 1,
                        spares: 3,
                        creatures: 1,
                    });
                    for (const l of lifeLegs) {
                        expect(offered).not.toContain(l.id);
                    }
                });
            }

            if (sacrificeLegs.length > 0) {
                it("HIDE — an EMPTY battlefield removes every 'sacrifice a creature' leg (CR 701.21)", () => {
                    const offered = offeredLegIds({
                        cardId: def.id,
                        life: 20,
                        spares: 3,
                        creatures: 0,
                    });
                    for (const l of sacrificeLegs) {
                        expect(offered).not.toContain(l.id);
                    }
                });
            }

            if (
                skipped.length === 0 &&
                untypedDiscardLegs.length +
                    lifeLegs.length +
                    sacrificeLegs.length >
                    1
            ) {
                it("NEITHER — with every leg's resource gone, no leg at all is offered (the spell is uncastable, CR 601.2f)", () => {
                    expect(
                        offeredLegIds({
                            cardId: def.id,
                            life: 1,
                            spares: 0,
                            creatures: 0,
                        })
                    ).toEqual([]);
                });
            }
        });
    }
});
