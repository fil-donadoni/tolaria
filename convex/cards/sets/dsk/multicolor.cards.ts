// dsk — multicolor cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = DSK paper printing).

import { defineCard, EFFECT_AFFECTS_SELF } from "../../types";
import type { PermanentView, StaticEffectStateView } from "../../types";
import { ninjutsuAbility } from "../../abilities/ninjutsu";
import { KAITO_BANE_OF_NIGHTMARES_EMBLEM_ID } from "../../emblems";

/** Counter name of the CR 122.1d stun counter (`STUN_COUNTER` in
 *  `gre/replacements.ts`, which a card module does not import). */
const STUN = "stun";

/** CR 611.3a — the "During your turn, as long as Kaito has one or more loyalty
 *  counters on him" gate, re-read at every layer derivation: the source's
 *  controller is the active player AND the source has a loyalty counter.
 *  Because it reads counters, every MATERIALIZED kind gated on it declares
 *  `dependsOnCounters: true` (`CounterGatedStatic`), so a loyalty change
 *  re-runs the grant; `pt-set` is recomputed at read and needs nothing. */
const duringYourTurnWithLoyalty = (
    source: PermanentView,
    state: StaticEffectStateView
): boolean =>
    state.activePlayerId === source.controllerId &&
    (source.counters?.loyalty ?? 0) >= 1;

// Kaito, Bane of Nightmares — {2}{U}{B} Legendary Planeswalker — Kaito,
// loyalty 4 (DSK, issue #3237, Vintage Cube).
//
//   • Ninjutsu {1}{U}{B} (CR 702.49a) — `ninjutsuAbility`, its first
//     planeswalker user: the card enters tapped and attacking with its four
//     loyalty counters (CR 306.5b), which on your turn already makes it a
//     creature that can be attacking.
//   • "During your turn, as long as Kaito has one or more loyalty counters on
//     him, he's a 3/4 Ninja creature and has hexproof." One static ability,
//     split across the layers it touches and gated by ONE condition
//     (CR 611.3a): "he's a 3/4 Ninja creature" SETS the type line (CR 205.1a —
//     per the printed ruling he "stop[s] being a planeswalker during your
//     turn", so damage dealt to him is marked, never loyalty-removing), i.e.
//     layer 4 (CR 613.1d) adds Creature, removes Planeswalker and sets the
//     subtypes to Ninja (the Kaito subtype goes with the Planeswalker type,
//     CR 205.1a); layer 7b (CR 613.4b) sets base P/T 3/4; layer 6
//     (CR 613.1f) grants hexproof (CR 702.11). His loyalty abilities stay
//     activatable while he is a creature (the ruling; CR 606.4 — the cost is
//     loyalty counters, whatever the permanent's type).
//   • +1 — the emblem "Ninjas you control get +1/+1." (CR 114).
//   • 0 — Surveil 2 (CR 701.25a, `scryReorder` to the graveyard), then draw a
//     card for each opponent who lost life this turn: the per-turn life-loss
//     tally (`lifeLostThisTurn`, CR 119.3 / 119.4) over the opponent, one
//     card per PLAYER who lost any life — never per loss instance.
//   • −2 — Tap target creature, then two stun counters on it (CR 122.1d,
//     enforced by the engine's untap replacement).
// compiler-gap: "+1: You get an emblem with "Ninjas you control get +1/+1."" (#8501)
export const kaitoBaneOfNightmares = defineCard(() => ({
    id: "55a14f30-4ff9-4472-90a6-c3139f1c18e5",
    name: "Kaito, Bane of Nightmares",
    rarity: "mythic",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Planeswalker"],
    subtypes: ["Kaito"],
    supertypes: ["Legendary"],
    loyalty: 4,
    oracleText:
        'Ninjutsu {1}{U}{B} ({1}{U}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)\nDuring your turn, as long as Kaito has one or more loyalty counters on him, he\'s a 3/4 Ninja creature and has hexproof.\n+1: You get an emblem with "Ninjas you control get +1/+1."\n0: Surveil 2. Then draw a card for each opponent who lost life this turn.\n−2: Tap target creature. Put two stun counters on it.',
    staticEffects: [
        {
            kind: "type-add",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            dependsOnCounters: true,
            types: ["Creature"],
        },
        {
            kind: "type-remove",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            dependsOnCounters: true,
            types: ["Planeswalker"],
        },
        {
            kind: "subtype-set",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            dependsOnCounters: true,
            subtypes: ["Ninja"],
        },
        {
            kind: "pt-set",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            power: 3,
            toughness: 4,
        },
        {
            kind: "keyword-grant",
            applies: EFFECT_AFFECTS_SELF,
            condition: duringYourTurnWithLoyalty,
            dependsOnCounters: true,
            keyword: "hexproof",
        },
    ],
    activatedAbilities: [
        ninjutsuAbility({ X: 1, U: 1, B: 1 }),
        {
            id: "kaito-bane-of-nightmares-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                '+1: You get an emblem with "Ninjas you control get +1/+1."',
            effects: [
                { op: "emblem", emblem: KAITO_BANE_OF_NIGHTMARES_EMBLEM_ID },
            ],
        },
        {
            id: "kaito-bane-of-nightmares-0",
            cost: { loyalty: 0 },
            useStack: true,
            oracleText:
                "0: Surveil 2. Then draw a card for each opponent who lost life this turn.",
            effects: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 2,
                    destination: "graveyard",
                },
                {
                    op: "if",
                    predicate: {
                        left: { lifeLostThisTurn: { of: "opponent" } },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
        {
            id: "kaito-bane-of-nightmares-minus2",
            cost: { loyalty: -2 },
            useStack: true,
            oracleText: "−2: Tap target creature. Put two stun counters on it.",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                { op: "tapUntap", action: "tap", target: { target: 0 } },
                {
                    op: "counters",
                    action: "add",
                    counter: STUN,
                    target: { target: 0 },
                    count: 2,
                },
            ],
        },
    ],
}));
