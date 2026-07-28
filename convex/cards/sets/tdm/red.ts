// TDM — red cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm"` resolves through tdm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import {
    nthSpellThisTurn,
    spellCastTrigger,
} from "../../abilities/triggers/spellCastTrigger";
import { equipAbility } from "../../abilities/equipment";

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
// per-player spell-count plumbing Ledger Shredder (snc/blue.ts) already
// exercises for connive's "a player casts their second spell" (that one uses
// `scope: "any"`; Cori-Steel Cutter's own controller only, hence "you").
//
// The token engine (Prowess, #699) rides `getDefinition`'s
// `expandKeywordTriggers` seam unmodified: a token's synthesized def is
// registered via `registerTokenDefinition` and read back through the same
// `getDefinition`/`tryGetDefinition` call every printed card uses, so
// `staticAbilities: ["prowess"]` on the token spec expands into the CR
// 702.108a trigger exactly as it would on a printed creature — no new
// plumbing, no token-specific prowess path (cards/index.ts `expandDefinition`
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
// accepts (Reconfigure, neo/white.ts). Generalizing `createToken` with the
// identical `bind` field (issue #1202, `cards/types.ts` +
// `gre/effects/interpreter.ts` + `gre/effects/validate.ts`) is a "generalize,
// don't add" primitive-reuse move, not a new Op — it required no new grammar,
// no new validator family, and no new binding kind (`bindingKindOf`'s
// existing default "snapshot" case already covers it). The "you MAY attach"
// half reuses the pre-existing cost-free `mayPay` Op (issue #680 — "a bare
// optional action with no payment", the exact shape `drk/white.ts`'s Fasting
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
export const coriSteelCutter: CardDefinition = {
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
};

// TODO(issue #679 stub — Tersa Lightshatter's attack trigger needs to
// "exile a card AT RANDOM from your graveyard": SpellContext has no
// random-pick-from-a-zone primitive (only `discardAtRandom`, which is
// hand-scoped and discards rather than exiles). Composing it would require a
// new primitive, not a reuse of an existing one (gre-development.md
// Primitive reuse checklist) — flagged rather than invented. Stop-and-issue;
// tracked stub.
// export const tersaLightshatter: CardDefinition = {
//     id: "99e96b34-b1c4-4647-a38e-2cf1aedaaace",
//     name: "Tersa Lightshatter",
//     rarity: "rare",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Orc", "Wizard"],
//     power: 3,
//     toughness: 3,
// };
