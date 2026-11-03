// Mounts and the Saddle keyword ability (CR 702.171).
//
// CR 702.171a — "Saddle is an activated ability. 'Saddle N' means 'Tap any
//              number of other untapped creatures you control with total
//              power N or greater: This permanent becomes saddled until end
//              of turn. Activate only as a sorcery.'"
// CR 702.171b — "Saddled is a designation that has no rules meaning other
//              than to act as a marker that spells and abilities can
//              identify."
//
// Modelling — Crew's rails (`./vehicle.ts`), with a different effect half:
//
//  - the COST is `cost.tapOtherFilter` with the `totalPower` shape
//    (`gre/tapOtherCost.ts`): the same picker, mutation, commit gate and
//    affordability predicate Crew uses. `tapOtherCandidates` already excludes
//    the source and every tapped permanent ("other untapped creatures you
//    control"); summoning sickness is not a gate (CR 302.6 governs a
//    creature's own {T} symbol, not being tapped for another's cost).
//  - the TIMING is `sorcerySpeedOnly` ("Activate only as a sorcery").
//  - the EFFECT is the `becomeSaddled` Op on `$source`: the CR 702.171b
//    designation `CardInstanceState.saddled`, cleared at cleanup (CR 514.2)
//    and on any zone change (CR 400.7). A Mount is already a creature, so
//    nothing about its characteristics changes.

import type { ActivatedAbility, CardDefinition } from "../types";
import { slugify } from "./vehicle";

/** The board-visible keyword string a Mount carries in `staticAbilities[]`
 *  (CR 702.171). Parametrized, matched by the Mechanics Registry's
 *  `bindingPattern` (`/^saddle \d+$/`) exactly like "crew N". */
export function saddleKeyword(n: number): string {
    return `saddle ${n}`;
}

/** Oracle reminder text for Saddle N, verbatim from the printed cards. */
export function saddleReminderText(n: number): string {
    return `Saddle ${n} (Tap any number of other creatures you control with total power ${n} or more: This Mount becomes saddled until end of turn. Saddle only as a sorcery.)`;
}

/** The enforcing CR 702.171a activated ability. */
export function saddleAbility(args: {
    /** Mount card name — namespaces the generated ability id. */
    name: string;
    n: number;
}): ActivatedAbility {
    return {
        id: `${slugify(args.name)}-saddle`,
        oracleText: saddleReminderText(args.n),
        // CR 702.171a — "Tap any number of other untapped creatures you
        // control with total power N or greater". No mana leg, no {T} on the
        // Mount itself.
        cost: {
            tapOtherFilter: {
                filter: { types: "Creature", controllerRelation: "you" },
                totalPower: args.n,
            },
        },
        useStack: true,
        // CR 702.171a — "Activate only as a sorcery."
        sorcerySpeedOnly: true,
        effects: [{ op: "becomeSaddled", target: { ref: "$source" } }],
    };
}

/** A Mount's definition with Saddle N (CR 702.171a): appends BOTH halves —
 *  the `saddle N` keyword string and its enforcing activated ability — from
 *  ONE call, so a Mount can never print the keyword and enforce nothing. The
 *  ability id is namespaced by the card's own name. */
export function withSaddle<T extends CardDefinition>(def: T, n: number): T {
    return {
        ...def,
        staticAbilities: [...(def.staticAbilities ?? []), saddleKeyword(n)],
        activatedAbilities: [
            ...(def.activatedAbilities ?? []),
            saddleAbility({ name: def.name, n }),
        ],
    };
}
