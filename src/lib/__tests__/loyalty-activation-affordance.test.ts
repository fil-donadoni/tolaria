// Frontend wiring for the three planeswalkers issue #3229 ships — the half of
// its acceptance criterion `projectPublicState` alone cannot pay: "loyalty
// abilities appear and are ACTIVATABLE client-side, verified through
// `projectPublicState` / `getStackAbilities`".
//
// The per-card tests already assert the wire projection carries the `loyalty`
// counters. What they cannot see is the CLIENT GATE: `getStackAbilities` reads
// the shared CR 606 authority (`@convex/gre/loyalty`, issue #2491) off the
// entries `buildTriggerStateView` produces, and the catalogue-wide affordability
// sweep (`activation-affordability.catalogue.test.ts`) covers only the
// `exileFromGraveyard` / `life` / `removeCounter` cost shapes — NOT `loyalty`.
// So nothing auto-covers a walker whose abilities are silently never offered.
//
// Every assertion drives the SURFACE through the REAL reducer; a hand-built view
// would mask a dropped field, which is the exact bug class the frontend-wiring
// regime exists to catch.

import { describe, it, expect } from "vitest";
import type { CardDefinition } from "@convex/cards/types";
import { tezzeretCruelCaptain } from "@convex/cards/sets/eoe";
import { uginEyeOfTheStorms } from "@convex/cards/sets/tdm";
import { nissaWhoShakesTheWorld } from "@convex/cards/sets/war";
import { forest, grizzlyBears } from "@convex/cards/sets/lea";
import { ornithopter } from "@convex/cards/sets/atq";
import type { CardInstance } from "../../types/game";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";

const VIEWER = "p1";

function perm(
    id: string,
    def: CardDefinition,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: def.id },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: def.types,
        subtypes: def.subtypes ?? [],
        staticAbilities: def.staticAbilities ?? [],
        power: def.power,
        toughness: def.toughness,
        ...overrides,
    };
}

function walker(
    id: string,
    def: CardDefinition,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: def.id },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: def.types,
        subtypes: def.subtypes ?? [],
        staticAbilities: def.staticAbilities ?? [],
        counters: { loyalty: def.loyalty! },
        ...overrides,
    };
}

/** Board fodder so a TARGETED loyalty ability is not hidden for want of a legal
 *  target rather than for want of loyalty — Tezzeret's `0` takes a mandatory
 *  "target artifact or creature", so a board holding only the walker hides it
 *  correctly and would make the affordability assertions read the wrong reason. */
function fodder(): CardInstance[] {
    return [
        perm("thopter", ornithopter),
        perm("bear", grizzlyBears),
        perm("forest", forest),
    ];
}

/** Builds the view through the REAL reducer (never a hand-rolled object). */
function viewOf(battlefield: CardInstance[]) {
    return buildTriggerStateView(
        [
            { id: VIEWER, life: 20, hand: [], battlefield, graveyard: [] },
            { id: "p2", life: 20, hand: [], battlefield: [], graveyard: [] },
        ],
        VIEWER
    );
}

function offeredAbilityIds(source: CardInstance, phase = "PRECOMBAT_MAIN") {
    const battlefield = [source, ...fodder()];
    return getStackAbilities(
        source,
        phase as Parameters<typeof getStackAbilities>[1],
        true,
        viewOf(battlefield),
        20
    ).map((a) => a.id);
}

const WALKERS: Array<[string, CardDefinition]> = [
    ["Tezzeret, Cruel Captain", tezzeretCruelCaptain],
    ["Ugin, Eye of the Storms", uginEyeOfTheStorms],
    ["Nissa, Who Shakes the World", nissaWhoShakesTheWorld],
];

describe("loyalty abilities reach the client menu (CR 606, issue #3229)", () => {
    it.each(WALKERS)(
        "%s offers every loyalty ability its printed loyalty can pay for",
        (_name, def) => {
            const source = walker("pw", def);
            const offered = offeredAbilityIds(source);
            const affordable = def.activatedAbilities!.filter(
                (a) =>
                    a.cost.loyalty !== undefined &&
                    // CR 606.6 — a `-N` may not take loyalty below 0.
                    def.loyalty! + a.cost.loyalty >= 0
            );
            // Guard the guard: a walker with nothing affordable would make the
            // assertion below vacuously true.
            expect(affordable.length).toBeGreaterThan(0);
            for (const ability of affordable) {
                expect(offered).toContain(ability.id);
            }
        }
    );

    it.each(WALKERS)(
        "%s hides a `-N` its current loyalty cannot pay (CR 606.6)",
        (_name, def) => {
            const unaffordable = def.activatedAbilities!.filter(
                (a) => (a.cost.loyalty ?? 0) < 0
            );
            expect(unaffordable.length).toBeGreaterThan(0);
            // One loyalty counter pays for no `-N` in this trio (the cheapest is
            // Nissa's `-8`).
            const source = walker("pw", def, { counters: { loyalty: 1 } });
            const offered = offeredAbilityIds(source);
            for (const ability of unaffordable) {
                expect(offered).not.toContain(ability.id);
            }
        }
    );

    it.each(WALKERS)(
        "%s offers NOTHING once one of its loyalty abilities has been activated this turn (CR 606.3)",
        (_name, def) => {
            const source = walker("pw", def, {
                loyaltyActivatedThisTurn: true,
            });
            const loyaltyIds = def
                .activatedAbilities!.filter((a) => a.cost.loyalty !== undefined)
                .map((a) => a.id);
            const offered = offeredAbilityIds(source);
            for (const id of loyaltyIds) {
                expect(offered).not.toContain(id);
            }
        }
    );

    it.each(WALKERS)(
        "%s offers nothing at instant speed — a loyalty ability is sorcery-timed (CR 606.3)",
        (_name, def) => {
            const source = walker("pw", def);
            const loyaltyIds = def
                .activatedAbilities!.filter((a) => a.cost.loyalty !== undefined)
                .map((a) => a.id);
            const offered = offeredAbilityIds(source, "DECLARE_ATTACKERS");
            for (const id of loyaltyIds) {
                expect(offered).not.toContain(id);
            }
        }
    );

    it("Ugin's three abilities are offered in printed order (+2, 0, -11)", () => {
        const source = walker("ugin", uginEyeOfTheStorms, {
            counters: { loyalty: 11 },
        });
        expect(offeredAbilityIds(source)).toEqual([
            "ugin-eye-of-the-storms-plus2",
            "ugin-eye-of-the-storms-zero",
            "ugin-eye-of-the-storms-minus11",
        ]);
    });
});
