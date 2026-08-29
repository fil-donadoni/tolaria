// usg — red cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004). Goblin Patrol's
// echo cost is {R} under the modern errata (the original printing read a bare
// "Echo", errata'd to the explicit mana-cost payment).

import type { CardDefinition } from "../../types";
import { echoTrigger } from "../../abilities/echo";

// Goblin Patrol — {R} 2/1 Goblin with Echo {R} (CR 702.30). Home set is Urza's
// Saga, its earliest paper printing (ADR 0041 routes a card to that set); the
// print id below is the usg printing (Premodern-legal, in the CR-legal pool).
export const goblinPatrol: CardDefinition = {
    id: "d0fcd8d3-f159-49a1-8dd9-582ae4a0adc3",
    name: "Goblin Patrol",
    rarity: "common",
    oracleText:
        "Echo {R} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 1,
    // CR 702.30 — the `echo` keyword string drives the ETB `echoPending` flag
    // (state.ts); the trigger template below performs the upkeep pay-or-sac.
    staticAbilities: ["echo"],
    triggeredAbilities: [
        echoTrigger({
            id: "goblin-patrol-echo",
            cost: { R: 1 },
            costLabel: "{R}",
        }),
    ],
};

// Goblin Cadets — {R} 2/1 Goblin with a control-donation drawback. Home set is
// Urza's Saga, its earliest paper printing (ADR 0041 / ADR 0043; the issue's
// "TMP" label is an author slip — the card has no Tempest printing, Scryfall
// prints only usg + cmd). Modern Scryfall oracle is authoritative (ADR 0004):
// a 2/1 (not the 2/2 the issue paraphrased) whose trigger is "blocks OR becomes
// blocked" (not "attacks or blocks").
//
// "Whenever this creature blocks or becomes blocked, target opponent gains
// control of it. (This removes this creature from combat.)"
//   - Trigger (CR 509.1): fires on BLOCKERS_CONFIRMED when the source is either
//     side of a confirmed pair — the blocker (it "blocks") or the attacker (it
//     "becomes blocked"). Same pair-matching convention as combatPairKill /
//     Cockatrice / Thicket Basilisk (event.attackerId | event.blockerId).
//   - Target (CR 603.3d): "target opponent" is announced as the trigger goes
//     on the stack, through the ability's own `targetRequirement`. It used to
//     ride the relative `controller: "opponent"` selector on the grounds that a
//     2-player game has exactly one opponent — sound for IDENTITY, wrong for
//     LEGALITY: only a declared requirement reaches the single player-target
//     gate, so protection from everything and shroud were ignored (CR 702.16b /
//     702.18 via CR 115.4, issue #2801). With no legal target the trigger is
//     removed from the stack and the donation never happens.
//   - Effect (CR 613.1b, layer-2 control change): the shipped `gainControl` Op
//     donates the source to the announced target INDEFINITELY (no `duration` —
//     the Ghazbán Ogre / Wishclaw Talisman shape that never reverts).
//   - The reminder text is CR 506.4c: the control change removes the creature
//     from combat, handled generically in `applyControlChange`.
export const goblinCadets: CardDefinition = {
    id: "60081115-16bc-4924-b76d-7cfc0ad2287c",
    name: "Goblin Cadets",
    rarity: "uncommon",
    oracleText:
        "Whenever this creature blocks or becomes blocked, target opponent gains control of it. (This removes this creature from combat.)",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "goblin-cadets-donate",
            oracleText:
                "Whenever this creature blocks or becomes blocked, target opponent gains control of it.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) =>
                event.type === "BLOCKERS_CONFIRMED" &&
                (event.attackerId === self.id || event.blockerId === self.id),
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                {
                    op: "gainControl",
                    target: { ref: "$source" },
                    controller: { target: 0 },
                },
            ],
        },
    ],
};

// Sneak Attack — {3}{R} Enchantment. "{R}: You may put a creature card from
// your hand onto the battlefield. That creature gains haste. Sacrifice the
// creature at the beginning of the next end step." (CR 400.7 hand →
// battlefield, CR 702.10 haste, CR 603.7 delayed trigger, CR 701.21 sacrifice
// .) Vintage Cube FREE tranche, issue #686; SHIPPED by issue #1151,
// which closed two composability gaps this card needed:
//   1. `sacrificeObject` (mechanicsRegistry.ts EFFECT_OP_BACKLOG) — turned out
//      to already be shipped as the existing `sacrifice` Op's single-object
//      `target` form (issue #731, Kjeldoran Elite Guard), which also serves a
//      `delayedTrigger`-captured object at fire time (`runDelayedTriggerBody`
//      re-binds a captured battlefield permanent id as a fresh snapshot). The
//      stale backlog reservation is removed; no new Op name was needed.
//   2. `moveZone`'s choice-driven `cards`-shape had no `bind` field (issue
//      #1120 gap 3, Cauldron Dance's identical hand-side clause) — there was
//      no way to snapshot the permanent that just entered from hand for a
//      follow-up Op. `bind` (valid only with `to: "battlefield"`) now
//      captures it, letting `grantAbility` and `delayedTrigger`'s `capture`
//      read `{ ref: "$sneak" }` for the exact creature that entered.
// `grantAbility(haste)` uses `duration: { phase: "end-of-turn" }` (Spinal
// Embrace's identical idiom, inv/multicolor.ts) rather than a genuinely
// indefinite grant — the DSL's `grantAbility` Op requires a `DurationSpec`
// (no "indefinite" member). No behavioural divergence: the delayed trigger
// fires at the BEGINNING of the next end step (sacrificing the creature),
// strictly before the end-of-turn CLEANUP boundary the duration expires at —
// the creature is always gone before the grant would lapse on its own.
export const sneakAttack: CardDefinition = {
    id: "d07dc95d-82a8-4a58-8ea2-d4513bd7316d", // USG 218
    name: "Sneak Attack",
    rarity: "rare",
    oracleText:
        "{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.",
    manaCost: { X: 3, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "sneak-attack-put",
            oracleText:
                "{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.",
            cost: { mana: { R: 1 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    filter: { type: "Creature" },
                    count: { min: 0, max: 1 },
                    prompt: "Put a creature card from your hand onto the battlefield (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "hand",
                    to: "battlefield",
                    bind: "$sneak",
                },
                {
                    op: "grantAbility",
                    ability: "haste",
                    target: { ref: "$sneak" },
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Sacrifice the creature at the beginning of the next end step.",
                    capture: { $captured: { ref: "$sneak" } },
                    effects: [
                        { op: "sacrifice", target: { ref: "$captured" } },
                    ],
                },
            ],
        },
    ],
};

// Arc Lightning — "Arc Lightning deals 3 damage divided as you choose among
// one, two, or three targets." (CR 601.2d / 120.4 divide-as-you-choose.) The
// `divideAsChosen.total` drives the client per-target stepper UI; the count is
// open-ended `{ min: 1 }`, capped at the 3-point total by the engine (each
// target needs ≥ 1). Home set is Urza's Saga, its earliest paper printing
// (ADR 0041).
//
// DSL-first (ADR 0045): the `dealDamageDividedAsChosen` Op (CR 601.2d / 120.4)
// reads the announced per-target split back off the stack item; `total`
// mirrors `divideAsChosen.total`.
export const arcLightning: CardDefinition = {
    id: "0c81ade7-0074-4447-ba2c-b16fa0f09ccb", // USG 174
    rarity: "common",
    name: "Arc Lightning",
    oracleText:
        "Arc Lightning deals 3 damage divided as you choose among one, two, or three targets.",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "any",
        count: { min: 1 },
        divideAsChosen: { total: 3 },
    },
    effects: [{ op: "dealDamageDividedAsChosen", total: 3 }],
};
