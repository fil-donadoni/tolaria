// FRA — blue cards, split by colour per ADR 0043. The registry's
// `import * as fra from "./sets/fra/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost:
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, type EffectOp } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";

// Sphinx of False Conclusions — {2}{U}{U} Creature — Sphinx Illusion 4/2 (FRA,
// issue #7250, Vintage Cube). Flash, flying; "Whenever this creature attacks,
// draw a card, then discard a card." and "When this creature dies, if it isn't
// a token, create a token that's a copy of it."
//
// Authored DSL-first (ADR 0045) out of shipped Ops: the loot is `draw` →
// `choice` (choose-hand-card) → `discard` (CR 701.9, same shape as
// Currency Converter, `ncc/colorless.cards.ts`); the dies half is
// `createTokenCopy` of `{ ref: "$source" }` (CR 707.2), which recovers the
// dead creature from the last-known copiable values (CR 608.2h / 111.12).
//
// The "if it isn't a token" clause is read at CHECK time off the dying
// permanent (`condition`, CR 603.4) — the token copy carries the same dies
// trigger (CR 707.2), but its own death fails the clause, so the chain ends
// after one copy (precedent: Vaultborn Tyrant, `big/green.cards.ts`).
// hand-tail: it isn't a token (#7250)
export const sphinxOfFalseConclusions = defineCard(() => ({
    id: "08ffbd51-2bd3-4262-8809-09576ce2b6f5",
    name: "Sphinx of False Conclusions",
    rarity: "rare",
    oracleText:
        "Flash\nFlying\nWhenever this creature attacks, draw a card, then discard a card.\nWhen this creature dies, if it isn't a token, create a token that's a copy of it.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Sphinx", "Illusion"],
    power: 4,
    toughness: 2,
    staticAbilities: ["flash", "flying"],
    triggeredAbilities: [
        attacksTrigger({
            id: "sphinx-of-false-conclusions-attack-loot",
            oracleText:
                "Whenever this creature attacks, draw a card, then discard a card.",
            scope: "self",
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Sphinx of False Conclusions: discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        }),
        diedTrigger({
            id: "sphinx-of-false-conclusions-dies-copy",
            oracleText:
                "When this creature dies, if it isn't a token, create a token that's a copy of it.",
            scope: "self",
            condition: (_event, self) => !self.isToken,
            effects: [
                {
                    op: "createTokenCopy",
                    source: { ref: "$source" },
                    controller: "controller",
                },
            ],
        }),
    ],
}));

/** Counter name of the CR 122.1d stun counter (`STUN_COUNTER` in
 *  `gre/replacements.ts`, which a card module does not import). */
const STUN = "stun";

/** "tap up to that many target creatures and put a stun counter on each of
 *  them" — the reflexive ability's body, over however many targets were
 *  announced (CR 601.2c: 0 to the cap). */
const TAP_AND_STUN_TARGETS: EffectOp[] = [
    {
        op: "forEach",
        select: { set: "targets" },
        effects: [
            { op: "tapUntap", action: "tap", target: { ref: "$each" } },
            {
                op: "counters",
                action: "add",
                counter: STUN,
                target: { ref: "$each" },
                count: 1,
            },
        ],
    },
];

/** A reflexive "When you discard one or more nonland cards this way" ability
 *  announcing up to `max` target creatures (CR 603.12, CR 603.3d). */
const reflexiveTapAndStun = (max: number): EffectOp => ({
    op: "reflexiveTrigger",
    oracleText:
        "When you discard one or more nonland cards this way, tap up to that many target creatures and put a stun counter on each of them.",
    targetRequirement: { type: "Creature", count: { min: 0, max } },
    effects: TAP_AND_STUN_TARGETS,
});

/** The nonland cards the ETB's discard put into a graveyard (the Seasoned
 *  Pyromancer count, `mh1/red.cards.ts`). */
const NONLAND_DISCARDED = {
    count: {
        zone: "graveyard",
        controller: "controller",
        filter: { excludeType: "Land" },
        picks: { ref: "$discarded" },
    },
} as const;

// Seasoned Cryomancer — {1}{U}{U} Creature — Human Wizard 2/2 (FRA, issue
// #7248, Vintage Cube). "When this creature enters, draw two cards, then
// discard two cards. When you discard one or more nonland cards this way, tap
// up to that many target creatures and put a stun counter on each of them.
// {3}{U}{U}, Exile this card from your graveyard: Draw two cards."
//
// Seasoned Pyromancer's shape (`mh1/red.cards.ts`): a two-card `discard-hand`
// pick bound as a Picks Binding, the `discard`, and a `count` construct over
// that binding narrowed to nonland cards, read once after the discard
// (CR 701.9, CR 608.2h). The second sentence is a REFLEXIVE trigger
// (CR 603.12): its "up to that many" target count is fixed as it goes on the
// stack (CR 603.3d, CR 601.2c) and a reflexive requirement cannot read the
// resolving script's bindings, so the count is branched here — 2 or more
// nonland discards announce up to two targets, exactly one announces up to
// one (a discard of two never exceeds two). Stun counters are engine rules
// (CR 122.1d, `applyUntapReplacements`). The graveyard ability exiles its own
// source as the cost and functions only from the graveyard (CR 113.6m).
// compiler-gap: When you discard one or more nonland cards this way, tap up to that many target creatures and put a stun counter on each of them (#7219)
export const seasonedCryomancer = defineCard(() => ({
    id: "51d86875-420d-4e82-b69c-4feeb99c9428",
    name: "Seasoned Cryomancer",
    rarity: "mythic",
    oracleText:
        "When this creature enters, draw two cards, then discard two cards. When you discard one or more nonland cards this way, tap up to that many target creatures and put a stun counter on each of them.\n{3}{U}{U}, Exile this card from your graveyard: Draw two cards.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "seasoned-cryomancer-etb",
            oracleText:
                "When this creature enters, draw two cards, then discard two cards. When you discard one or more nonland cards this way, tap up to that many target creatures and put a stun counter on each of them.",
            scope: "self",
            effects: [
                { op: "draw", player: "controller", count: 2 },
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: "controller",
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$discarded",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discarded" },
                },
                {
                    op: "if",
                    predicate: { left: NONLAND_DISCARDED, op: "ge", right: 1 },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                left: NONLAND_DISCARDED,
                                op: "ge",
                                right: 2,
                            },
                            then: [reflexiveTapAndStun(2)],
                            else: [reflexiveTapAndStun(1)],
                        },
                    ],
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "seasoned-cryomancer-graveyard",
            oracleText:
                "{3}{U}{U}, Exile this card from your graveyard: Draw two cards.",
            cost: { mana: { X: 3, U: 2 }, exileThis: true },
            useStack: true,
            activateFromGraveyard: true,
            effects: [{ op: "draw", player: "controller", count: 2 }],
        },
    ],
}));
