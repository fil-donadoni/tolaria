// mh2 (Modern Horizons 2) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition, SpellContext, TokenSpec } from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";

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
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let artifacts = 0;
                for (const player of state.players) {
                    for (const permanent of player.battlefield) {
                        if (permanent.controllerId !== source.controllerId) {
                            continue;
                        }
                        if (permanent.types.includes("Artifact")) artifacts++;
                    }
                }
                return { power: artifacts, toughness: artifacts };
            },
        },
    ],
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
 *  `TokenSpec.staticEffects` + `SpellContext.createToken` is the shipped
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

// TODO(issue #679 stub — Kaldra Compleat needs Living Weapon (CR 702.92):
// mechanicsRegistry.ts lists it `status: "planned"` — no keyword name and no
// "create a token then attach this Equipment to it as it enters" ETB
// primitive exist yet. Stop-and-issue per gre-development.md; tracked stub.
// export const kaldraCompleat: CardDefinition = {
//     id: "87cc2855-6b14-44dd-a398-7dc2bbae081f",
//     name: "Kaldra Compleat",
//     rarity: "mythic",
//     manaCost: { X: 7 },
//     types: ["Artifact"],
//     supertypes: ["Legendary"],
//     subtypes: ["Equipment"],
// };
