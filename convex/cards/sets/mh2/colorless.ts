// mh2 (Modern Horizons 2) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import { AURA_AFFECTS_HOST } from "../../types";
import type { CardDefinition, SpellContext, TokenSpec } from "../../types";
import { equipAbility, livingWeapon } from "../../abilities/equipment";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// Yavimaya, Cradle of Growth — "Each land is a Forest in addition to its
// other land types." (CR 305.7, 611 — layer 4 subtype addition.) Same
// `subtype-add` shape as Urborg, Tomb of Yawgmoth
// (`convex/cards/sets/plc/colorless.ts`) — see that card's comment for the
// full rationale. No explicit `activatedAbilities` needed: Yavimaya's own
// effect adds "Forest" to its own live `subtypes`, and the engine's
// basic-land-type mana inference grants the {T}: Add {G} ability for free.
export const yavimayaCradleOfGrowth: CardDefinition = {
    id: "4e4b6e22-93b2-4896-bba5-0ceaa5d8ea3c",
    rarity: "rare",
    name: "Yavimaya, Cradle of Growth",
    oracleText: "Each land is a Forest in addition to its other land types.",
    manaCost: {},
    supertypes: ["Legendary"],
    types: ["Land"],
    staticEffects: [
        {
            kind: "subtype-add",
            applies: (target) => target.types.includes("Land"),
            subtypes: ["Forest"],
        },
    ],
};

// ───────────────────────────────────────────────────────────────────────────
// Urza's Saga (issue #1884, parent PRD #1878, design record ADR 0078) — the
// first consumer of the Saga framework (CR 714, #1879), of indefinite
// activated-ability grants + granted mana-ability visibility (CR 611.2c /
// 605.1a, #1880) and of `EffectCardFilter.manaCostEquals` (CR 202.3b, #1881).
// ───────────────────────────────────────────────────────────────────────────

/** The Construct chapter II's granted ability makes (CR 111.1 / 707.2).
 *
 *  "This token gets +1/+1 for each artifact you control" is a
 *  characteristic-defining ability (CR 604.3) on a printed 0/0, so it is a
 *  `pt-cda` static effect whose `compute` returns the DELTA over the base
 *  P/T — the established catalogue convention (Wayfaring Giant,
 *  `sets/inv/white.ts`). The token IS an artifact, so it counts ITSELF: a lone
 *  Construct is 1/1 and never dies to the CR 704.5f zero-toughness SBA.
 *
 *  The CDA is named by KEY, not written inline: a token's definition is
 *  rebuilt from its content-derived id string on every registry miss (a cold
 *  Convex isolate, a client-side engine run), and closures cannot ride a
 *  string. Written inline the Construct decoded as a bare 0/0 and died to the
 *  SBA the moment the registry went cold. See `cards/tokenStaticEffects.ts`,
 *  which holds the factory this key resolves to.
 *
 *  `imagePrintId` is pinned by hand, not left to the `token-prints.json`
 *  lockfile: this spec is handed to `SpellContext.createToken` from a
 *  `resolve()` closure, which the DSL art guard
 *  (`cards/__tests__/tokenPrintLookup.test.ts`, issue #1305) cannot see — the
 *  documented blind spot, same as `sets/ncc/colorless.ts`. The id is the mh2
 *  Construct token print reverse-linked from Urza's Saga's own Scryfall
 *  `all_parts`, so it is this card's own printing's token. */
const URZAS_SAGA_CONSTRUCT_TOKEN: TokenSpec = {
    name: "Construct",
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 0,
    toughness: 0,
    imagePrintId: "a7caaf39-8f16-4f1d-bee6-a45674306319",
    staticEffectKeys: ["pt-cda-artifacts-you-control"],
};

/** Chapter II's granted ability body.
 *
 *  DSL-first exception (ADR 0045, `.claude/rules/gre-development.md`
 *  § DSL-first authoring) — PROTOCOL-LIKE, recorded justification: the token
 *  this creates carries a characteristic-defining P/T (`pt-cda`), which is a
 *  `compute` CLOSURE evaluated at layer-read time. The DSL's token spec
 *  (`EffectTokenSpec`) is a JSON-pure allowlist by construction (ADR 0046,
 *  enforced by `isEffectTokenSpec` in `gre/effects/validate.ts`) and therefore
 *  has no `staticEffects` slot — and cannot get one without breaking the
 *  serializability invariant the whole Effect Script grammar rests on. This is
 *  NOT the "the Op I need doesn't exist yet" case: `createToken` exists and is
 *  used everywhere; what cannot be expressed as JSON is a CDA, by definition.
 *  `TokenSpec.staticEffectKeys` + `SpellContext.createToken` is the shipped
 *  mechanism for exactly this (`ncc/colorless.ts` precedent). */
function createUrzasSagaConstruct(ctx: SpellContext): void {
    ctx.createToken(URZAS_SAGA_CONSTRUCT_TOKEN, ctx.controller, 1);
}

// Urza's Saga — `Enchantment Land — Urza's Saga`. TWO subtypes, not one:
// "Urza's" is a LAND type (CR 205.3i, alongside Mine / Power-Plant / Tower)
// and "Saga" an ENCHANTMENT type (CR 205.3h). Written as the single string
// "Urza's Saga" the card would not be a Saga at all — `isSaga` reads
// `subtypes.includes("Saga")` — so it would get no lore counter, no chapters
// and no CR 714.4 sacrifice, silently, with every server-side test still
// green (ADR 0078 §4).
//
// It is a Land, so CR 305.9 makes it uncastable — already enforced generically
// (every cast branch in `gre/rules.ts` is guarded by `!types.includes("Land")`);
// it reaches the battlefield only through the land drop.
//
// `oracleText` is VERBATIM Scryfall, stale reminder included: printed Saga
// reminder text still says "after your draw step" even on cards printed years
// after the rule became "as a player's precombat main phase begins"
// (CR 714.3c). Reminder text has no rules meaning (CR 207.2) and the engine
// follows the rule, not the reminder (ADR 0078 context §2).
export const urzasSaga: CardDefinition = {
    id: "c1e0f201-42cb-46a1-901a-65bb4fc18f6c",
    rarity: "rare",
    name: "Urza's Saga",
    oracleText:
        "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\n" +
        'I — This Saga gains "{T}: Add {C}."\n' +
        "II — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"\n" +
        "III — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.",
    manaCost: {},
    types: ["Enchantment", "Land"],
    subtypes: ["Urza's", "Saga"],
    // The two abilities chapters I and II GRANT to the Saga itself. They live
    // on `grantTemplates[]`, not `activatedAbilities[]`, so the Saga does not
    // expose them natively — a chapter's `grantAbility` Op names one by id and
    // `grantActivatedAbilityPermanent` attaches it to the target permanent.
    grantTemplates: [
        {
            // Chapter I's grant. A MANA ability (CR 605.1a): `useStack: false`,
            // so it resolves immediately and never uses the stack (CR 605.3a).
            // `manaProduced` is what the unified mana-tap options list
            // (`getManaTapOptionsDetailed`) reads for a tap mana ability — and
            // since #1880 that list walks the POST-LAYER effective ability set,
            // so this GRANTED ability is a real tap option for the auto-tap
            // solver and the castability probe, not just a client menu entry.
            id: "urzas-saga-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => {
                ctx.addMana({ C: 1 });
            },
            manaProduced: { C: 1 },
        },
        {
            // Chapter II's grant. Uses the stack (CR 602.2) — an ordinary
            // activated ability, not a mana ability.
            id: "urzas-saga-construct",
            oracleText:
                '{2}, {T}: Create a 0/0 colorless Construct artifact creature token with "This token gets +1/+1 for each artifact you control."',
            cost: { tap: true, mana: { X: 2 } },
            useStack: true,
            resolve: createUrzasSagaConstruct,
        },
    ],
    chapterAbilities: [
        {
            chapters: [1],
            oracleText: 'I — This Saga gains "{T}: Add {C}."',
            // CR 611.2c — the grant is generated by a RESOLVING ability and
            // has no duration clause, so it lasts indefinitely: `duration` is
            // OMITTED, which routes `grantAbility` to
            // `grantActivatedAbilityPermanent` (issue #1880). A duration here
            // would silently expire the Saga's only mana source at end of turn.
            effects: [
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    grantedActivatedId: "urzas-saga-mana",
                },
            ],
        },
        {
            chapters: [2],
            oracleText:
                "II — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"",
            effects: [
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    grantedActivatedId: "urzas-saga-construct",
                },
            ],
        },
        {
            chapters: [3],
            oracleText:
                "III — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.",
            // "with MANA COST {0} or {1}" is CR 202.3b's printed cost, NOT mana
            // value: `manaValueAtMost: 1` would wrongly admit every {X}-cost
            // artifact (Chalice of the Void, Engineered Explosives) and every
            // coloured mana-value-1 one. `manaCostEquals` (issue #1881) is the
            // exact structural match; its array form is OR. `{}` is the real
            // encoding of the printed cost {0} (Ornithopter writes exactly
            // that) and `{ X: 1 }` is the printed cost {1} — a numeric `X` is
            // the fixed generic slot, not a variable {X} marker (which is
            // `X: "X"`). Artifact LANDS are excluded for free:
            // `manaCostForCardFilter` returns `undefined` for a Land (no
            // printed land has a mana cost, CR 202.1) and the filter fails
            // CLOSED on it — which is the real ruling.
            //
            // No `sacrifice` Op: chapter III does NOT sacrifice the Saga.
            // CR 714.4's state-based action does, once the chapter has LEFT
            // the stack (`checkSagaSacrificeSBA`, `gre/sba.ts`).
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        type: "Artifact",
                        manaCostEquals: [{}, { X: 1 }],
                    },
                    count: 1,
                    prompt: "Search your library for an artifact card with mana cost {0} or {1}.",
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
        },
    ],
};

// Kaldra Compleat (issue #1340, parent PRD #620; closes the #679 Living
// Weapon stub) — Living weapon on the biggest possible statline.
//
//  - Living weapon (CR 702.92a) — the shared `livingWeapon()` self-ETB
//    trigger (createToken Germ + `attach`, ADR 0065). The Germ arrives as a
//    0/0 and is immediately a 5/5 indestructible first-striker, which is the
//    whole point of the card.
//  - "Indestructible" on the line by itself is the EQUIPMENT's own printed
//    keyword (CR 702.12), not a grant — hence `staticAbilities`, separate
//    from the `keyword-grant` that hands indestructible to the host.
//  - The quoted ability inside the grant clause is a granted TRIGGERED
//    ability (CR 702.6d / 611): it lives on `triggeredGrantTemplates[]` and
//    is pushed onto the host by a `triggered-grant` static, the Lavaspur
//    Boots / Energy Flux convention. Kept OFF `triggeredAbilities` so Kaldra
//    Compleat itself (never a creature, never a combat-damage source) can't
//    fire its own copy. Inside the template `self` is the RECIPIENT — the
//    equipped creature — so `source: "self"` in the factory means "the
//    equipped creature dealt the damage", and `$event.damagedPermanent`
//    (ADR 0049) names the creature it damaged. Same shape as Voracious
//    Cobra's destroy trigger (`inv/multicolor.ts`), with `exile` instead.
export const kaldraCompleat: CardDefinition = {
    id: "87cc2855-6b14-44dd-a398-7dc2bbae081f",
    name: "Kaldra Compleat",
    rarity: "mythic",
    oracleText:
        'Living weapon\nIndestructible\nEquipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."\nEquip {7}',
    manaCost: { generic: 7 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    subtypes: ["Equipment"],
    staticAbilities: ["indestructible"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 5,
            toughness: 5,
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "first strike",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "trample",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "indestructible",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "haste",
        },
        {
            kind: "triggered-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "kaldra-compleat-granted-exile",
        },
    ],
    triggeredGrantTemplates: [
        damageDealtTrigger({
            id: "kaldra-compleat-granted-exile",
            oracleText:
                "Whenever this creature deals combat damage to a creature, exile that creature.",
            // `self` here is the permanent CARRYING the granted ability (the
            // equipped creature) — the damage source the Oracle text means.
            source: "self",
            // CR 510 — combat damage only, and only damage dealt to a
            // creature (a planeswalker/battle/player hit does not qualify).
            isCombat: true,
            target: { kind: "permanent", filter: { types: "Creature" } },
            effects: [
                { op: "exile", target: { ref: "$event.damagedPermanent" } },
            ],
        }),
    ],
    triggeredAbilities: [livingWeapon({ id: "kaldra-compleat-living-weapon" })],
    activatedAbilities: [
        equipAbility({
            id: "kaldra-compleat-equip",
            cost: { generic: 7 },
            oracleText: "Equip {7}",
        }),
    ],
};

// Nettlecyst (issue #1340, parent PRD #620) — Living weapon with a
// board-scaling buff. The buff is a characteristic-defining `pt-cda`
// (CR 604.3) rather than a flat `pt-buff`: "+1/+1 for each artifact and/or
// enchantment YOU control" is re-read at stat-read time, and "you" is the
// EQUIPMENT's controller (CR 109.5), not the equipped creature's — the two
// differ once a control-change effect steals the host (the Equipment stays
// attached, CR 301.5c). Nettlecyst counts ITSELF (it is an artifact you
// control), so a lone Nettlecyst on an otherwise empty board makes its Germ
// a 1/1 — CR 604.3's "each" is a live board count with no self-exclusion.
export const nettlecyst: CardDefinition = {
    id: "4a0bb5dc-75a6-4bd6-81f8-611197fb0fba",
    name: "Nettlecyst",
    rarity: "rare",
    oracleText:
        "Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)\nEquipped creature gets +1/+1 for each artifact and/or enchantment you control.\nEquip {2}",
    manaCost: { generic: 3 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (source, state) => {
                const n = state.players
                    .flatMap((pl) => pl.battlefield)
                    .filter(
                        (c) =>
                            c.controllerId === source.controllerId &&
                            (c.types.includes("Artifact") ||
                                c.types.includes("Enchantment"))
                    ).length;
                return { power: n, toughness: n };
            },
        },
    ],
    triggeredAbilities: [livingWeapon({ id: "nettlecyst-living-weapon" })],
    activatedAbilities: [
        equipAbility({
            id: "nettlecyst-equip",
            cost: { generic: 2 },
            oracleText: "Equip {2}",
        }),
    ],
};
