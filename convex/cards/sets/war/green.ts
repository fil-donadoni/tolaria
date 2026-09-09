// war — green cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { NISSA_WHO_SHAKES_THE_WORLD_EMBLEM_ID } from "../../emblems";

// Nissa, Who Shakes the World — {3}{G}{G} Legendary Planeswalker — Nissa,
// loyalty 5 (WAR, issue #3229).
// "Whenever you tap a Forest for mana, add an additional {G}.
//  +1: Put three +1/+1 counters on up to one target noncreature land you
//     control. Untap it. It becomes a 0/0 Elemental creature with vigilance and
//     haste that's still a land.
//  −8: You get an emblem with 'Lands you control have indestructible.' Search
//     your library for any number of Forest cards, put them onto the
//     battlefield tapped, then shuffle."
//
// MANA CLAUSE — the Wild-Growth-style triggered MANA ability (CR 605.1b /
// 605.4): `tappedTrigger` with `forMana: true`, `manaAbility: true` (it resolves
// off-stack, in the same cost payment that tapped the Forest, so the extra {G}
// is spendable on the spell being paid for) and `manaBonusForPotential` so the
// PREDICTIVE models — the castability gate and the auto-tap solver — know the
// bonus exists before it is produced.
//
// Shipped as an Effect Script, NOT `resolve()`. Every prior card of this shape
// (Mana Flare, Fertile Ground, Wild Growth, Badgermole Cub) carries a
// "`tappedTrigger` has no `effects[]` site" note that is now stale — it has one —
// and the reason those cards still need the callback does not apply here: they
// must read the TAPPED permanent's controller or its `manaProduced` payload,
// neither of which the script can reach (tracked-by: #2153). Nissa's recipient
// is "you", the source's own controller, and the amount is a fixed {G}, so
// `addMana { player: "controller" }` says exactly what the Oracle text says.
// `scope: "yours"` is CR 109.2's "YOU tap"; `filter: { subtypes: "Forest" }`
// reads the LIVE subtype, so a Forest made by Prismatic Omen counts.
//
// +1 — "up to one target noncreature land you control", then three +1/+1
// counters, an untap, and an indefinite animation. THE ORDER IS LOAD-BEARING:
// the counters go on BEFORE the animation, so the land is never a 0/0 that the
// state-based actions could bury — and CR 704.3 does not check SBAs mid-
// resolution anyway, so a 0/0 with three +1/+1 counters is simply a 3/3
// (CR 613.4 — counters apply on top of the layer-7a base P/T).
// `animate` with NO `duration` is the CR 611.2c indefinite change; it ADDS the
// Creature card type to the printed Land rather than replacing it, which is
// CR 205.1b's "that's still a land" — the land keeps its Forest subtype and
// keeps tapping for mana, and the two granted keywords share the animation's
// (absent) duration per CR 611.2a.
//
// −8 — the `emblem` Op (the static grant and its art live in `cards/emblems.ts`)
// followed by the shipped "any number" fetch shape: `choice(search-library)`
// clamped by availability, `moveZone(library → battlefield, tapped)`, then
// `libraryLook(shuffle)` (CR 701.23 / 701.24).
// compiler-gap: "Whenever you tap a Forest for mana, add an additional {G}." (#2693)
// compiler-gap: "+1: Put three +1/+1 counters on up to one target noncreature land you control. Untap it. It becomes a 0/0 Elemental creature with vigilance and haste that's still a land." (#2693)
// compiler-gap: "-8: You get an emblem with "Lands you control have indestructible." Search your library for any number of Forest cards, put them onto the battlefield tapped, then shuffle." (#2693)
export const nissaWhoShakesTheWorld: CardDefinition = {
    id: "f857bbe4-5619-4733-a0c7-69700f2ef4f3",
    name: "Nissa, Who Shakes the World",
    rarity: "rare",
    oracleText:
        'Whenever you tap a Forest for mana, add an additional {G}.\n+1: Put three +1/+1 counters on up to one target noncreature land you control. Untap it. It becomes a 0/0 Elemental creature with vigilance and haste that\'s still a land.\n−8: You get an emblem with "Lands you control have indestructible." Search your library for any number of Forest cards, put them onto the battlefield tapped, then shuffle.',
    manaCost: { X: 3, G: 2 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Nissa"],
    loyalty: 5,
    triggeredAbilities: [
        tappedTrigger({
            id: "nissa-who-shakes-the-world-forest-mana",
            oracleText:
                "Whenever you tap a Forest for mana, add an additional {G}.",
            scope: "yours",
            filter: { subtypes: "Forest" },
            forMana: true,
            manaAbility: true, // CR 605.1b / 605.4 — resolves without the stack
            // CR 605.4 — teach the predictive potential-mana models that any
            // Forest the controller taps for mana yields an extra {G}.
            manaBonusForPotential: {
                appliesTo: { filter: { subtypes: "Forest" } },
                amount: { kind: "fixed", mana: { G: 1 } },
            },
            effects: [{ op: "addMana", mana: { G: 1 }, player: "controller" }],
        }),
    ],
    activatedAbilities: [
        {
            id: "nissa-who-shakes-the-world-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Put three +1/+1 counters on up to one target noncreature land you control. Untap it. It becomes a 0/0 Elemental creature with vigilance and haste that's still a land.",
            targetRequirement: {
                type: "Land",
                count: { min: 0, max: 1 },
                controller: "you",
                // CR 205 — "noncreature land": a land that is already a creature
                // (Dryad Arbor, a land Nissa animated on an earlier turn) is not
                // a legal target.
                excludeTypes: "Creature",
            },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 3,
                },
                // CR 701.26b — untap.
                { op: "tapUntap", action: "untap", target: { target: 0 } },
                // CR 205.1b / 611.2c — adds Creature to the printed Land
                // indefinitely; it is STILL a land.
                {
                    op: "animate",
                    target: { target: 0 },
                    power: 0,
                    toughness: 0,
                    subtype: "Elemental",
                    grantedAbilities: ["vigilance", "haste"],
                },
            ],
        },
        {
            id: "nissa-who-shakes-the-world-minus8",
            cost: { loyalty: -8 },
            useStack: true,
            oracleText:
                '−8: You get an emblem with "Lands you control have indestructible." Search your library for any number of Forest cards, put them onto the battlefield tapped, then shuffle.',
            effects: [
                { op: "emblem", emblem: NISSA_WHO_SHAKES_THE_WORLD_EMBLEM_ID },
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    // CR 205.3 — "Forest cards": the land SUBTYPE, basic or not.
                    filter: { subtype: "Forest" },
                    count: { min: 0, max: Number.MAX_SAFE_INTEGER },
                    prompt: "Search your library for any number of Forest cards to put onto the battlefield tapped.",
                    bind: "$forests",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$forests" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                    tapped: true,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};
