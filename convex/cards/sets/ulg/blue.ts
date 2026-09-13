// Urza's Legacy (ULG) — blue cards, split by colour per ADR 0043. The
// registry's `import * as ulg from "./sets/ulg"` resolves through ulg/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";
import { cyclingAbility } from "../../abilities/cycling";
import { echoTrigger } from "../../abilities/echo";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Cloud of Faeries — {1}{U} 1/1 Faerie with flying. "When this creature enters,
// untap up to two lands." plus Cycling {2}. The ETB is Frantic Search's untap
// pair below (a `choose-permanents` pick of up to two lands on EVERY player's
// battlefield — no "you control" is printed, CR 109.2 — then `tapUntap` over
// the picks, CR 701.26b). Cycling is the shared `cyclingAbility` factory
// (CR 702.29a).
// compiler-gap: "Cycling {2}" (#2693)
// compiler-gap: "When this creature enters, untap up to two lands." (#2693)
export const cloudOfFaeries: CardDefinition = {
    id: "4e76d04a-0038-4b5b-a026-3056ee940da9", // ULG 29
    rarity: "common",
    name: "Cloud of Faeries",
    oracleText:
        "Flying\nWhen this creature enters, untap up to two lands.\nCycling {2} ({2}, Discard this card: Draw a card.)",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "cloud-of-faeries-etb-untap",
            oracleText: "When this creature enters, untap up to two lands.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: "controller",
                    zone: "battlefield",
                    allControllers: true,
                    filter: { type: "Land" },
                    count: { min: 0, max: 2 },
                    prompt: "Untap up to two lands (Cloud of Faeries).",
                    bind: "$lands",
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$lands" },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ],
        }),
    ],
    activatedAbilities: [cyclingAbility({ generic: 2 })],
};

// Raven Familiar — {2}{U} 1/2 Bird with flying and Echo {2}{U}. "When this
// creature enters, look at the top three cards of your library. Put one of them
// into your hand and the rest on the bottom of your library in any order."
// Echo (CR 702.30a) is the `echo` keyword string (it arms `echoPending` on entry)
// plus the shared `echoTrigger` upkeep pay-or-sacrifice template, Goblin Patrol's
// shape (usg/red.ts). The ETB is Impulse's `lookDistribute` (vis/blue.ts) one
// card shallower: look 3, keep 1 to hand, bottom the rest (CR 401.4).
// compiler-gap: "Echo {2}{U}" (#2693)
// compiler-gap: "When this creature enters, look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order." (#2693)
export const ravenFamiliar: CardDefinition = {
    id: "b104638d-29aa-490c-8cfb-e08fc94efb59", // ULG 39
    rarity: "uncommon",
    name: "Raven Familiar",
    oracleText:
        "Flying\nEcho {2}{U} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)\nWhen this creature enters, look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 2,
    staticAbilities: ["flying", "echo"],
    triggeredAbilities: [
        echoTrigger({
            id: "raven-familiar-echo",
            cost: { X: 2, U: 1 },
            costLabel: "{2}{U}",
        }),
        enteredTrigger({
            id: "raven-familiar-etb-look",
            oracleText:
                "When this creature enters, look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.",
            scope: "self",
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 3,
                    take: 1,
                },
            ],
        }),
    ],
};

// Frantic Search — {2}{U} Instant. "Draw two cards, then discard two cards.
// Untap up to three lands." (CR 121.1 draw, CR 701.9 discard, CR 701.26
// untap.) DSL Effect Script (ADR 0045): `draw` runs first (the hand always
// grows by 2 before the discard pick, so the fixed `count: 2` on the
// following `choose-hand-card` choice never over-asks), then a `choice(
// choose-hand-card)` + `discard` looter pair (the shipped Vodalian Merchant
// template, inv/blue.ts), then a `choice(choose-permanents, zone:
// "battlefield", filter: { type: "Land" }, allControllers: true)` picks up to
// three lands — ANY player's, since the Oracle prints no "you control"
// (CR 109.2), the same reading Time Spiral's "untap up to six lands" takes
// (usg/blue.ts) — and a `forEach { set: "bound" }`
// over that PICKS binding untaps each pick (`tapUntap`, CR 701.26). Was
// `resolveSteps` until issue #1284 widened `forEach { set: "bound" }`'s
// validator to accept a `choice` Op's picks binding directly (previously
// LIST-family only, ADR 0049) — the runtime binding store
// (`readBinding`/`recallChoice`) was always shape-identical for both
// families; only the static validator was restrictive.
export const franticSearch: CardDefinition = {
    id: "1904db14-6df7-424f-afa5-e3dfab31300a",
    name: "Frantic Search",
    rarity: "common",
    oracleText:
        "Draw two cards, then discard two cards. Untap up to three lands.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    effects: [
        { op: "draw", player: "controller", count: 2 },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: 2,
            prompt: "Discard two cards (Frantic Search).",
            bind: "$discards",
        },
        {
            op: "discard",
            player: "controller",
            cards: { ref: "$discards" },
        },
        {
            op: "choice",
            kind: "choose-permanents",
            player: "controller",
            zone: "battlefield",
            allControllers: true,
            filter: { type: "Land" },
            count: { min: 0, max: 3 },
            prompt: "Untap up to three lands (Frantic Search).",
            bind: "$lands",
        },
        {
            op: "forEach",
            select: { set: "bound", ref: "$lands" },
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$each" } },
            ],
        },
    ],
};

// Tinker — {2}{U} Sorcery. "As an additional cost to cast this spell,
// sacrifice an artifact. Search your library for an artifact card, put that
// card onto the battlefield, then shuffle." (CR 118.8 additional cost /
// 701.23 / 400.7 / 701.24.) The additional cost reuses
// `additionalCosts.sacrificeFilter` (a plain `PermanentFilter`); the search
// is an unrestricted-by-value type filter (`type: "Artifact"`) straight to
// the battlefield.
export const tinker: CardDefinition = {
    id: "7da23b15-dfb8-4267-9b33-d7a4c035c434",
    name: "Tinker",
    rarity: "uncommon",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    oracleText:
        "As an additional cost to cast this spell, sacrifice an artifact.\nSearch your library for an artifact card, put that card onto the battlefield, then shuffle.",
    additionalCosts: {
        sacrificeFilter: { types: "Artifact" },
    },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Artifact" },
            count: 1,
            prompt: "Search your library for an artifact card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "battlefield",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};

// Miscalculation — {1}{U} Instant. "Counter target spell unless its controller
// pays {2}." plus Cycling {2} (CR 702.29). Same counter-unless-pay shape as
// Mana Leak (mayPay by the target spell's controller + if(not paid) → counter,
// CR 701.6a counter / 117.3a); the Cycling ability is the engine/cost capability from
// issue #689, declared via the shared `cyclingAbility` factory.
export const miscalculation: CardDefinition = {
    id: "4b4956a2-9a39-4152-9c98-70e4b2acfa26",
    name: "Miscalculation",
    rarity: "common",
    oracleText:
        "Counter target spell unless its controller pays {2}.\nCycling {2} ({2}, Discard this card: Draw a card.)",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "mayPay",
            // CR 117.3a — the spell's controller decides whether to pay.
            player: { controllerOf: { target: 0 } },
            cost: { X: 2 },
            prompt: "Pay {2} to prevent your spell from being countered?",
            bind: "$paid",
        },
        {
            // CR 701.6a — counter unless the payment was made.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
    // CR 702.29 — Cycling {2}. Usable only from hand at instant speed.
    activatedAbilities: [cyclingAbility({ generic: 2 })],
};
