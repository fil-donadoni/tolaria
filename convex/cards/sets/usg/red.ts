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
//   - Effect (CR 613.1b, layer-2 control change): the shipped `gainControl` Op
//     donates the source to the opponent INDEFINITELY (no `duration` — the
//     Ghazbán Ogre / Wishclaw Talisman shape that never reverts). Modelled with
//     `controller: "opponent"`: in this strictly 2-player/solo engine "target
//     opponent" has exactly one legal target, so the non-targeted selector is
//     behaviourally identical (TriggeredAbility carries no targetRequirement).
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
            effects: [
                {
                    op: "gainControl",
                    target: { ref: "$source" },
                    controller: "opponent",
                },
            ],
        },
    ],
};
