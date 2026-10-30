// TDM — red cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, AURA_AFFECTS_HOST } from "../../types";
import {
    nthSpellThisTurn,
    spellCastTrigger,
} from "../../abilities/triggers/spellCastTrigger";
import { equipAbility } from "../../abilities/equipment";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { graveyardSize } from "../../graveyardOrder";

// Cori-Steel Cutter (TDM #103, issue #1202, parent PRD #620 — split out of
// #699). Confirmed against Scryfall (the issue's paraphrase was inaccurate on
// three points, corrected here): mana cost {1}{R} (mono-red, not colourless),
// the token is a 1/1 WHITE Monk (not red), and the attach clause is "You MAY
// attach" (CR 608.2b optional action), not a mandatory "then attach". Full
// oracle text: "Equipped creature gets +1/+1 and has trample and haste.
// Flurry — Whenever you cast your second spell each turn, create a 1/1 white
// Monk creature token with prowess. You may attach this Equipment to it.
// (Whenever you cast a noncreature spell, the token gets +1/+1 until end of
// turn.) Equip {1}{R}".
//
// "Flurry" is an italicized CR 207.2c ABILITY WORD (Scryfall lists it under
// `keywords` alongside real keywords, but the oracle text's own "Flurry —"
// em-dash format is the ability-word template, CR 207.2c) — purely
// organizational flavour text with NO independent rules meaning, like
// Threshold/Delirium (mechanicsRegistry.ts header). It earns no
// MECHANICS_REGISTRY row and is never declared in `staticAbilities[]`; the
// underlying trigger condition — "whenever you cast your second spell each
// turn" — is exactly `nthSpellThisTurn(2)` + `scope: "you"`
// (abilities/triggers/spellCastTrigger.ts, issue #1343/#1041), the SAME
// per-player spell-count plumbing Ledger Shredder (snc/blue.cards.ts) already
// exercises for connive's "a player casts their second spell" (that one uses
// `scope: "any"`; Cori-Steel Cutter's own controller only, hence "you").
//
// The token engine (Prowess, #699) rides `getDefinition`'s
// `expandKeywordTriggers` seam unmodified: a token's synthesized def is
// registered via `registerTokenDefinition` and read back through the same
// `getDefinition`/`tryGetDefinition` call every printed card uses, so
// `staticAbilities: ["prowess"]` on the token spec expands into the CR
// 702.108a trigger exactly as it would on a printed creature — no new
// plumbing, no token-specific prowess path (cards/index.cards.ts `expandDefinition`
// memoizes per-object-identity, keyed off the token's own synthesized def).
//
// "Create a token, then [optionally] attach THIS equipment to the
// JUST-CREATED token" is the one genuinely new composition this card needs.
// AUDITED (per the task brief) whether the DSL could express it before
// reaching for `resolve()`: `createToken` had no way to hand the created
// token's id to a later Op, but `destroy` / `exile` / `moveZone`'s `to:
// "battlefield"` shape already carry a near-identical `bind?: string` field
// that snapshots an object for a later Op to `{ ref }` — the SAME
// snapshot-family binding `attach`'s `target: EffectObjectSelector` already
// accepts (Reconfigure, neo/white.cards.ts). Generalizing `createToken` with the
// identical `bind` field (issue #1202, `cards/types.ts` +
// `gre/effects/interpreter.ts` + `gre/effects/validate.ts`) is a "generalize,
// don't add" primitive-reuse move, not a new Op — it required no new grammar,
// no new validator family, and no new binding kind (the schema row tags its
// `bind` with the existing "snapshot" family). The "you MAY attach"
// half reuses the pre-existing cost-free `mayPay` Op (issue #680 — "a bare
// optional action with no payment", the exact shape `drk/white.cards.ts`'s Fasting
// already exercises for "you may skip your draw step"). No STOP-AND-ISSUE
// needed: the full oracle text is expressible with zero new Ops, only a
// field generalization on an existing one.
//
// Static effects (CR 611, layer 7c + 6): +1/+1 is a flat `pt-buff`; trample
// and haste are two `keyword-grant`s. All three gate on `AURA_AFFECTS_HOST`
// (reads `source.attachedTo === target.id` — generic across Auras AND
// Equipment, Lion Sash's `pt-cda` already reuses it for an Equipment host).
//
// Equip {1}{R} (CR 702.6e, sorcery-speed-only) is the SAME `attach` Op
// Reconfigure's first activated ability uses, targeting an announced
// creature you control (not a `bind` snapshot — this is the ordinary
// activated-ability form, CR 701.3c).
export const coriSteelCutter = defineCard(() => ({
    id: "490eb213-9ae2-4b45-abec-6f1dfc83792a",
    name: "Cori-Steel Cutter",
    rarity: "rare",
    oracleText:
        "Equipped creature gets +1/+1 and has trample and haste.\nFlurry — Whenever you cast your second spell each turn, create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it. (Whenever you cast a noncreature spell, the token gets +1/+1 until end of turn.)\nEquip {1}{R}",
    manaCost: { generic: 1, R: 1 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 1, toughness: 1 },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "trample",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "haste",
        },
    ],
    triggeredAbilities: [
        spellCastTrigger({
            id: "cori-steel-cutter-flurry",
            oracleText:
                "Flurry — Whenever you cast your second spell each turn, create a 1/1 white Monk creature token with prowess. You may attach this Equipment to it.",
            // CR 601.2i — the controller's own cast, not "a player's" (unlike
            // Ledger Shredder's connive, scope: "any").
            scope: "you",
            condition: nthSpellThisTurn(2),
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Monk",
                        types: ["Creature"],
                        subtypes: ["Monk"],
                        power: 1,
                        toughness: 1,
                        colors: ["W"],
                        staticAbilities: ["prowess"],
                        // Token's own printed art (TDM token sheet, Scryfall
                        // id 633d2d10-def7-426f-8496-ed6b45684299) — the
                        // card's own associated token, not a substitute
                        // (feedback_token_art_match_card convention).
                        imagePrintId: "633d2d10-def7-426f-8496-ed6b45684299",
                    },
                    controller: "controller",
                    bind: "$monk",
                },
                {
                    op: "mayPay",
                    player: "controller",
                    bind: "$attachIt",
                    prompt: "Attach Cori-Steel Cutter to the Monk token?",
                },
                {
                    op: "if",
                    predicate: { binding: "$attachIt" },
                    then: [{ op: "attach", target: { ref: "$monk" } }],
                },
            ],
        }),
    ],
    activatedAbilities: [
        equipAbility({
            id: "cori-steel-cutter-equip",
            cost: { generic: 1, R: 1 },
            oracleText: "Equip {1}{R}",
        }),
    ],
}));

// Tersa Lightshatter (issue #1702) — "Haste / When Tersa Lightshatter enters,
// discard up to two cards, then draw that many cards. / Whenever Tersa
// Lightshatter attacks, if there are seven or more cards in your graveyard,
// exile a card at random from your graveyard. You may play that card this
// turn."
//
//   * ETB — the "up to two" range pick, the discard of the picks, then one
//     draw per discarded card (CR 121.2: "draw N" is N draws), the shape
//     Kumiho's chapter II writes (`neo/red.cards.ts`); zero picks draws none.
//   * Attack — the graveyard count is an intervening-if (CR 603.4), checked
//     when the ability triggers (`condition`) and again as it resolves
//     (`interveningIf`).
//     The random card comes out of `selectAtRandom` (CR 609.3 — an empty pick
//     binds nothing and every later Op skips), is exiled face up
//     (CR 701.13a), and the impulse window is this turn's, lands included
//     ("play", CR 701.18a).
//
// compiler-gap: "When {self} enters, discard up to two cards, then draw that many cards." (#2693)
// compiler-gap: "Whenever {self} attacks, if there are seven or more cards in your graveyard, exile a card at random from your graveyard. You may play that card this turn." (#2693)
export const tersaLightshatter = defineCard(() => ({
    id: "99e96b34-b1c4-4647-a38e-2cf1aedaaace",
    name: "Tersa Lightshatter",
    rarity: "rare",
    oracleText:
        "Haste\nWhen Tersa Lightshatter enters, discard up to two cards, then draw that many cards.\nWhenever Tersa Lightshatter attacks, if there are seven or more cards in your graveyard, exile a card at random from your graveyard. You may play that card this turn.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Orc", "Wizard"],
    power: 3,
    toughness: 3,
    staticAbilities: ["haste"],
    triggeredAbilities: [
        enteredTrigger({
            id: "tersa-lightshatter-etb-loot",
            oracleText:
                "When Tersa Lightshatter enters, discard up to two cards, then draw that many cards.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: "controller",
                    zone: "hand",
                    count: { min: 0, max: 2 },
                    prompt: "Discard up to two cards, then draw that many.",
                    bind: "$discarded",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discarded" },
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$discarded" },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        }),
        attacksTrigger({
            id: "tersa-lightshatter-attack-impulse",
            oracleText:
                "Whenever Tersa Lightshatter attacks, if there are seven or more cards in your graveyard, exile a card at random from your graveyard. You may play that card this turn.",
            scope: "self",
            // CR 603.4 — the same count gates the trigger (`condition`) and
            // its resolution (`interveningIf`).
            condition: (_event, self, state) =>
                graveyardSize(state, self.controllerId) >= 7,
            interveningIf: (_event, self, state) =>
                graveyardSize(state, self.controllerId) >= 7,
            effects: [
                {
                    op: "selectAtRandom",
                    zone: "graveyard",
                    count: 1,
                    bind: "$exiled",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$exiled" },
                    player: "controller",
                    from: "graveyard",
                    to: "exile",
                },
                {
                    op: "grantCastFromExile",
                    card: { ref: "$exiled" },
                    player: "controller",
                    window: "this-turn",
                    includesLand: true,
                },
            ],
        }),
    ],
}));
