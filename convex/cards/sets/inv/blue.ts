// Invasion (INV) — blue cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
//
// This module carries the free tranche (issue #1070, parent PRD #1063): every
// mono-blue non-land INV card expressible with already-shipped Ops/keywords.
// Collective Restraint and Worldly Counsel shipped as active defs with the
// Domain capability cluster (#1066, below). Fact or Fiction is OWNED BY the
// pile-division cluster (#1067) and stays a commented stub — not duplicated
// as an active def. A further 19 cards hit genuine engine/DSL capability gaps
// discovered while authoring this tranche, tracked by #1083. That issue's
// slice shipped four new capabilities — the `setColor` Op (CR 613.1e), the
// `setSubtype` Op (CR 305.7, the land-type-change twin of `addSubtype`), the
// `manaValueEquals` exact-match filter field, and the `forEach { set:
// "targets" }` selector (the "X-multi-target" gap closer) — plus a `colors`
// field on `ReplacementStateView`'s battlefield snapshot, and unstubbed nine
// of the nineteen cards below: Blind Seer, Distorting Wake, Dream Thrush,
// Metathran Aerostat, Metathran Transport, Rainbow Crow, Sway of Illusion,
// Tidal Visionary, Well-Laid Plans.
//
// RE-DERIVED 2026-08-25 (#1841 audit). The paragraph that used to stand here
// listed ten remaining stubs all pointing at #1841 and named creature-type
// protection as a CR 702.16k gap; both were stale. Current disposition of
// the stubs below, each carrying its own owner:
//
//   SHIPPED by #2761: Faerie Squadron is no longer a stub — see its active
//   `CardDefinition` below (the old "grantAbility needs a duration" claim was
//   wrong; the actual fix is a `wasKicked`-gated `keyword-grant`, CR 611.2b /
//   614.1c).
//
//   OWNED BY A CAPABILITY ISSUE:
//     Crystal Spray      -> #2763  one-shot text-changing Op (CR 612)
//     Shoreline Raider   -> #2765  the CR 702.16a SUBTYPE protection quality
//                                  (NOT CR 702.16k, a player quality that
//                                  already ships)
//     Breaking Wave      -> #2146 (cast rider) + #1332 (tapped-state filter)
//
//   ONE-OFF PRIMITIVE GAPS, on the INV assorted-gaps slice #1332:
//     Barrin's Unmaking, Essence Leak, Mana Maze, Psychic Battle,
//     Teferi's Response, Temporal Distortion
//
// Two of those markers carried claims this audit disproved outright and
// corrected in place: Essence Leak's (`MayPayCost` has had a dynamic form
// since #1150/#1958) and Teferi's Response's (Stifle counters abilities
// today). Each remaining stub is a stop-and-issue case — not an invented Op,
// not a `resolve()` paper-over.
import type {
    CardDefinition,
    Color,
    ManaCost,
    PermanentView,
    StaticEffectContext,
    CardPrint,
} from "../../types";
import {
    AURA_AFFECTS_HOST,
    BASIC_LAND_SUBTYPES,
    countDomain,
    EFFECT_AFFECTS_SELF,
    LANDWALK_KEYWORD_BY_BASIC_TYPE,
    PERMANENT_TYPES,
} from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import {
    chooseColorEffects,
    colorChoiceModes,
} from "../../abilities/chooseColor";
import { manaCostForCardId } from "../../manaCostLookup";

/** Colors (CR 202.2, layer 5 colorOverride, issue #1083) of a battlefield
 *  view permanent, for a `StaticBlockRestriction.predicate` — which gets
 *  only `(self, opponent, state?)`, no `ctx: StaticEffectContext` (unlike a
 *  continuous `StaticEffect.applies`). Mirrors `STATIC_EFFECT_CTX.getColors`
 *  (`gre/layers.ts`) exactly — colorOverride wins outright, else derive from
 *  mana cost, then fold in granted colors — but reimplemented locally rather
 *  than imported: `gre/layers.ts` imports `tryGetDefinition` from the card
 *  registry (`cards/index.ts`), which imports every set module including
 *  this one — importing it back here would be an eval-time cycle. Uses the
 *  cycle-free `manaCostForCardId` accessor instead (same precedent as
 *  arn/white.ts's `permanentColors`). `perm` carries `colorOverride`/
 *  `grantedColors` at runtime even though `PermanentView`'s declared type
 *  doesn't list them — the combat validator passes the raw (fat)
 *  `CardInstanceState`, just typed narrower. */
function effectiveColors(perm: PermanentView): Color[] {
    const raw = perm as unknown as {
        colorOverride?: Color[];
        card?: { id?: string; manaCost?: ManaCost };
        grantedColors?: { color: string }[];
    };
    if (raw.colorOverride) return raw.colorOverride;
    const cost =
        raw.card?.manaCost ??
        (raw.card?.id ? manaCostForCardId(raw.card.id) : undefined);
    const base = cost
        ? (["W", "U", "B", "R", "G"] as const).filter((c) => (cost[c] ?? 0) > 0)
        : [];
    if (!raw.grantedColors?.length) return [...base];
    const all = new Set<Color>(base);
    for (const g of raw.grantedColors) all.add(g.color as Color);
    return [...all];
}

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

// disrupt — INV reprint of the Weatherlight definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `wth/blue.ts`.
export const disruptInv: CardPrint = {
    printId: "c000a02f-6b7e-4925-a938-59e645e980d7", // INV 60
    definitionId: "c6cc89b0-9acf-452b-ac1a-bc7e90eb32fc", // disrupt (Weatherlight)
    setCode: "inv",
    rarity: "uncommon",
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
// (CR 701.6a + CR 121.1, the shipped creature-counter template — leg/blue.ts
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
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}",
            mana: { X: 2 },
        },
    ],
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

// shimmeringWings — INV reprint of the Tempest definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `tmp/blue.ts`.
export const shimmeringWingsInv: CardPrint = {
    printId: "9615a6c2-1732-4a04-9be1-cc0a8d39de3f", // INV 84
    definitionId: "a6a8dc46-04c7-479a-90c1-b55e6c67e0e3", // shimmeringWings (Tempest)
    setCode: "inv",
    rarity: "common",
};

// Sky Weaver — {1}{U} Creature — Metathran Wizard, 2/1. "{2}: Target white or
// black creature gains flying until end of turn." (CR 611.2a/613.1f layer-6
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
// lea/blue.ts — + CR 702.33 Kicker.) The kicked counters are a REPLACEMENT
// effect (CR 121.6 / 614.1c, issue #1693), not a triggered ability: FOUR
// `entersWith.counters` entries each `count: "kicker"` (kickerCount is 0/1 for
// a single, non-multi Kicker) sum to exactly 0 or 4 as the creature enters —
// the shipped Duskwalker / Llanowar Elite idiom (inv/black.ts, inv/green.ts),
// reusing the per-kick counter primitive rather than adding a multiplier
// field. Previously an `enteredTrigger` carrying an `if(kickerCount>=1)`
// `counters` Op, which put the placement on the stack and let both players
// see (and respond to) a 2/2 Serpent that should already have been a 6/6.
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
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}",
            mana: { X: 2 },
        },
    ],
    entersWith: {
        counters: [
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
        ],
    },
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
                color,
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
// `subtype-set` needed a computed `subtypesFor` for its OWN mechanic. The
// subtype → keyword lookup is the shared `LANDWALK_KEYWORD_BY_BASIC_TYPE`
// (`cards/types.ts` — a dependency-free leaf; NOT `gre/constants.ts`, which
// imports the card registry and can't be imported FROM a `cards/sets/**`
// file without reopening the set↔registry eval-time cycle) — Magnigoth
// Treefolk (`pls/green.ts`) needs the same fan-out for its own Domain
// landwalk grant and imports the same table.
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
        keyword: LANDWALK_KEYWORD_BY_BASIC_TYPE[landType],
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
// ability word, issue #1066.) DSL-first: the `lookDistribute` Op (issue #984)
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
            op: "lookDistribute",
            keepTo: "hand",
            player: "controller",
            look: { domain: { of: "controller" } },
        },
    ],
};

// Fact or Fiction — {3}{U} Instant. "Reveal the top five cards of your
// library. An opponent separates those cards into two piles. Put one pile
// into your hand and the other into your graveyard." (CR 701.20 reveal,
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
// tracked-by: #1332
// export const barrinsUnmaking: CardDefinition = {
//     id: "4d4cecb0-12b5-4678-b5e7-8cec8fc86cef",
//     name: "Barrin's Unmaking",
//     rarity: "common",
//     manaCost: { X: 1, U: 1 },
//     types: ["Instant"],
// };

// Blind Seer — {2}{U}{U} Legendary Creature — Human Wizard, 3/3. "{1}{U}:
// Target spell or permanent becomes the color of your choice until end of
// turn." (CR 613.1e layer 5 — the `setColor` Op, shipped this slice #1083,
// wraps `SpellContext.setColorOverride`; the "choose one of five colors"
// half composes the pre-existing `optionChoice` Op via the shared
// `chooseColorEffects` builder — no new choice-kind construct needed, ADR
// 0045 "generalize, don't add".)
export const blindSeer: CardDefinition = {
    id: "5c54ec26-c7f1-4258-9cc9-1709987f293c",
    name: "Blind Seer",
    rarity: "rare",
    oracleText:
        "{1}{U}: Target spell or permanent becomes the color of your choice until end of turn.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    supertypes: ["Legendary"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "blind-seer-color",
            oracleText:
                "{1}{U}: Target spell or permanent becomes the color of your choice until end of turn.",
            cost: { mana: { X: 1, U: 1 } },
            useStack: true,
            targetRequirement: { type: "spell-or-permanent", count: 1 },
            effects: chooseColorEffects(
                { target: 0 },
                { phase: "end-of-turn" },
                "Choose a color (Blind Seer)."
            ),
        },
    ],
};

// Breaking Wave — "You may cast this spell as though it had flash if you pay
// {2} more to cast it. Simultaneously untap all tapped creatures and tap all
// untapped creatures." The card carried TWO independent gaps and only ONE of
// them is now closed.
//
// CLOSED (issue #2146): the CR 601.3c cast rider. `CardDefinition.
// flashSurcharge` ships with the other four cards of the cycle (Rout,
// Twilight's Call, Ghitu Fire, Saproling Symbiosis) and would apply verbatim
// here — `flashSurcharge: { X: 2 }`, nothing card-specific about it.
//
// STILL OPEN, and why this card stays a stub: no `EffectCardFilter`
// (`cards/types.ts`) field reads a permanent's own TAPPED state, so
// `objectMatchesFilter` cannot express "all tapped creatures" / "all untapped
// creatures", and the two clauses are SIMULTANEOUS (CR 608.2 — one event, on
// one snapshot of the board), which rules out the sequential workaround of
// untapping everything and then tapping what was untapped. Shipping the rider
// alone would leave the card castable and inert, which is exactly the
// partial-mechanic failure the divergence rules forbid; deliberately NOT
// widened here either, since a new filter field is a catalogue-wide input to
// every `isCardFilter` consumer and belongs to its own slice.
// tracked-by: #1332
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
// tracked-by: #2763
// export const crystalSpray: CardDefinition = {
//     id: "8798a4f1-34bb-449d-a8cc-faf8bda8e0ab",
//     name: "Crystal Spray",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Instant"],
// };

// Distorting Wake — {X}{U}{U}{U} Sorcery. "Return X target nonland
// permanents to their owners' hands." (CR 601.2c variable-target-count
// `count: "X"`; the new `forEach { set: "targets" }` selector, shipped this
// slice #1083, iterates the whole announced target set — the "X-multi-
// target" gap closer, `EffectObjectSelector`'s single fixed `{ target: N }`
// slot's variable-N companion.)
export const distortingWake: CardDefinition = {
    id: "cf48eec9-96be-4f53-9d9a-c6f02d44c995",
    name: "Distorting Wake",
    rarity: "rare",
    oracleText: "Return X target nonland permanents to their owners' hands.",
    manaCost: { X: "X", U: 3 },
    types: ["Sorcery"],
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: "X",
        excludeTypes: "Land",
    },
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        },
    ],
};

// Dream Thrush — {1}{U} Creature — Bird, 1/1. "Flying. {T}: Target land
// becomes the basic land type of your choice until end of turn." (CR 702.9b
// flying; CR 305.7 layer-4 land-type change via the new `setSubtype` Op,
// shipped this slice #1083, a declarative skin over
// `SpellContext.setSubtypesUntil` — the Orcish Farmer / Slimy Kavu precedent
// closures composed as a DSL Op. The "choose the basic land type" half reuses
// the pre-existing `optionChoice` Op, one mode per `BASIC_LAND_SUBTYPES`
// entry, exactly like `chooseColorEffects`'s "choose a color" shape.)
export const dreamThrush: CardDefinition = {
    id: "258217df-ae88-4d93-895a-3fd242baacd1",
    name: "Dream Thrush",
    rarity: "common",
    oracleText:
        "Flying\n{T}: Target land becomes the basic land type of your choice until end of turn.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "dream-thrush-land-type",
            oracleText:
                "{T}: Target land becomes the basic land type of your choice until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose a basic land type (Dream Thrush).",
                    modes: BASIC_LAND_SUBTYPES.map((subtype) => ({
                        id: subtype,
                        label: subtype,
                        effects: [
                            {
                                op: "setSubtype" as const,
                                target: { target: 0 },
                                subtypes: [subtype],
                                duration: { phase: "end-of-turn" as const },
                            },
                        ],
                    })),
                },
            ],
        },
    ],
};

// Essence Leak — "Enchant permanent. As long as enchanted permanent is red or
// green, it has 'At the beginning of your upkeep, sacrifice this permanent
// unless you pay its mana cost.'"
//
// NARROWED 2026-08-25 (#1841 audit): the old marker said "`MayPayCost` is a
// static literal with no such dynamic form". WRONG at HEAD —
// `DynamicMayPayManaCost` (issue #1150, generalized #1958) is a second shape
// on the `mayPay` Op's `cost` field, and its `manaCostOf` leg is exactly
// "pay ITS mana cost" (Flash, MIR). What is still missing is narrower: the
// conditional STATIC grant of a triggered ability gated on the enchanted
// permanent's live colours, and a `manaCostOf` ref naming the granted
// ability's own source rather than an earlier `choice` Op's picks.
// tracked-by: #1332
// export const essenceLeak: CardDefinition = {
//     id: "9099b2e6-9ed8-4a9c-97ca-77cc47678228",
//     name: "Essence Leak",
//     rarity: "uncommon",
//     manaCost: { U: 1 },
//     types: ["Enchantment"],
// };

// Faerie Squadron — {U} Creature — Faerie, 1/1. "Kicker {3}{U}. If this
// creature was kicked, it enters with two +1/+1 counters on it and with
// flying." The counters clause IS now expressible: `resolveEntersWithCounters`
// sums same-type entries, so two `{ count: "kicker" }` rows yield 2 when
// kicked and none otherwise (issue #1693; Vodalian Serpent above uses four
// such rows).
//
// FREED 2026-08-25 (#1841 audit, shipped by #2761): the old marker said the
// flying clause "needs a PERMANENT (non-duration) ability grant on a
// conditional ETB — `grantAbility`'s `duration` is mandatory and
// `grantStaticAbilityPermanent` has no Op wrapper". WRONG on both halves —
// but the CORRECT fix is not the `grantAbility` Op on a conditional ETB
// TRIGGER either: CR 614.1c/614.12 makes "if this creature was kicked, it
// enters with ... and with flying" ONE replacement effect governing how the
// object enters, exactly like the counters half (already `entersWith.counters`,
// a replacement, NOT a `PERMANENT_ENTERED` trigger carrying a `counters` Op —
// that shape is a bug, issue #1693). An `enteredTrigger` granting flying would
// reopen the identical bug for the keyword: a window where the creature is on
// the battlefield without flying before the trigger resolves. The
// already-shipped, CR-exact, and simpler fix is Pouncing Kavu's OWN template
// (`inv/red.ts`, issue #1716): a `staticEffects` `keyword-grant` gated on
// `CardInstanceState.wasKicked` — a one-shot fact fixed at CR 614.1c ETB
// replacement time, materialized into `staticAbilities` continuously, no stack
// window. Same correction applies to Kavu Titan (`inv/green.ts`).
export const faerieSquadron: CardDefinition = {
    id: "4c707c81-dbbd-43be-a79a-7bc92a584839",
    name: "Faerie Squadron",
    rarity: "common",
    oracleText:
        "Kicker {3}{U} (You may pay an additional {3}{U} as you cast this spell.)\nIf this creature was kicked, it enters with two +1/+1 counters on it and with flying.",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 1,
    toughness: 1,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {3}{U}",
            mana: { X: 3, U: 1 },
        },
    ],
    entersWith: {
        counters: [
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
        ],
    },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id === source.id && target.wasKicked === true,
            keyword: "flying",
        },
    ],
};

// Mana Maze — "Players can't cast spells that share a color with the spell
// most recently cast this turn." No game-state field tracks the most
// recently cast spell for a `StaticCastRestriction.forbids` predicate to
// read (`StaticEffectStateView` has no such history).
// tracked-by: #1332
// export const manaMaze: CardDefinition = {
//     id: "3323b377-4f9c-55b1-b969-7e3a271344a4",
//     name: "Mana Maze",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
// };

// Metathran Aerostat — {2}{U}{U} Creature — Metathran, 2/2. "Flying. {X}{U}:
// You may put a creature card with mana value X from your hand onto the
// battlefield. If you do, return this creature to its owner's hand." (CR
// 702.9b flying; the new `manaValueEquals` filter field, shipped this slice
// #1083, `manaValueAtMost`'s exact-match sibling, filters the hand-card
// `choice` to "mana value exactly X"; `moveZone(cards, from: "hand", to:
// "battlefield")` puts it into play; the trailing `if { picksNonEmpty }` gate
// — the Krovikan Sorcerer "if you do" idiom — returns this creature to hand
// only when a card was actually put onto the battlefield.)
export const metathranAerostat: CardDefinition = {
    id: "59f34850-fb6f-4ac5-8309-4d53d770e28c",
    name: "Metathran Aerostat",
    rarity: "rare",
    oracleText:
        "Flying\n{X}{U}: You may put a creature card with mana value X from your hand onto the battlefield. If you do, return this creature to its owner's hand.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Metathran"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "metathran-aerostat-swap",
            oracleText:
                "{X}{U}: You may put a creature card with mana value X from your hand onto the battlefield. If you do, return this creature to its owner's hand.",
            cost: { mana: { X: "X", U: 1 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    filter: { type: "Creature", manaValueEquals: { X: true } },
                    count: { min: 0, max: 1 },
                    prompt: "Put a creature card with mana value X onto the battlefield? (Metathran Aerostat)",
                    bind: "$metathranAerostatPick",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$metathranAerostatPick" },
                    player: "controller",
                    from: "hand",
                    to: "battlefield",
                },
                {
                    op: "if",
                    predicate: {
                        picksNonEmpty: { ref: "$metathranAerostatPick" },
                    },
                    then: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    ],
};

// Metathran Transport — {1}{U}{U} Creature — Metathran, 1/3. "Flying. This
// creature can't be blocked by blue creatures. {U}: Target creature becomes
// blue until end of turn." (CR 702.9b flying; CR 509.1b block restriction —
// `effectiveColors` reads the candidate blocker's EFFECTIVE color, layer 5,
// so a `setColor`'d creature is read correctly, matching the same `setColor`
// Op — shipped this slice #1083 — the activated ability now uses; the
// activated half is a FIXED "becomes blue", not a player choice, so it's a
// bare `setColor` Op, not `chooseColorEffects`'s modal wrapper.)
export const metathranTransport: CardDefinition = {
    id: "4fa9048d-1599-44a5-b4b2-45382c5b238d",
    name: "Metathran Transport",
    rarity: "uncommon",
    oracleText:
        "Flying\nThis creature can't be blocked by blue creatures.\n{U}: Target creature becomes blue until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Metathran"],
    power: 1,
    toughness: 3,
    staticAbilities: ["flying"],
    staticEffects: [
        {
            kind: "block-restriction",
            id: "metathran-transport-no-blue",
            side: "attacker" as const,
            // CR 509.1b — can't be blocked by blue creatures.
            predicate: (_self, opponent) =>
                !effectiveColors(opponent).includes("U"),
            oracleText:
                "Metathran Transport can't be blocked by blue creatures.",
        },
    ],
    activatedAbilities: [
        {
            id: "metathran-transport-color",
            oracleText: "{U}: Target creature becomes blue until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "setColor",
                    target: { target: 0 },
                    colors: ["U"],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Psychic Battle — "Whenever a player chooses one or more targets, each
// player reveals the top card of their library. The player who reveals the
// card with the greatest mana value may change the target or targets. ..."
// A full new continuous reveal-and-compare-mana-value retargeting protocol —
// no existing primitive comes close.
// tracked-by: #1332
// export const psychicBattle: CardDefinition = {
//     id: "8758ca24-e613-43bf-be58-4cf557f82d0c",
//     name: "Psychic Battle",
//     rarity: "rare",
//     manaCost: { X: 3, U: 2 },
//     types: ["Enchantment"],
// };

// Rainbow Crow — {3}{U} Creature — Bird, 2/2. "Flying. {1}: This creature
// becomes the color of your choice until end of turn." (CR 702.9b flying;
// CR 613.1e via `chooseColorEffects` — same `setColor` Op as Blind Seer,
// shipped this slice #1083 — targeting `$source` for a self-color-change.)
export const rainbowCrow: CardDefinition = {
    id: "7e622ad2-473f-489e-b4cf-bbdcc44d0cde",
    name: "Rainbow Crow",
    rarity: "uncommon",
    oracleText:
        "Flying\n{1}: This creature becomes the color of your choice until end of turn.",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "rainbow-crow-color",
            oracleText:
                "{1}: This creature becomes the color of your choice until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            effects: chooseColorEffects(
                { ref: "$source" },
                { phase: "end-of-turn" },
                "Choose a color (Rainbow Crow)."
            ),
        },
    ],
};

// Shoreline Raider — "Protection from Kavu."
//
// CORRECTED 2026-08-25 (#1841 audit) on both counts. (1) The rule is
// CR 702.16a, which says a protection quality may be a card type, subtype or
// supertype — NOT CR 702.16k, which is protection from a PLAYER and is a
// family this engine already ships. (2) `convex/gre/protection.ts` does not
// "only parse protection from <color|colorless>": four quality families ship
// behind one parser (colour/colourless, player, characteristic types +
// supertypes, coloured spell). The genuine gap is one leg — a SUBTYPE
// quality, which that module excludes deliberately for lack of a closed
// subtype vocabulary. Shipping the string anyway is not an option: the
// parser fails closed and the catalogue guard reds CI.
// tracked-by: #2765
// export const shorelineRaider: CardDefinition = {
//     id: "d895b3b8-2acc-4c9f-8341-f651c1255b7c",
//     name: "Shoreline Raider",
//     rarity: "common",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
// };

// Sway of Illusion — {1}{U} Instant. "Any number of target creatures become
// the color of your choice until end of turn. Draw a card." (CR 601.2c a
// `{ min: 0 }` variable target count — "any number" — announces 0..N
// targets into one requirement slot; the new `forEach { set: "targets" }`
// selector, shipped this slice #1083 alongside Distorting Wake, iterates all
// of them. "THE color of your choice" is singular — ONE choice shared by
// every targeted creature, not a per-creature pick — so the `optionChoice`
// wraps the `forEach` (one shared choice, applied to the whole set), unlike
// `chooseColorEffects`'s single-target convenience wrapper.)
export const swayOfIllusion: CardDefinition = {
    id: "ff65e386-9aec-4deb-a4ec-d9a97bd87645",
    name: "Sway of Illusion",
    rarity: "uncommon",
    oracleText:
        "Any number of target creatures become the color of your choice until end of turn.\nDraw a card.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 0 } },
    effects: [
        {
            op: "optionChoice",
            prompt: "Choose a color (Sway of Illusion).",
            modes: colorChoiceModes((color) => [
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [
                        {
                            op: "setColor",
                            target: { ref: "$each" },
                            colors: [color],
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ]),
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Teferi's Response — "Counter target spell or ability an opponent controls
// that targets a land you control. If a permanent's ability is countered
// this way, destroy that permanent. Draw two cards."
//
// NARROWED 2026-08-25 (#1841 audit): the old marker also claimed
// "countering an ACTIVATED/TRIGGERED ability (not just a spell) is unbuilt".
// WRONG at HEAD — Stifle (`convex/cards/sets/scg/blue.ts`) ships exactly
// that today with `targetRequirement: { type: "spell", spellStackKind:
// "ability" }` + the `counter` Op, and `spellStackKind` also has an
// `"activated-ability"` member. The surviving blockers are narrower: no
// target requirement expresses "spell or ability that TARGETS A LAND YOU
// CONTROL", and no Op expresses the "if a permanent's ability is countered
// this way, destroy that permanent" rider.
// tracked-by: #1332
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
// tracked-by: #1332
// export const temporalDistortion: CardDefinition = {
//     id: "74bd0d14-8d26-403f-9405-d0dcdecd1a49",
//     name: "Temporal Distortion",
//     rarity: "rare",
//     manaCost: { X: 3, U: 2 },
//     types: ["Enchantment"],
// };

// Tidal Visionary — {U} Creature — Merfolk Wizard, 1/1. "{T}: Target
// creature becomes the color of your choice until end of turn." (CR 613.1e
// via `chooseColorEffects` — same `setColor` Op as Blind Seer, shipped this
// slice #1083 — targeting an announced Creature slot.)
export const tidalVisionary: CardDefinition = {
    id: "a72a3051-7f46-4b6b-b4fb-0f170d9687ab",
    name: "Tidal Visionary",
    rarity: "common",
    oracleText:
        "{T}: Target creature becomes the color of your choice until end of turn.",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "tidal-visionary-color",
            oracleText:
                "{T}: Target creature becomes the color of your choice until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: chooseColorEffects(
                { target: 0 },
                { phase: "end-of-turn" },
                "Choose a color (Tidal Visionary)."
            ),
        },
    ],
};

// Well-Laid Plans — {2}{U} Enchantment. "Prevent all damage that would be
// dealt to a creature by another creature if they share a color." (CR 615
// prevention via a `replacementEffects[]` `"damage"` entry — the Argothian
// Pixies precedent shape. `ReplacementStateView.players[].battlefield[]` now
// carries `colors` (issue #1083, this slice), so the predicate can read the
// TARGET creature's color by id — only the damage SOURCE's color rode the
// event before. NOTE — the stub's placeholder id
// `5f2b3879-c962-5274-89a8-2f1da2b56a2e` does not resolve to any real
// Scryfall object (verified); corrected to the real INV #88 print id below.)
export const wellLaidPlans: CardDefinition = {
    id: "1c55eb8f-925a-42c1-9e48-d7f99cab3b01",
    name: "Well-Laid Plans",
    rarity: "rare",
    oracleText:
        "Prevent all damage that would be dealt to a creature by another creature if they share a color.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "well-laid-plans-shared-color",
            eventKind: "damage",
            damageEffectKind: "prevention",
            oracleText:
                "Prevent all damage that would be dealt to a creature by another creature if they share a color.",
            appliesTo: (event, _self, state) => {
                if (event.kind !== "damage") return false;
                // CR 208.2 — the damage SOURCE must be a creature ("by
                // another creature"); a noncreature source never triggers
                // this prevention regardless of color.
                if (!event.sourceTypes.includes("Creature")) return false;
                if (event.target.type !== "permanent") return false;
                const targetCreature = state.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === event.target.id);
                if (!targetCreature?.types.includes("Creature")) return false;
                // "another creature" — a creature never shares this
                // prevention with itself (self-damage), though `sourceColors`
                // vs. the SAME id's `colors` would trivially share a color
                // anyway; explicit id check for CR 208.2 precision.
                if (targetCreature.id === event.sourceInstanceId) return false;
                return event.sourceColors.some((c) =>
                    targetCreature.colors.includes(c)
                );
            },
            // CR 615 — prevent all matching damage.
            replace: () => ({ kind: "consumed" }),
        },
    ],
};
