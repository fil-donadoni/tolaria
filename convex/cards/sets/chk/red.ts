// CHK (Champions of Kamigawa) — red cards, split by colour per ADR 0043.
// The registry's `import * as chk from "./sets/chk"` resolves through
// chk/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Lava Spike — "Lava Spike deals 3 damage to target player or planeswalker."
// (CR 120.1 damage.) First DSL-only card (ADR 0045, issue #800): the whole
// effect is a declarative Effect Script — a single `dealDamage` Op on the
// announced target — executed by the interpreter through the existing
// SpellContext primitives. No imperative `resolve()`.
export const lavaSpike: CardDefinition = {
    id: "60b2fae1-242b-45e0-a757-b1adc02c06f3",
    rarity: "common",
    name: "Lava Spike",
    oracleText: "Lava Spike deals 3 damage to target player or planeswalker.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    subtypes: ["Arcane"],
    targetRequirement: { type: ["player", "Planeswalker"], count: 1 },
    effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
};

// Through the Breach — "You may put a creature card from your hand onto the
// battlefield. That creature gains haste. Sacrifice that creature at the
// beginning of the next end step." + "Splice onto Arcane {2}{R}{R}".
//
// TWO independent halves, and each one already had its shape in the engine.
//
// The put-with-haste-then-sacrifice half is Sneak Attack's Effect Script
// verbatim (`usg/red.ts`, issue #1151) with its activation cost replaced by
// casting this instant: `choice(choose-hand-card)` picks the creature (CR
// 601.2 — "you MAY", so `{ min: 0 }` makes declining legal),
// `moveZone(hand → battlefield, bind)` puts it in play without casting it
// (CR 400.7 — a new object, so no ETB-from-cast trigger, and a Containment
// Priest replacement can still redirect it), `grantAbility(haste)` is the
// CR 702.10 grant that makes it attack the turn it arrived, and the
// `delayedTrigger` captures THAT creature so the CR 603.7 sacrifice at the
// next end step cannot be dodged by a second choice at fire time.
// `duration: end-of-turn` on the haste grant is not a shortcut: the delayed
// sacrifice fires in the same end step, so nothing observes the grant past it.
//
// Splice onto Arcane {2}{R}{R} is CR 702.47a, shipped as the engine capability
// by issue #2394 (`gre/splice.ts`). The `effects` above ARE the text a spliced
// reveal adds — CR 702.47a adds the card's rules text verbatim, so the splice
// half declares only its subtype gate and its cost. Both halves of the card are
// therefore the same op list, reached two different ways: cast it, or reveal it
// as any Arcane spell is cast (Lava Spike above is the shipped pairing).
//
// compiler-gap: "You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice that creature at the beginning of the next end step." (#2693)
// compiler-gap: "Splice onto Arcane {2}{R}{R}" (#2693)
export const throughTheBreach: CardDefinition = {
    id: "6da09e6a-2965-4855-bd41-41b41ba188fb", // CHK 193
    rarity: "rare",
    name: "Through the Breach",
    oracleText:
        "You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice that creature at the beginning of the next end step.\nSplice onto Arcane {2}{R}{R} (As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost. If you do, add this card's effects to that spell.)",
    manaCost: { X: 4, R: 1 },
    types: ["Instant"],
    subtypes: ["Arcane"],
    splice: {
        subtype: "Arcane",
        cost: { mana: { X: 2, R: 2 } },
        description: "Splice onto Arcane {2}{R}{R}",
    },
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
            bind: "$breached",
        },
        {
            op: "grantAbility",
            ability: "haste",
            target: { ref: "$breached" },
            duration: { phase: "end-of-turn" },
        },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText:
                "Sacrifice that creature at the beginning of the next end step.",
            capture: { $captured: { ref: "$breached" } },
            effects: [{ op: "sacrifice", target: { ref: "$captured" } }],
        },
    ],
};
