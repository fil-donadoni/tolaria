// Invasion (INV) — blue cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
//
// This module carries the free tranche (issue #1070, parent PRD #1063): every
// mono-blue non-land INV card expressible with already-shipped Ops/keywords.
// Collective Restraint and Worldly Counsel shipped as active defs with the
// Domain capability cluster (#1066, below). Fact or Fiction is OWNED BY the
// pile-division cluster (#1067) and stays a commented stub — not duplicated
// as an active def. A further
// 18 cards hit genuine engine/DSL capability gaps discovered while authoring
// this tranche (colour-change Op, colour-census in a one-shot Effect Script,
// targeted land-subtype change, text-change, X-multi-target Ops, a dynamic
// mayPay cost, a permanent kicked-ETB ability grant, an exact mana-value hand
// filter, a flash-for-more alternative cost + tap/untap toggle, countering an
// ability, an hourglass-counter untap lock, a reveal-and-compare retarget
// protocol, a per-permanent colour field on ReplacementStateView, and
// creature-type protection) — each is a stop-and-issue case (not an invented
// Op, not a `resolve()` paper-over) tracked by #1083.
import type {
    CardDefinition,
    PermanentView,
    StaticEffectContext,
} from "../../types";
import {
    AURA_AFFECTS_HOST,
    BASIC_LAND_SUBTYPES,
    countDomain,
    EFFECT_AFFECTS_SELF,
} from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Opt — {U} Instant. "Scry 1. Draw a card." (Modern Scryfall oracle text —
// the printed Invasion text differs, ADR 0004.) Authored DSL-first as an
// Effect Script (ADR 0045, issue #885/#1002) reusing already-shipped Ops: the
// `scryReorder` Op is the declarative skin over `SpellContext.orderTop` — Scry
// 1 (CR 701.22) with `destination: "library-bottom"` raises the `order-top`
// choice on the top card (projected face-up as `libraryPeek`), then on submit
// keeps it on top or sends it to the true bottom of the library. Then the draw
// (CR 121.1). scry resolves first, then draw.
export const opt: CardDefinition = {
    id: "958262ec-8e52-40cf-a9fd-a60e42643e15",
    name: "Opt",
    rarity: "common",
    oracleText:
        "Scry 1. (Look at the top card of your library. You may put that card on the bottom.)\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "scryReorder",
            player: "controller",
            count: 1,
            destination: "library-bottom",
            prompt: "Scry 1 — keep the card on top or send it to the bottom.",
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Disrupt — {U} Instant. "Counter target instant or sorcery spell unless its
// controller pays {1}. Draw a card." (CR 701.5a counter/punisher pattern +
// CR 121.1 draw.) `mayPay` + `if` on the outcome is the shipped punisher
// template (leg/blue.ts Force Spike / fem/blue.ts Vodalian Mage).
export const disrupt: CardDefinition = {
    id: "c000a02f-6b7e-4925-a938-59e645e980d7",
    name: "Disrupt",
    rarity: "uncommon",
    oracleText:
        "Counter target instant or sorcery spell unless its controller pays {1}.\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: ["Instant", "Sorcery"],
    },
    effects: [
        {
            op: "mayPay",
            player: { controllerOf: { target: 0 } },
            cost: { X: 1 },
            prompt: "Pay {1} or your spell is countered (Disrupt)?",
            bind: "$paid",
        },
        {
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Empress Galina — {3}{U}{U} Legendary Creature — Merfolk Noble, 1/3.
// "{U}{U}, {T}: Gain control of target legendary permanent. (This effect
// lasts indefinitely.)" (CR 613.1b layer-2 control change, no reverting
// condition.) The `gainControl` Op with `duration` omitted is exactly the
// indefinite reassignment (issue #848); `supertypeFilter: ["Legendary"]`
// restricts the target set (CR 205.4a).
export const empressGalina: CardDefinition = {
    id: "6851dbc7-f072-41e7-a899-897445d99425",
    name: "Empress Galina",
    rarity: "rare",
    oracleText:
        "{U}{U}, {T}: Gain control of target legendary permanent. (This effect lasts indefinitely.)",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Noble"],
    supertypes: ["Legendary"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "empress-galina-steal-legendary",
            oracleText:
                "{U}{U}, {T}: Gain control of target legendary permanent. (This effect lasts indefinitely.)",
            cost: { mana: { U: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "any",
                count: 1,
                supertypeFilter: ["Legendary"],
            },
            effects: [
                {
                    op: "gainControl",
                    target: { target: 0 },
                    controller: "controller",
                },
            ],
        },
    ],
};

// Exclude — {2}{U} Instant. "Counter target creature spell. Draw a card."
// (CR 701.5a + CR 121.1, the shipped creature-counter template — leg/blue.ts
// Dissipate-style precedent.)
export const exclude: CardDefinition = {
    id: "aeb359c8-209c-455f-84b2-970e5678a9fa",
    name: "Exclude",
    rarity: "common",
    oracleText: "Counter target creature spell.\nDraw a card.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1, spellTypeFilter: "Creature" },
    effects: [
        { op: "counter", target: { target: 0 } },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Manipulate Fate — {1}{U} Sorcery. "Search your library for three cards,
// exile them, then shuffle. Draw a card." (CR 701.23 search + CR 701.13 exile
// + CR 701.24 shuffle + CR 121.1 draw.) Composition mirrors the shipped
// search→exile/hand→shuffle tutor template (bbd/blue.ts Spellseeker): a plain
// `choice(kind:"search-library")` with no filter (any three cards) feeds
// `moveZone`'s cards-form into exile, then `libraryLook` shuffles.
export const manipulateFate: CardDefinition = {
    id: "5bb52acb-dedb-4ed6-a6da-8c036f2b2958",
    name: "Manipulate Fate",
    rarity: "uncommon",
    oracleText:
        "Search your library for three cards, exile them, then shuffle.\nDraw a card.",
    manaCost: { X: 1, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: 3,
            prompt: "Search your library for three cards.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "exile",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Prohibit — {1}{U} Instant. Kicker {2}. "Counter target spell if its mana
// value is 2 or less. If this spell was kicked, counter that spell if its
// mana value is 4 or less instead." (CR 702.33 Kicker.) The kick WIDENS the
// mana-value ceiling, so — exactly like Bloodchief's Thirst (znr/black.ts) —
// the kicked/unkicked split is expressed via `kickedTargetRequirement`
// (announcement swaps in the wider mv ceiling), not a runtime `if`: no
// runtime branch needed, `effects` is a plain counter.
export const prohibit: CardDefinition = {
    id: "0daa5458-2a97-40d0-b18d-2381a7a68ee1",
    name: "Prohibit",
    rarity: "common",
    oracleText:
        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nCounter target spell if its mana value is 2 or less. If this spell was kicked, counter that spell if its mana value is 4 or less instead.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 2 } },
    targetRequirement: { type: "spell", count: 1, mvFilter: { max: 2 } },
    kickedTargetRequirement: {
        type: "spell",
        count: 1,
        mvFilter: { max: 4 },
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Repulse — {2}{U} Instant. "Return target creature to its owner's hand.
// Draw a card." (CR 400.7 zone move + CR 121.1 draw — the shipped
// bounce-and-draw template.)
export const repulse: CardDefinition = {
    id: "9a04e9be-48be-440e-9825-cfffd4c2b1a4",
    name: "Repulse",
    rarity: "common",
    oracleText: "Return target creature to its owner's hand.\nDraw a card.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        { op: "moveZone", target: { target: 0 }, to: "hand" },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Sapphire Leech — {1}{U} Creature — Leech, 2/2. "Flying. Blue spells you
// cast cost {U} more to cast." (CR 702.9 flying + CR 601.2f cost increase.)
// `cost-modifier` static, the exact Derelor template (fem/black.ts: "Black
// spells you cast cost {B} more to cast") with the colour swapped to blue.
export const sapphireLeech: CardDefinition = {
    id: "e6763ffd-9d89-4f26-871a-be24fbdef38d",
    name: "Sapphire Leech",
    rarity: "rare",
    oracleText: "Flying\nBlue spells you cast cost {U} more to cast.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Leech"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                ctx.getColors(card).includes("U") &&
                effectSource !== undefined &&
                card.controllerId === effectSource.controllerId,
            costIncrease: { U: 1 },
        },
    ],
};

// Shimmering Wings — {U} Enchantment — Aura, enchant creature. "Enchanted
// creature has flying. {U}: Return this Aura to its owner's hand." (CR 702.9
// continuous keyword grant via `keyword-grant` + `AURA_AFFECTS_HOST`, and the
// shipped self-bounce activated-ability template — ice/black.ts Leshrac's
// Sigil: "{cost}: Return this enchantment to its owner's hand".)
export const shimmeringWings: CardDefinition = {
    id: "9615a6c2-1732-4a04-9be1-cc0a8d39de3f",
    name: "Shimmering Wings",
    rarity: "common",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nEnchanted creature has flying. (It can't be blocked except by creatures with flying or reach.)\n{U}: Return this Aura to its owner's hand.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
    activatedAbilities: [
        {
            id: "shimmering-wings-return",
            oracleText: "{U}: Return this Aura to its owner's hand.",
            cost: { mana: { U: 1 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};

// Sky Weaver — {1}{U} Creature — Metathran Wizard, 2/1. "{2}: Target white or
// black creature gains flying until end of turn." (CR 611.1b/613.1f layer-6
// duration grant + CR 202.2 OR colour filter — `colorFilterAny`.)
export const skyWeaver: CardDefinition = {
    id: "04974146-42a8-4f10-b443-67bfeaa54d5d",
    name: "Sky Weaver",
    rarity: "uncommon",
    oracleText:
        "{2}: Target white or black creature gains flying until end of turn. (It can't be blocked except by creatures with flying or reach.)",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Metathran", "Wizard"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "sky-weaver-grant-flying",
            oracleText:
                "{2}: Target white or black creature gains flying until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["W", "B"],
            },
            effects: [
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Vodalian Merchant — {1}{U} Creature — Merfolk, 1/2. "When this creature
// enters, draw a card, then discard a card." (CR 603.6a ETB + CR 121.1 draw +
// CR 701.9 discard — the shipped looter template, atq/colorless.ts Jalum
// Tome: draw, then a `choose-hand-card` pick, then discard the pick.)
export const vodalianMerchant: CardDefinition = {
    id: "c1c0effa-a4b8-4166-a66a-90cf01c6ea0d",
    name: "Vodalian Merchant",
    rarity: "common",
    oracleText: "When this creature enters, draw a card, then discard a card.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "vodalian-merchant-loot",
            oracleText:
                "When this creature enters, draw a card, then discard a card.",
            scope: "self",
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        }),
    ],
};

// Vodalian Serpent — {3}{U} Creature — Serpent, 2/2. Kicker {2}. "This
// creature can't attack unless defending player controls an Island. If this
// creature was kicked, it enters with four +1/+1 counters on it." (CR 508.1c
// attack restriction — the shipped Sea Serpent `attack-restriction` template,
// lea/blue.ts — + CR 702.33 Kicker: an ETB `if(kickerCount>0)` adds the
// counters, CR 122.1.)
export const vodalianSerpent: CardDefinition = {
    id: "92adcf6c-ab14-414c-a5cb-56feae048c84",
    name: "Vodalian Serpent",
    rarity: "common",
    oracleText:
        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nThis creature can't attack unless defending player controls an Island.\nIf this creature was kicked, it enters with four +1/+1 counters on it.",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Serpent"],
    power: 2,
    toughness: 2,
    kicker: { cost: { X: 2 } },
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "vodalian-serpent-island-restriction",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
            oracleText:
                "Vodalian Serpent can't attack unless defending player controls an Island.",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "vodalian-serpent-kicked-counters",
            oracleText:
                "If this creature was kicked, it enters with four +1/+1 counters on it.",
            scope: "self",
            effects: [
                {
                    op: "if",
                    // `EffectValue` literals are positive integers only
                    // (0 is not a valid literal); kickerCount is 0 or 1 for
                    // Vodalian Serpent's single (non-multi) Kicker, so
                    // `>= 1` is equivalent to "was kicked" (`> 0`).
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 4,
                        },
                    ],
                },
            ],
        }),
    ],
};

// Wash Out — {3}{U} Sorcery. "Return all permanents of the color of your
// choice to their owners' hands." (CR 700.2 modal colour pick + CR 400.7 mass
// bounce.) Modelled as a 5-mode `optionChoice` (one mode per WUBRG colour,
// each a STATIC `forEach` over that colour's permanents + `moveZone`) rather
// than a runtime colour-filtered `forEach` — the frozen `forEach` selector
// filter is declared per mode, so no dynamic colour ref is needed.
const WASH_OUT_COLORS = ["W", "U", "B", "R", "G"] as const;
const WASH_OUT_COLOR_NAMES: Record<(typeof WASH_OUT_COLORS)[number], string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};
export const washOut: CardDefinition = {
    id: "7719d043-5827-4479-825b-23d9e979ead7",
    name: "Wash Out",
    rarity: "uncommon",
    oracleText:
        "Return all permanents of the color of your choice to their owners' hands.",
    manaCost: { X: 3, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "optionChoice",
            player: "controller",
            prompt: "Choose a color — return all permanents of that color to their owners' hands.",
            modes: WASH_OUT_COLORS.map((color) => ({
                id: color,
                label: WASH_OUT_COLOR_NAMES[color],
                effects: [
                    {
                        op: "forEach",
                        select: {
                            set: "permanents",
                            zone: "battlefield",
                            filter: { color },
                        },
                        effects: [
                            {
                                op: "moveZone",
                                target: { ref: "$each" },
                                to: "hand",
                            },
                        ],
                    },
                ],
            })),
        },
    ],
};

// Zanam Djinn — {5}{U} Creature — Djinn, 5/6. "Flying. This creature gets
// -2/-2 as long as blue is the most common color among all permanents or is
// tied for most common." (CR 702.9 flying + CR 611.2c conditional CDA anthem
// on itself.) `StaticPTBuff.condition` reads the full board via
// `StaticEffectContext.getColors` — the shipped colour-census template
// (ice/white.ts Call to Arms), generalized to "most common OR TIED" (no
// strict-plurality requirement) and scoped to ALL permanents (not one
// player's), matching Zanam Djinn's own printed clause.
const ZANAM_DJINN_COLORS = ["W", "U", "B", "R", "G"] as const;
function blueIsMostCommonOrTied(
    battlefields: ReadonlyArray<{ colors: readonly string[] }>
): boolean {
    const tally: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const permanent of battlefields) {
        for (const color of permanent.colors) {
            if (color in tally) tally[color]++;
        }
    }
    const blue = tally.U;
    return ZANAM_DJINN_COLORS.every((c) => tally[c] <= blue);
}
export const zanamDjinn: CardDefinition = {
    id: "57a3c1d5-0ca8-443b-ae7a-66e0363e377b",
    name: "Zanam Djinn",
    rarity: "uncommon",
    oracleText:
        "Flying\nThis creature gets -2/-2 as long as blue is the most common color among all permanents or is tied for most common.",
    manaCost: { X: 5, U: 1 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 6,
    staticAbilities: ["flying"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: EFFECT_AFFECTS_SELF,
            condition: (_source, state, ctx) =>
                blueIsMostCommonOrTied(
                    state.players
                        .flatMap((p) => p.battlefield)
                        .map((c) => ({ colors: ctx.getColors(c) }))
                ),
            power: -2,
            toughness: -2,
        },
    ],
};

// Traveler's Cloak — {2}{U} Enchantment — Aura, enchant creature. "As this
// Aura enters, choose a land type. When this Aura enters, draw a card.
// Enchanted creature has landwalk of the chosen type." (CR 603.6b on-entry
// choice + CR 603.6a ETB draw + CR 702.14 landwalk continuous grant.) The
// land-type pick reuses the SAME sanctioned choice-storage protocol as
// Phantasmal Terrain (lea/blue.ts) / Illusionary Terrain (`setChosenSubtypes`,
// ADR 0050); the
// draw is a plain DSL `enteredTrigger`; the landwalk grant is FIVE
// `keyword-grant` statics (one per basic land type), each gated on both
// `AURA_AFFECTS_HOST` and the stored chosen type — since `keyword-grant`'s
// `keyword` field is a fixed string, a per-type grant is required (no
// computed-keyword form exists), mirroring how Illusionary Terrain's
// `subtype-set` needed a computed `subtypesFor` for its OWN mechanic.
const LANDWALK_BY_TYPE: Record<string, string> = {
    Plains: "plainswalk",
    Island: "islandwalk",
    Swamp: "swampwalk",
    Mountain: "mountainwalk",
    Forest: "forestwalk",
};
export const travelersCloak: CardDefinition = {
    id: "977f0f82-0542-40c9-9a48-73077941dbd1",
    name: "Traveler's Cloak",
    rarity: "common",
    oracleText:
        "Enchant creature\nAs this Aura enters, choose a land type.\nWhen this Aura enters, draw a card.\nEnchanted creature has landwalk of the chosen type. (It can't be blocked as long as defending player controls a land of that type.)",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: BASIC_LAND_SUBTYPES.map((landType) => ({
        kind: "keyword-grant" as const,
        applies: (
            target: PermanentView,
            source: PermanentView,
            ctx: StaticEffectContext
        ) =>
            AURA_AFFECTS_HOST(target, source, ctx) &&
            source.chosenSubtypes?.[0] === landType,
        keyword: LANDWALK_BY_TYPE[landType],
    })),
    triggeredAbilities: [
        enteredTrigger({
            id: "travelers-cloak-choose-type",
            oracleText: "As this Aura enters, choose a land type.",
            scope: "self",
            // protocol: on-entry choice storage (CR 603.6b), same sanctioned
            // class as Illusionary Terrain (ice/blue.ts) / Phantasmal Terrain
            // (lea/blue.ts).
            resolve: (ctx) => {
                const options = BASIC_LAND_SUBTYPES.map((s) => ({
                    id: s,
                    label: s,
                }));
                const chosen = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "travelers-cloak-type",
                    options,
                    prompt: "Choose a land type.",
                });
                if (chosen === undefined) return;
                ctx.setChosenSubtypes([chosen]);
            },
        }),
        enteredTrigger({
            id: "travelers-cloak-draw",
            oracleText: "When this Aura enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Collective Restraint — {3}{U} Enchantment. "Domain — Creatures can't
// attack you unless their controller pays {X} for each creature they
// control that's attacking you, where X is the number of basic land types
// among lands you control." (CR 508.1c/1g attack mana tax, CR 702 preamble
// Domain ability word, issue #1066.) The Domain-scaled `{X}` is the
// generalized `StaticAttackManaTax.costPerAttacker` function form (issue
// #1066 — "generalize, don't special-case"): evaluated once per source at
// combat time (`collectAttackManaTax`, `gre/combat.ts`), reading THIS
// enchantment's controller's Domain via the shared `countDomain` helper —
// the SAME scan the Domain-scaled `pt-cda` statics use. Untaxed by color/type
// (unlike Elephant Grass's nonblack clause, `vis/green.ts`) — every attacking
// creature is taxed, so `taxes` only confirms the attacker is a creature
// (defensive; only creatures can attack, CR 506.2).
export const collectiveRestraint: CardDefinition = {
    id: "d71daa57-ac02-4dd9-8c90-d38bdd45fb51",
    name: "Collective Restraint",
    rarity: "rare",
    oracleText:
        "Domain — Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.",
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "attack-mana-tax",
            id: "collective-restraint-domain-tax",
            taxes: (attacker: PermanentView, _source, _state, ctx) =>
                ctx.isCreature(attacker),
            costPerAttacker: (source, state) => ({
                X: countDomain(state, source.controllerId),
            }),
            oracleText:
                "Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.",
        },
    ],
};

// Worldly Counsel — {1}{U} Instant. "Domain — Look at the top X cards of
// your library, where X is the number of basic land types among lands you
// control. Put one of those cards into your hand and the rest on the bottom
// of your library in any order." (CR 401.4 look, CR 702 preamble Domain
// ability word, issue #1066.) DSL-first: the `digToHand` Op (issue #984)
// already composes "look at top N, keep one, bottom the rest in look order"
// — `look` is the ninth EffectValue grammar member `{ domain: { of } }`
// (issue #1066) instead of a literal/`{X}`; `take` defaults to 1.
export const worldlyCounsel: CardDefinition = {
    id: "8fc66fbf-f411-4607-aece-7c35d9a07c80",
    name: "Worldly Counsel",
    rarity: "common",
    oracleText:
        "Domain — Look at the top X cards of your library, where X is the number of basic land types among lands you control. Put one of those cards into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "digToHand",
            player: "controller",
            look: { domain: { of: "controller" } },
        },
    ],
};

// Fact or Fiction — {3}{U} Instant. "Reveal the top five cards of your
// library. An opponent separates those cards into two piles. Put one pile
// into your hand and the other into your graveyard." (CR 701.16 reveal,
// ADR 0053 pile division, issue #1067.) The marquee pile-division card: the
// object set is a PUBLIC reveal of the caster's own top 5 library cards
// (`{ set: "library-top" }`, which marks them known to all — the opponent's
// client must see them to divide them, and both players see the outcome).
// Divider = an opponent; chooser = the caster (`controller`). `moveZone`'s
// bare-picks-`cards` shape moves each WHOLE pile in one Op — no `forEach`
// wrapper needed, since a plain zone move (not a per-object action) is the
// outcome.
export const factOrFiction: CardDefinition = {
    id: "7fd4d018-dcf3-4439-8445-02d66e44f7d3",
    name: "Fact or Fiction",
    rarity: "uncommon",
    oracleText:
        "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.",
    manaCost: { X: 3, U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "divideIntoPiles",
            objects: { set: "library-top", player: "controller", count: 5 },
            divider: "opponent",
            chooser: "controller",
            dividePrompt:
                "Fact or Fiction — separate the revealed cards into two piles.",
            pickPrompt:
                "Choose a pile: it goes to your hand, the other to your graveyard.",
            chosenBind: "$factOrFictionChosen",
            otherBind: "$factOrFictionOther",
            chosenEffect: [
                {
                    op: "moveZone",
                    cards: { ref: "$factOrFictionChosen" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
            ],
            otherEffect: [
                {
                    op: "moveZone",
                    cards: { ref: "$factOrFictionOther" },
                    player: "controller",
                    from: "library",
                    to: "graveyard",
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Capability-gap stubs — genuine engine/DSL gaps discovered authoring this
// tranche (issue #1083). Not an invented Op, not a resolve() paper-over.
// ─────────────────────────────────────────────────────────────────────────

// Barrin's Unmaking — "Return target permanent to its owner's hand if that
// permanent shares a color with the most common color among all permanents
// or a color tied for most common." A ONE-SHOT spell's `if` predicate only
// supports a boolean-binding test or a numeric comparison of two EffectValues
// (no colour-census value member) — the continuous-CDA closure form that
// covers Zanam Djinn above does not apply to a one-shot conditional.
// tracked-by: #1083
// export const barrinsUnmaking: CardDefinition = {
//     id: "4d4cecb0-12b5-4678-b5e7-8cec8fc86cef",
//     name: "Barrin's Unmaking",
//     rarity: "common",
//     manaCost: { X: 1, U: 1 },
//     types: ["Instant"],
// };

// Blind Seer — "{1}{U}: Target spell or permanent becomes the color of your
// choice until end of turn." `SpellContext.setColorOverride` exists but the
// `setColor` Op is still `planned` (EFFECT_OP_BACKLOG), not registered.
// tracked-by: #1083
// export const blindSeer: CardDefinition = {
//     id: "5c54ec26-c7f1-4258-9cc9-1709987f293c",
//     name: "Blind Seer",
//     rarity: "rare",
//     manaCost: { X: 2, U: 2 },
//     types: ["Creature"],
// };

// Breaking Wave — "You may cast this spell as though it had flash if you pay
// {2} more. Simultaneously untap all tapped creatures and tap all untapped
// creatures." No AlternativeCost shape for a "cast as flash for {N} more" cost
// (a cast-time rule, not a resolve()-body fix), and no `if`-predicate form
// reads a permanent's own tapped state to branch a per-member toggle.
// tracked-by: #1083
// export const breakingWave: CardDefinition = {
//     id: "1b39cd77-97aa-4099-8405-366f82079758",
//     name: "Breaking Wave",
//     rarity: "rare",
//     manaCost: { X: 2, U: 2 },
//     types: ["Sorcery"],
// };

// Crystal Spray — "Change the text of target spell or permanent by replacing
// all instances of one color word with another or one basic land type with
// another until end of turn. Draw a card." No Op or sanctioned protocol wraps
// a one-shot text-changing effect (CR 613.1c) on an arbitrary target.
// tracked-by: #1083
// export const crystalSpray: CardDefinition = {
//     id: "8798a4f1-34bb-449d-a8cc-faf8bda8e0ab",
//     name: "Crystal Spray",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Instant"],
// };

// Distorting Wake — "Return X target nonland permanents to their owners'
// hands." `TargetRequirement.count: "X"` is supported, but
// `EffectTargetRef = { target: number }` is a single fixed slot and `forEach`
// has no "iterate the announced targets" selector — a DSL script can't act on
// a variable-N target set yet.
// tracked-by: #1083
// export const distortingWake: CardDefinition = {
//     id: "cf48eec9-96be-4f53-9d9a-c6f02d44c995",
//     name: "Distorting Wake",
//     rarity: "rare",
//     manaCost: { X: 0, U: 3 },
//     types: ["Sorcery"],
// };

// Dream Thrush — "Flying. {T}: Target land becomes the basic land type of
// your choice until end of turn." `SpellContext.setSubtypesUntil` exists
// (Orcish Farmer precedent) but has no Op wrapper, and the sanctioned ETB
// choice-storage protocol only covers a fixed SELF-source read, not a
// targeted, duration-scoped change via an activated ability.
// tracked-by: #1083
// export const dreamThrush: CardDefinition = {
//     id: "258217df-ae88-4d93-895a-3fd242baacd1",
//     name: "Dream Thrush",
//     rarity: "common",
//     manaCost: { X: 1, U: 1 },
//     types: ["Creature"],
// };

// Essence Leak — "Enchant permanent. As long as enchanted permanent is red or
// green, it has 'At the beginning of your upkeep, sacrifice this permanent
// unless you pay its mana cost.'" The granted trigger's `mayPay` cost would
// need to read the ENCHANTED PERMANENT's own printed mana cost dynamically;
// `MayPayCost` is a static literal with no such dynamic form.
// tracked-by: #1083
// export const essenceLeak: CardDefinition = {
//     id: "9099b2e6-9ed8-4a9c-97ca-77cc47678228",
//     name: "Essence Leak",
//     rarity: "uncommon",
//     manaCost: { U: 1 },
//     types: ["Enchantment"],
// };

// Faerie Squadron — "Kicker {3}{U}. If this creature was kicked, it enters
// with two +1/+1 counters on it and with flying." The counters clause needs a
// 1:2 multiplier `entersWith` doesn't support (only 1:1 "kicker" scaling,
// Everflowing Chalice), and the flying clause needs a PERMANENT (non-duration)
// ability grant on a conditional ETB — `grantAbility`'s `duration` is
// mandatory and `grantStaticAbilityPermanent` has no Op wrapper.
// tracked-by: #1083
// export const faerieSquadron: CardDefinition = {
//     id: "4c707c81-dbbd-43be-a79a-7bc92a584839",
//     name: "Faerie Squadron",
//     rarity: "common",
//     manaCost: { U: 1 },
//     types: ["Creature"],
// };

// Mana Maze — "Players can't cast spells that share a color with the spell
// most recently cast this turn." No game-state field tracks the most
// recently cast spell for a `StaticCastRestriction.forbids` predicate to
// read (`StaticEffectStateView` has no such history).
// tracked-by: #1083
// export const manaMaze: CardDefinition = {
//     id: "3323b377-4f9c-55b1-b969-7e3a271344a4",
//     name: "Mana Maze",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
// };

// Metathran Aerostat — "Flying. {X}{U}: You may put a creature card with mana
// value X from your hand onto the battlefield. If you do, return this
// creature to its owner's hand." `EffectCardFilter` has `manaValueAtMost`
// only, no exact `manaValueEquals` (unlike `TargetRequirement.mvFilter.equals`
// for announced targets) — can't filter a hand-card choice to "mana value
// exactly X".
// tracked-by: #1083
// export const metathranAerostat: CardDefinition = {
//     id: "59f34850-fb6f-4ac5-8309-4d53d770e28c",
//     name: "Metathran Aerostat",
//     rarity: "rare",
//     manaCost: { X: 2, U: 2 },
//     types: ["Creature"],
// };

// Metathran Transport — "Flying. This creature can't be blocked by blue
// creatures. {U}: Target creature becomes blue until end of turn." The
// activated ability needs the same missing `setColor` Op as Blind Seer; since
// every printed clause must be enforced, the whole card stays a stub rather
// than shipping a partial (the flying + can't-be-blocked-by-blue clauses
// alone are composable, but the card is all-or-nothing).
// tracked-by: #1083
// export const metathranTransport: CardDefinition = {
//     id: "4fa9048d-1599-44a5-b4b2-45382c5b238d",
//     name: "Metathran Transport",
//     rarity: "uncommon",
//     manaCost: { X: 1, U: 2 },
//     types: ["Creature"],
// };

// Psychic Battle — "Whenever a player chooses one or more targets, each
// player reveals the top card of their library. The player who reveals the
// card with the greatest mana value may change the target or targets. ..."
// A full new continuous reveal-and-compare-mana-value retargeting protocol —
// no existing primitive comes close.
// tracked-by: #1083
// export const psychicBattle: CardDefinition = {
//     id: "8758ca24-e613-43bf-be58-4cf557f82d0c",
//     name: "Psychic Battle",
//     rarity: "rare",
//     manaCost: { X: 3, U: 2 },
//     types: ["Enchantment"],
// };

// Rainbow Crow — "Flying. {1}: This creature becomes the color of your
// choice until end of turn." Same missing `setColor` Op as Blind Seer.
// tracked-by: #1083
// export const rainbowCrow: CardDefinition = {
//     id: "7e622ad2-473f-489e-b4cf-bbdcc44d0cde",
//     name: "Rainbow Crow",
//     rarity: "uncommon",
//     manaCost: { X: 3, U: 1 },
//     types: ["Creature"],
// };

// Shoreline Raider — "Protection from Kavu." `convex/gre/protection.ts` only
// parses "protection from <color|colorless>" — creature-type protection
// (CR 702.16k) is not engine-enforced; shipping the string as decorative-only
// staticAbilities would silently diverge from the printed rules text.
// tracked-by: #1083
// export const shorelineRaider: CardDefinition = {
//     id: "d895b3b8-2acc-4c9f-8341-f651c1255b7c",
//     name: "Shoreline Raider",
//     rarity: "common",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
// };

// Sway of Illusion — "Any number of target creatures become the color of
// your choice until end of turn. Draw a card." Same missing `setColor` Op.
// tracked-by: #1083
// export const swayOfIllusion: CardDefinition = {
//     id: "ff65e386-9aec-4deb-a4ec-d9a97bd87645",
//     name: "Sway of Illusion",
//     rarity: "uncommon",
//     manaCost: { X: 1, U: 1 },
//     types: ["Instant"],
// };

// Teferi's Response — "Counter target spell or ability an opponent controls
// that targets a land you control. If a permanent's ability is countered
// this way, destroy that permanent. Draw two cards." No target requirement
// expresses "spell or ability that targets a land you control", and
// countering an ACTIVATED/TRIGGERED ability (not just a spell) is unbuilt.
// tracked-by: #1083
// export const teferisResponse: CardDefinition = {
//     id: "f3bb2df8-c559-4a34-83b0-d48fbc694cc8",
//     name: "Teferi's Response",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1 },
//     types: ["Instant"],
// };

// Temporal Distortion — "Whenever a creature or land becomes tapped, put an
// hourglass counter on it. Each permanent with an hourglass counter on it
// doesn't untap during its controller's untap step. At the beginning of each
// player's upkeep, remove all hourglass counters from permanents that player
// controls." A bespoke marker-counter-driven untap lock (CR 502.3) with no
// existing primitive.
// tracked-by: #1083
// export const temporalDistortion: CardDefinition = {
//     id: "74bd0d14-8d26-403f-9405-d0dcdecd1a49",
//     name: "Temporal Distortion",
//     rarity: "rare",
//     manaCost: { X: 3, U: 2 },
//     types: ["Enchantment"],
// };

// Tidal Visionary — "{T}: Target creature becomes the color of your choice
// until end of turn." Same missing `setColor` Op.
// tracked-by: #1083
// export const tidalVisionary: CardDefinition = {
//     id: "a72a3051-7f46-4b6b-b4fb-0f170d9687ab",
//     name: "Tidal Visionary",
//     rarity: "common",
//     manaCost: { U: 1 },
//     types: ["Creature"],
// };

// Well-Laid Plans — "Prevent all damage that would be dealt to a creature by
// another creature if they share a color." `ReplacementStateView`'s
// battlefield snapshot exposes types/subtypes/staticAbilities but not colour,
// so a damage-replacement predicate can't read the TARGET creature's colour
// (only the damage SOURCE's colour rides the event).
// tracked-by: #1083
// export const wellLaidPlans: CardDefinition = {
//     id: "5f2b3879-c962-5274-89a8-2f1da2b56a2e",
//     name: "Well-Laid Plans",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Enchantment"],
// };
