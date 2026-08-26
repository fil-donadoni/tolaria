// LCI — blue cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Tishana's Tidebinder — {2}{U} Creature — Merfolk Wizard, 3/2 (LCI, issue
// #1562, split out of #1528, parent PRD #1525). "Flash. When this creature
// enters, counter up to one target activated or triggered ability. If an
// ability of an artifact, creature, or planeswalker is countered this way,
// that permanent loses all abilities for as long as this creature remains on
// the battlefield. (Mana abilities can't be targeted.)"
//
// COUNTER HALF (CR 603.3d ETB-targeted trigger, Stifle-parity): the SAME
// `targetRequirement` shape Stifle (scg/blue.ts) ships —
// `spellStackKind: "ability"` keeps any ability (activated OR triggered) on
// the stack legal and drops spells; `count: { min: 0, max: 1 }` is "up to
// one" (Loran precedent, bro/white.ts). Mana abilities are never legal
// targets by construction (CR 605.3a — they never use the stack), so no
// extra exclusion is needed. `ctx.counter` vanishes the countered ability
// (CR 701.6a / 113.7a) — an ability is not a card, so it goes nowhere.
//
// RIDER HALF (CR 613.1f layer 6, CR 611.2b "for as long as . . ." duration,
// engine gap closed by issue #1562's new `loseAllAbilitiesWhileSourceRemains`
// Op): the SAME announced slot (`{ target: 0 }`) is re-read after the
// counter — CR 113.7a's countered-ability stack item borrows its SOURCE
// PERMANENT's own battlefield id, so the slot resolves to the permanent even
// though its `TargetSelection.type` says "spell". `filter` restricts the
// strip to "an artifact, creature, or planeswalker" per the printed rider;
// the Op is a no-op when nothing was targeted (CR 608.2b — "up to one" chose
// none) or the countered ability's source doesn't match. The loss is torn
// down automatically the moment Tishana's Tidebinder itself leaves the
// battlefield — no bespoke teardown, see the Op's own doc comment
// (`cards/types.ts`).
export const tishanasTidebinder: CardDefinition = {
    id: "907b3d1d-8c85-4707-80b5-c4d832df9846",
    name: "Tishana's Tidebinder",
    rarity: "rare",
    oracleText:
        "Flash\nWhen this creature enters, counter up to one target activated or triggered ability. If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature remains on the battlefield. (Mana abilities can't be targeted.)",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Wizard"],
    power: 3,
    toughness: 2,
    staticAbilities: ["flash"],
    triggeredAbilities: [
        enteredTrigger({
            id: "tishanas-tidebinder-etb",
            oracleText:
                "When this creature enters, counter up to one target activated or triggered ability. If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all abilities for as long as this creature remains on the battlefield.",
            scope: "self",
            targetRequirement: {
                type: "spell",
                spellStackKind: "ability",
                count: { min: 0, max: 1 },
            },
            effects: [
                { op: "counter", target: { target: 0 } },
                {
                    op: "loseAllAbilitiesWhileSourceRemains",
                    target: { target: 0 },
                    filter: { type: ["Artifact", "Creature", "Planeswalker"] },
                },
            ],
        }),
    ],
};

// Malcolm, Alluring Scoundrel — {1}{U} Legendary Creature — Siren Pirate,
// 2/1 (LCI, residue of #1302, parent PRD #620, issues #1344 / #1477). "Flash.
// Flying. Whenever Malcolm deals combat damage to a player, put a chorus
// counter on it. Draw a card, then discard a card. If there are four or more
// chorus counters on Malcolm, you may cast the discarded card without paying
// its mana cost." DSL-first (ADR 0045) — no `resolve()`.
//
// TRIGGER HALF (CR 603.2 damage trigger): `event: "DAMAGE_DEALT"` +
// `matches` mirrors the shipped Barrowgoyf/Nethergoyf "deals combat damage
// to a player" template (m3c/black.ts) — combat damage from THIS creature to
// a player. The body is a flat Op sequence, no `resolveSteps` needed (unlike
// Barrowgoyf, nothing here reads `event.amount` — CR 122.6 `counters` and
// CR 121.1 `draw`/discard are all fixed-count):
//   1. `counters` — put a chorus counter on $source (CR 122.1).
//   2. `draw` — draw a card (CR 121.1).
//   3. `choice(kind: "choose-hand-card")` + `discard` — "then discard a
//      card" (CR 701.9), the SAME choice+discard idiom Krovikan Sorcerer
//      uses (ice/blue.ts). Binds the discarded card's instance id as
//      `$discarded` for the threshold clause below — the id is stable
//      across the discard (a zone move, not a new instance).
//   4. `if` gated on the chorus-counter READ (`{ counters: { of: {ref:
//      "$source"}, type: "chorus" } }`, CR 122.6, issue #1015) `>= 4`:
//      `castDuringResolution` (CR 608.2f, issue #1477) offers the caster an
//      optional Cast/Decline of the JUST-discarded card and, on accept, casts
//      it INLINE from the graveyard for free, as part of THIS trigger's own
//      resolution — matching the official ruling ("you do so as part of the
//      resolution of the ability; you can't wait to cast the spell later in
//      the turn; timing permissions based on the card's type are ignored").
//      Passes silently (no prompt) when `$discarded` was never captured (an
//      empty hand at discard time, CR 608.2b) or the picked card is a LAND
//      (lands are played, not cast — the official land ruling), so those cases
//      finish the trigger with nothing cast. No later-in-turn window is ever
//      granted (the impulse-window bug of the previous `grantCastFromGraveyard`
//      implementation, issue #1344, is gone).
export const malcolmAlluringScoundrel: CardDefinition = {
    id: "19d6834d-afa3-4747-a62d-0654f4d9729f",
    name: "Malcolm, Alluring Scoundrel",
    rarity: "rare",
    oracleText:
        "Flash\nFlying\nWhenever Malcolm deals combat damage to a player, put a chorus counter on it. Draw a card, then discard a card. If there are four or more chorus counters on Malcolm, you may cast the discarded card without paying its mana cost.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Siren", "Pirate"],
    power: 2,
    toughness: 1,
    staticAbilities: ["flash", "flying"],
    triggeredAbilities: [
        {
            id: "malcolm-chorus",
            oracleText:
                "Whenever Malcolm deals combat damage to a player, put a chorus counter on it. Draw a card, then discard a card. If there are four or more chorus counters on Malcolm, you may cast the discarded card without paying its mana cost.",
            event: "DAMAGE_DEALT",
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "DAMAGE_DEALT" &&
                event.sourceInstanceId === self.id &&
                event.isCombat === true &&
                event.target.type === "player",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "chorus",
                    target: { ref: "$source" },
                    count: 1,
                },
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card (Malcolm, Alluring Scoundrel).",
                    bind: "$discarded",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discarded" },
                },
                {
                    op: "if",
                    predicate: {
                        left: {
                            counters: {
                                of: { ref: "$source" },
                                type: "chorus",
                            },
                        },
                        op: "ge",
                        right: 4,
                    },
                    then: [
                        {
                            op: "castDuringResolution",
                            card: { ref: "$discarded" },
                            player: "controller",
                            source: "graveyard",
                            free: true,
                        },
                    ],
                },
            ],
        },
    ],
};
