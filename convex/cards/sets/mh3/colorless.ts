// MH3 — colorless cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Lands and colorless artifacts (no coloured cost) live here. Cards with a
// coloured colour identity go to their matching colour file.
//
// Reference: set code mh3, Modern Horizons 3.

import type { CardDefinition, LandEntryStateView } from "../../types";

// Shifting Woodland — Land.
// "This land enters tapped unless you control a Forest.
//  {T}: Add {G}.
//  Delirium — {2}{G}{G}: This land becomes a copy of target permanent card in
//  your graveyard until end of turn. Activate only if there are four or more
//  card types among cards in your graveyard."
//
// TODO (tracked-by: #2766): Delirium copy ability — {2}{G}{G}: This land
// becomes a copy of target permanent card in your graveyard until end of
// turn. Activate only if delirium.
//
// NARROWED 2026-08-25 (#1841 audit): the old wording ("blocked on
// copy-from-graveyard infrastructure and the 'becomes a copy' semantics for
// non-creature permanents") overstated it. The copy engine ships —
// `convex/gre/copy.ts` implements CR 707 copiable values with `applyCopy` /
// `revertCopy` / `presentedDefId`, and it is card-type agnostic (it swaps
// `card.id` and overwrites types/subtypes/P-T/staticAbilities). Four narrower
// things are missing: a copiable-values path whose SOURCE is a graveyard card
// rather than a battlefield instance; an Op wrapping `applyCopy` at all (the
// copy family is `resolve()`-only today, and this is an ACTIVATED ability); a
// duration-scoped revert; and the delirium activation gate.
export const shiftingWoodland: CardDefinition = {
    id: "059164e1-894d-4586-9800-e60d6fbd6eb6",
    rarity: "rare",
    name: "Shifting Woodland",
    oracleText:
        "This land enters tapped unless you control a Forest.\n{T}: Add {G}.\nDelirium — {2}{G}{G}: This land becomes a copy of target permanent card in your graveyard until end of turn. Activate only if there are four or more card types among cards in your graveyard.",
    types: ["Land"],
    subtypes: ["Forest"],
    entersTappedUnless(
        view: LandEntryStateView,
        controllerId: string
    ): boolean {
        for (const player of view.players) {
            if (player.id !== controllerId) continue;
            return player.battlefield.some((p) =>
                p.subtypes.includes("Forest")
            );
        }
        return false;
    },
};

// Arena of Glory — Land.
// "This land enters tapped unless you control a Mountain.
//  {T}: Add {R}.
//  {R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature
//  spell, it gains haste until end of turn."
//
// CR 701.43a/c — "Exert this land" is an activation COST leg (`cost.exertThis`,
// CR 602.1a): paying it chooses to have the land not untap during its
// controller's next untap step. Exert is a PERMANENT keyword action, not a
// creature one — CR 701.43a says "a permanent" — which is why the leg is not
// creature-gated and why this land is its first shipped carrier. CR 701.43b
// makes the leg always payable: an untapped permanent can be exerted, and so
// can one already exerted this turn.
//
// TODO (tracked-by: #3354): the mana-provenance rider — "If that mana is spent
// on a creature spell, it gains haste until end of turn" — is not implemented.
// The {R}{R} is added as ordinary pool mana, so a creature spell paid with it
// does not gain haste. CR 106.6 rider machinery exists for exactly one property
// (`RestrictedMana.cantBeCounteredRider`, Delighted Halfling) and issue #3354
// names the five sites a second one needs, including the one with no precedent:
// carrying the property from the stack item onto the permanent the spell
// becomes.
//
// compiler-gap: "This land enters tapped unless you control a Mountain." (#3214)
// compiler-gap: "{R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn." (#3214)
export const arenaOfGlory: CardDefinition = {
    id: "dd148edc-9e43-41aa-bb50-f912115d3e72",
    rarity: "rare",
    name: "Arena of Glory",
    oracleText:
        "This land enters tapped unless you control a Mountain.\n{T}: Add {R}.\n{R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn. (An exerted permanent won't untap during your next untap step.)",
    types: ["Land"],
    entersTappedUnless(
        view: LandEntryStateView,
        controllerId: string
    ): boolean {
        for (const player of view.players) {
            if (player.id !== controllerId) continue;
            return player.battlefield.some((p) =>
                p.subtypes.includes("Mountain")
            );
        }
        return false;
    },
    activatedAbilities: [
        {
            id: "arena-of-glory-mana",
            oracleText: "{T}: Add {R}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 1 }),
            manaProduced: { R: 1 },
        },
        {
            id: "arena-of-glory-exert-mana",
            oracleText:
                "{R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn.",
            // CR 605.1a — still a mana ability: it adds mana, does not target,
            // and is not a loyalty ability, so it never uses the stack even
            // with a mana leg and an exert leg in its cost (CR 602.1a — the
            // whole activation cost is everything before the colon).
            cost: { mana: { R: 1 }, tap: true, exertThis: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 2 }),
            manaProduced: { R: 2 },
        },
    ],
};
