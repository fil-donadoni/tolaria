// Shared predefined token specs (CR 111 / 707.2). A canonical `TokenSpec` for a
// named token that multiple cards create, so its characteristics — including a
// token-scoped activated ability (issue #778) — live in ONE place and every
// producer creates the identical token (one synthesized definition, shared art).

import type {
    ActivatedAbilityContext,
    EffectTokenSpec,
    TokenSpec,
} from "./types";

/** Treasure token (issue #778 / #1265). "Artifact — Treasure" with "{T},
 *  Sacrifice this artifact: Add one mana of any color." (CR 707.2.)
 *
 *  The mana ability is the Black Lotus shape (`sets/lea/colorless.ts`): a
 *  `useStack: false` mana ability (CR 605.1a) whose `cost: { tap: true,
 *  sacrifice: true }` taps AND sacrifices the source, with `manaChoices`
 *  offering one mana of each of the five colors — the color is chosen at
 *  activation and applied by the engine (the `effect` body is the default
 *  first option). Carried on `TokenSpec.activatedAbilities`, registered onto
 *  the synthesized token definition by `createTokenPermanents`
 *  (`gre/state.ts`). Created today by Hullbreacher's draw-replacement redirect;
 *  reusable by any future Treasure producer (Magda, khm). */
export const TREASURE_TOKEN: TokenSpec = {
    name: "Treasure",
    types: ["Artifact"],
    subtypes: ["Treasure"],
    activatedAbilities: [
        {
            id: "treasure-token-mana",
            oracleText:
                "{T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
    // Real printed Treasure token art (tcmr, Commander Legends tokens).
    imagePrintId: "284ec798-2725-4741-8748-578c259d0623",
};

/** Eldrazi Spawn token (CR 707.2, issue #1531). "0/1 colorless Eldrazi Spawn
 *  creature token with 'Sacrifice this token: Add {C}.'" — a mana ability
 *  shaped like `TREASURE_TOKEN`'s (`cost.sacrifice`, `useStack: false`, CR
 *  605.3a), minus the tap leg and the color choice (a single fixed colorless
 *  mana). Typed `EffectTokenSpec` (JSON-pure, ADR 0046) rather than
 *  `TokenSpec` — its only consumer is Malevolent Rumble's DSL `createToken`
 *  Op (`sets/mh3/green.ts`), so the ability body is `effects: [{ op:
 *  "addMana" }]`, not an imperative closure. Any future Eldrazi Spawn
 *  producer shares this one spec/definition. */
export const ELDRAZI_SPAWN_TOKEN: EffectTokenSpec = {
    name: "Eldrazi Spawn",
    types: ["Creature"],
    subtypes: ["Eldrazi", "Spawn"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "eldrazi-spawn-sacrifice-mana",
            oracleText: "Sacrifice this token: Add {C}.",
            cost: { sacrifice: true },
            useStack: false,
            effects: [{ op: "addMana", mana: { C: 1 } }],
        },
    ],
    // Real printed Eldrazi Spawn token art (Malevolent Rumble's own MH3
    // printing's `all_parts` token link).
    imagePrintId: "e32795e1-5548-43ef-8cd6-c605a19ef708",
};

/** Phyrexian Germ token (CR 707.2, issue #1340) — the "0/0 black Phyrexian
 *  Germ creature token" every Living Weapon Equipment creates (CR 702.92a:
 *  Batterskull, Kaldra Compleat, Nettlecyst, …). Vanilla: no abilities, no
 *  counters; the Equipment attached to it is the only thing keeping it above
 *  0 toughness (CR 704.5f — once the Equipment detaches, the unbuffed 0/0
 *  Germ dies).
 *
 *  Deliberately carries NO `imagePrintId`, unlike the Treasure / Eldrazi Spawn
 *  specs above: every Living Weapon card has its OWN printed Germ token, so
 *  pinning one id here would stamp (say) Batterskull's NPH Germ onto Kaldra
 *  Compleat. `SpellContext.createToken` auto-resolves the art per PRODUCING
 *  card from `generated/token-prints.json` keyed by (card id, "Phyrexian
 *  Germ") — the token/emblem art-match rule. A new Living Weapon card must
 *  therefore refresh the lockfile (`node scripts/fetch-token-prints.mjs
 *  <its set file>`) or `tokenPrintLookup.test.ts` fails CI. */
export const PHYREXIAN_GERM_TOKEN: EffectTokenSpec = {
    name: "Phyrexian Germ",
    types: ["Creature"],
    subtypes: ["Phyrexian", "Germ"],
    power: 0,
    toughness: 0,
    colors: ["B"],
};
