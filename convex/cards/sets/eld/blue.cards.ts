// ELD — blue cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Slice #1337 (PRD #702, ADR 0063) — count-driven SELF-HOST cost reduction.
// CR 601.2f models cost modification applied as the cost is calculated;
// unlike every other `costReduction` consumer (Stone Calendar, Power
// Artifact, Mana Matrix, Planar Gate) — all discovered via a battlefield
// `staticEffects` scan — Emry's reducer is intrinsic to the SPELL being cast,
// which isn't a permanent yet at announcement. `selfCostReduction` is read
// directly off her own `CardDefinition` at the same 601.2f apply site
// (`getCostModifiers`, `gre/state.ts`). "Affinity for artifacts" here is
// authored DATA, not the generalized `affinity` KEYWORD (that keyword +
// convoke + Hogaak are deferred to slice #1338, ADR 0063) — Emry has no
// declared keyword.
// ─────────────────────────────────────────────────────────────────────────────

// Emry, Lurker of the Loch — {2}{U} Legendary Creature — Merfolk Wizard, 1/2
// (ELD). Modern Scryfall oracle text is authoritative (ADR 0004).
//
// The `{T}` ability (issue #1650) is a plain targeted activated ability whose
// target lives in a NON-battlefield zone (CR 601.2c / 400.7): `zone:
// "graveyard"` + `controller: "you"` + `type: "Artifact"` — the same
// requirement shape Regrowth and Necropolis already use. Its effect reuses the
// shipped `grantCastFromGraveyard` Op (issue #1344) rather than adding a
// primitive: the Op's `card` selector was widened from a bare picks ref to the
// full `EffectObjectSelector`, so an announced target slot names the card
// directly (ADR 0045 primitive reuse — generalize, don't add).
//
// `window: "this-turn"` is the ordinary impulse window every "you may cast
// that card this turn" card in this engine uses; `withoutPayingManaCost` is
// deliberately OMITTED — Emry's reminder text is explicit that "You still pay
// its costs. Timing rules still apply." The grant is revoked at CLEANUP.
export const emryLurkerOfTheLoch = defineCard(() => ({
    id: "bf4b9a8a-b42a-46fb-b0d0-9cf800f63c8a",
    rarity: "rare",
    name: "Emry, Lurker of the Loch",
    oracleText:
        "Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nWhen Emry enters, mill four cards.\n{T}: Choose target artifact card in your graveyard. You may cast that card this turn. (You still pay its costs. Timing rules still apply.)",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Merfolk", "Wizard"],
    power: 1,
    toughness: 2,
    selfCostReduction: {
        costReduction: {
            perCount: { X: 1 },
            countFilter: { types: "Artifact" },
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "emry-lurker-of-the-loch-etb",
            oracleText: "When Emry enters, mill four cards.",
            scope: "self",
            effects: [{ op: "mill", player: "controller", count: 4 }],
        }),
    ],
    activatedAbilities: [
        {
            id: "emry-lurker-of-the-loch-graveyard-cast",
            oracleText:
                "{T}: Choose target artifact card in your graveyard. You may cast that card this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [
                {
                    op: "grantCastFromGraveyard",
                    card: { target: 0 },
                    player: "controller",
                    window: "this-turn",
                },
            ],
        },
    ],
}));

// Mystical Dispute — {2}{U} Instant (ELD). Modern Scryfall oracle text is
// authoritative (ADR 0004).
//
// CR 601.2f — the "costs {2} less if it targets a blue spell" clause is a
// self-host reduction gated on the announced targets (`ifTargetsSpell`):
// targets are chosen before the total cost is determined (CR 601.2c precedes
// 601.2f), so the commit prices against them. The counter-unless-pay body is
// the shipped punisher template (Metallic Rebuke, aer/blue.cards.ts).
// hand-tail: This spell costs {2} less to cast if it targets a blue spell. (#8627)
export const mysticalDispute = defineCard(() => ({
    id: "fbe04cb8-a8b9-4241-baae-b398a2509a3a",
    name: "Mystical Dispute",
    rarity: "uncommon",
    oracleText:
        "This spell costs {2} less to cast if it targets a blue spell.\nCounter target spell unless its controller pays {3}.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    selfCostReduction: {
        costReduction: { X: 2 },
        ifTargetsSpell: { colors: "U" },
    },
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "mayPay",
            player: { controllerOf: { target: 0 } },
            cost: { X: 3 },
            prompt: "Pay {3} or your spell is countered (Mystical Dispute)?",
            bind: "$paid",
        },
        {
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
}));
