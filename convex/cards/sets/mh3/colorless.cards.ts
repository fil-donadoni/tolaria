// MH3 — colorless cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3/index.cards"` re-exports this module.
// Lands and colorless artifacts (no coloured cost) live here. Cards with a
// coloured colour identity go to their matching colour file.
//
// Reference: set code mh3, Modern Horizons 3.

import {
    defineCard,
    DELIRIUM_CARD_TYPES,
    PERMANENT_TYPES,
    type LandEntryStateView,
    type TargetRequirement,
} from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// Shifting Woodland — Land.
// "This land enters tapped unless you control a Forest.
//  {T}: Add {G}.
//  Delirium — {2}{G}{G}: This land becomes a copy of target permanent card in
//  your graveyard until end of turn. Activate only if there are four or more
//  card types among cards in your graveyard."
//
// CR 110.4a — "permanent card" is `PERMANENT_TYPES`. CR 707.2 — the `becomeCopy`
// Op reads the announced graveyard card's printed values; CR 611.2a / 514.2 —
// "until end of turn" is its timed form. CR 207.2c — Delirium is an ability
// word: the rules weight is the printed restriction, carried as data.
// hand-tail: This land enters tapped unless you control a Forest. (#8505)
export const shiftingWoodland = defineCard(() => ({
    id: "059164e1-894d-4586-9800-e60d6fbd6eb6",
    rarity: "rare",
    name: "Shifting Woodland",
    oracleText:
        "This land enters tapped unless you control a Forest.\n{T}: Add {G}.\nDelirium — {2}{G}{G}: This land becomes a copy of target permanent card in your graveyard until end of turn. Activate only if there are four or more card types among cards in your graveyard.",
    types: ["Land"],
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
    activatedAbilities: [
        {
            id: "shifting-woodland-mana",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            effects: [{ op: "addMana", mana: { G: 1 } }],
            manaProduced: { G: 1 },
        },
        {
            id: "shifting-woodland-delirium-copy",
            oracleText:
                "Delirium — {2}{G}{G}: This land becomes a copy of target permanent card in your graveyard until end of turn. Activate only if there are four or more card types among cards in your graveyard.",
            cost: { mana: { X: 2, G: 2 } },
            useStack: true,
            activationCondition: {
                left: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        countTypes: true,
                    },
                },
                op: "ge",
                right: DELIRIUM_CARD_TYPES,
            },
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [
                {
                    op: "becomeCopy",
                    target: { ref: "$source" },
                    source: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
}));

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
// CR 106.6 (issue #3354) — the mana-provenance rider is `manaHasteRider`, the
// second CR 106.6 rider after Delighted Halfling's
// `RestrictedMana.cantBeCounteredRider` and the first that rides an
// UNRESTRICTED unit: this mana may pay for anything, so the {R}{R} floats in
// the parallel `restrictedMana` pool tagged but ungated (the fungible
// `manaPool` is a bare per-colour count with nowhere to record a tag).
// `payManaCostForSpell` settles the oracle's own "spent on a CREATURE spell"
// condition at payment and stamps `StackItem.dynamicHasteFromMana`;
// `finalizeSpellResolution` hands it off to the permanent the spell becomes as
// an until-end-of-turn layer-6 haste grant (CR 611.2c) — the piece with no
// precedent, since `dynamicCantBeCountered` dies with its stack item.
//
// hand-tail: "This land enters tapped unless you control a Mountain." (#4195)
// hand-tail: "{R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn." (#4195)
export const arenaOfGlory = defineCard(() => ({
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
            // CR 106.6 — "If that mana is spent on a creature spell, it gains
            // haste until end of turn." Declarative, exactly like Delighted
            // Halfling's `manaCantBeCounteredRider`; no `resolve()` involved.
            manaHasteRider: true,
            effect: (ctx) => ctx.addMana({ R: 2 }),
            manaProduced: { R: 2 },
        },
    ],
}));

// Devourer of Destiny — {5}{C}{C} Creature — Eldrazi 6/6.
// "You may reveal this card from your opening hand. If you do, at the
//  beginning of your first upkeep, look at the top four cards of your library.
//  You may put one of those cards back on top of your library. Exile the rest.
//  When you cast this spell, exile target permanent that's one or more colors."
//
// CR 103.6b — the reveal is `openingHandAction: "reveal"`, taken in the
// pre-game window `gre/mulligan.ts` opens; what it sets up is the delayed
// trigger of CR 603.7 declared by `openingHandReveal`, at the beginning of the
// revealing player's first upkeep. The dig is the shipped `lookDistribute`: look
// at four, keep up to one on top of the library (`keepTo: "library-top"`,
// `optional`), exile the rest. CR 113.6k — the cast trigger functions
// from the stack (`scope: "self"`), as Ugin's does; "one or more colors" is
// `colorFilterAny` over the five colours (CR 105.2), and the slot is mandatory
// (`count` 1), unlike Ugin's "up to one".
const DEVOURER_COLORED_PERMANENT: TargetRequirement = {
    type: [...PERMANENT_TYPES],
    count: 1,
    colorFilterAny: ["W", "U", "B", "R", "G"],
};

// hand-tail: When you cast this spell, exile target permanent that's one or more colors. (#8598)
export const devourerOfDestiny = defineCard(() => ({
    id: "560debcd-feb4-4534-991e-a7aa1cca2409",
    rarity: "rare",
    name: "Devourer of Destiny",
    oracleText:
        "You may reveal this card from your opening hand. If you do, at the beginning of your first upkeep, look at the top four cards of your library. You may put one of those cards back on top of your library. Exile the rest.\nWhen you cast this spell, exile target permanent that's one or more colors.",
    manaCost: { X: 5, C: 2 },
    types: ["Creature"],
    subtypes: ["Eldrazi"],
    power: 6,
    toughness: 6,
    openingHandAction: "reveal",
    openingHandReveal: {
        oracleText:
            "At the beginning of your first upkeep, look at the top four cards of your library. You may put one of those cards back on top of your library. Exile the rest.",
        effects: [
            {
                op: "lookDistribute",
                player: "controller",
                look: 4,
                take: 1,
                keepTo: "library-top",
                optional: true,
                destination: "exile",
            },
        ],
    },
    triggeredAbilities: [
        spellCastTrigger({
            id: "devourer-of-destiny-cast-exile",
            oracleText:
                "When you cast this spell, exile target permanent that's one or more colors.",
            scope: "self",
            targetRequirement: DEVOURER_COLORED_PERMANENT,
            effects: [{ op: "exile", target: { target: 0 } }],
        }),
    ],
}));
