// Invasion (INV) — green cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).

import type {
    CardDefinition,
    CardPrint,
    EffectOp,
    StaticKeywordGrant,
} from "../../types";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import {
    enteringEffectivePower,
    additionalCostPaidCondition,
} from "../../abilities/triggers/shared";
import { colorChoiceModes } from "../../abilities/chooseColor";
import { protectionColorModes } from "../../abilities";

// Blurred Mongoose — "This spell can't be countered. Shroud (This creature
// can't be the target of spells or abilities.)" (CR 113.6g can't-be-countered
// flag, issue #1065; CR 702.18 Shroud.)
//
// The registry's `staticAbilities: ["shroud"]` string is registry status
// "implemented" (`mechanicsRegistry.ts`) — `gre/permanentGuard.ts`'s
// `isGuardedAgainst` derives real target-illegality from the bare keyword
// string generically (the `hasShroud` bridge, mirroring `hasHexproof` for CR
// 702.11b, issue #959), consumed by `rules.ts::getLegalTargets` +
// `game.ts::selectTarget`. This card additionally pairs the keyword with an
// explicit `permanent-guard` static effect scoped to the permanent itself
// (`target.id === source.id`) — the established per-card pattern (Lurker
// `drk/green.ts`, Spectral Cloak `leg/blue.ts`) — unconditional and
// unfiltered here (unlike Lurker's combat-gated version), matching CR
// 702.18's unqualified "can't be the target of spells or abilities." The two
// are redundant-but-agreeing, not a conflict: the keyword-string bridge is
// what closes the gap for cards that grant shroud DYNAMICALLY via
// `SpellContext.grantStaticAbility` with no paired `permanent-guard`
// staticEffect of their own (Homarid Warrior / Svyelunite Priest
// `fem/blue.ts`, Sylvan Safekeeper `jud/green.ts`, Skyshroud Blessing
// `pls/green.ts`) — this card's own printed shroud was never part of that
// gap, since it always carried the explicit static effect above.
export const blurredMongoose: CardDefinition = {
    id: "4b073e3f-6a6f-495a-ab16-39d906b660f1",
    rarity: "uncommon",
    name: "Blurred Mongoose",
    oracleText:
        "This spell can't be countered.\nShroud (This creature can't be the target of spells or abilities.)",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Mongoose"],
    power: 2,
    toughness: 1,
    cantBeCountered: true,
    staticAbilities: ["shroud"],
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "blurred-mongoose-shroud",
            cantBeTargeted: true,
            applies: (target, source) => target.id === source.id,
        },
    ],
};

// Kavu Chameleon — "This spell can't be countered. {G}: This creature
// becomes the color of your choice until end of turn." (CR 113.6g can't-be-
// countered flag, issue #1065; CR 305.7 / 613.1d layer-5 colour change.)
//
// Migrated resolve()→effects[] (ADR 0045): the `setColor` Op shipped (issue
// #1083, promoted from `EFFECT_OP_BACKLOG`), a thin declarative skin over
// the same `SpellContext.setColorOverride` primitive this closure called
// directly. The Shyft shape (`ice/blue.ts`): `optionChoice` — one mode per
// colour, each a single-Op `setColor` body with `duration: { phase:
// "end-of-turn" }` so the change reverts at CLEANUP (CR 514.2) instead of
// riding indefinitely like Shyft's own no-duration grant.
export const kavuChameleon: CardDefinition = {
    id: "f726437b-a41a-4ee9-b0ee-e09327508615",
    rarity: "uncommon",
    name: "Kavu Chameleon",
    oracleText:
        "This spell can't be countered.\n{G}: This creature becomes the color of your choice until end of turn.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 4,
    toughness: 4,
    cantBeCountered: true,
    activatedAbilities: [
        {
            id: "kavu-chameleon-color",
            oracleText:
                "{G}: This creature becomes the color of your choice until end of turn.",
            cost: { mana: { G: 1 } },
            useStack: true,
            effects: [
                {
                    op: "optionChoice",
                    player: "controller",
                    prompt: "Choose a color for Kavu Chameleon.",
                    modes: colorChoiceModes((color) => [
                        {
                            op: "setColor",
                            target: { ref: "$source" },
                            colors: [color],
                            duration: { phase: "end-of-turn" },
                        },
                    ]),
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Wandering Stream — {2}{G} Sorcery. "Domain — You gain 2 life for each
// basic land type among lands you control." (CR 119.3 life gain, CR 702
// preamble Domain ability word, issue #1066.) `times: 2` is the Domain
// value's fixed scaling-factor field (mirrors `EffectCountSpec.times`,
// issue #999) — "gain TWO life for each…", not one.
export const wanderingStream: CardDefinition = {
    id: "6da5cb6c-253b-44f0-98f9-d75f42c6e14b",
    rarity: "common",
    name: "Wandering Stream",
    oracleText:
        "Domain — You gain 2 life for each basic land type among lands you control.",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "gainLife",
            player: "controller",
            amount: { domain: { of: "controller", times: 2 } },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Free tranche (parent PRD #1063, issue #1073) — reuse-only cards, every
// clause enforced with already-shipped Ops/keywords.
// ─────────────────────────────────────────────────────────────────────────

// Aggressive Urge — {1}{G} Instant. "Target creature gets +1/+1 until end of
// turn. Draw a card." (CR 613.4c pump; CR 121.1 draw.)
export const aggressiveUrge: CardDefinition = {
    id: "37e3154d-9b1c-4f93-9bc3-a39e68d59d23",
    rarity: "common",
    name: "Aggressive Urge",
    oracleText: "Target creature gets +1/+1 until end of turn.\nDraw a card.",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "pump",
            target: { target: 0 },
            power: 1,
            toughness: 1,
            duration: { phase: "end-of-turn" },
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Bind — {1}{G} Instant. "Counter target activated ability. (Mana abilities
// can't be targeted.) Draw a card." (CR 701.6a counter; CR 605.3a mana
// abilities never use the stack, so the reminder text holds for free; CR
// 121.1 draw.) `spellStackKind: "activated-ability"` with no source-type
// restriction (unlike Brown Ouphe's artifact-only variant, `ice/green.ts`)
// keeps every activated ability on the stack a legal target.
export const bind: CardDefinition = {
    id: "cfa51783-9ef8-4e51-ba0d-ce8439d83bdf",
    rarity: "rare",
    name: "Bind",
    oracleText:
        "Counter target activated ability. (Mana abilities can't be targeted.)\nDraw a card.",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellStackKind: "activated-ability",
    },
    effects: [
        { op: "counter", target: { target: 0 } },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Elvish Champion — {1}{G}{G} Creature — Elf, 2/2. "Other Elf creatures get
// +1/+1 and have forestwalk." (CR 611.2c continuous anthem, layer 7c power/
// toughness; CR 702.14c forestwalk evasion.) Group `keyword-grant` mirrors
// Hidden Path's global forestwalk grant (`drk/green.ts`); the `pt-buff`
// mirrors Zombie Master's own-type lord anthem. Both scoped to "other Elf
// creatures" (excludes self via `target.id !== source.id`).
const ELVISH_CHAMPION_AFFECTS_OTHER_ELVES: StaticKeywordGrant["applies"] = (
    target,
    source,
    ctx
) =>
    target.id !== source.id &&
    ctx.isCreature(target) &&
    target.subtypes.includes("Elf");
export const elvishChampion: CardDefinition = {
    id: "c19bb473-03b0-4e6d-a7da-0ec1e7707a68",
    rarity: "rare",
    name: "Elvish Champion",
    oracleText:
        "Other Elf creatures get +1/+1 and have forestwalk. (They can't be blocked as long as defending player controls a Forest.)",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: ELVISH_CHAMPION_AFFECTS_OTHER_ELVES,
            power: 1,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: ELVISH_CHAMPION_AFFECTS_OTHER_ELVES,
            keyword: "forestwalk",
        },
    ],
};

// Explosive Growth — {G} Instant. "Kicker {5}. Target creature gets +2/+2
// until end of turn. If this spell was kicked, that creature gets +5/+5
// until end of turn instead." (CR 702.33 Kicker; CR 613.4c pump.)
export const explosiveGrowth: CardDefinition = {
    id: "eabc1e77-404c-436b-bde1-be1b21d00584",
    rarity: "common",
    name: "Explosive Growth",
    oracleText:
        "Kicker {5} (You may pay an additional {5} as you cast this spell.)\nTarget creature gets +2/+2 until end of turn. If this spell was kicked, that creature gets +5/+5 until end of turn instead.",
    manaCost: { G: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {5}",
            mana: { X: 5 },
        },
    ],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 5,
                    toughness: 5,
                    duration: { phase: "end-of-turn" },
                },
            ],
            else: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// harrow — INV reprint of the Tempest definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `tmp/green.ts`.
export const harrowInv: CardPrint = {
    printId: "ed0f633e-7238-4d02-ad8b-06dd20453030", // INV 183
    definitionId: "3c207142-4880-4935-9827-b91bc7d9d643", // harrow (Tempest)
    setCode: "inv",
    rarity: "common",
};

// Jade Leech — {2}{G}{G} Creature — Leech, 5/5. "Green spells you cast cost
// {G} more to cast." (CR 601.2f cost increase.) Scoped to the controller's
// own spells via `card.controllerId === effectSource.controllerId`, mirroring
// Stone Calendar's cost-modifier idiom (`drk/colorless.ts`), narrowed to
// green spells via `ctx.getColors(card).includes("G")`.
export const jadeLeech: CardDefinition = {
    id: "3392171d-ed25-46a1-91cc-a4f24537617d",
    rarity: "rare",
    name: "Jade Leech",
    oracleText: "Green spells you cast cost {G} more to cast.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Leech"],
    power: 5,
    toughness: 5,
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                !!effectSource &&
                card.controllerId === effectSource.controllerId &&
                ctx.getColors(card).includes("G"),
            costIncrease: { G: 1 },
        },
    ],
};

// Kavu Climber — {3}{G} Creature — Kavu, 3/3. "When this creature enters,
// draw a card." (CR 603.6a ETB; CR 121.1 draw.)
export const kavuClimber: CardDefinition = {
    id: "2063f31e-d972-411e-a265-1d409153b49c",
    rarity: "common",
    name: "Kavu Climber",
    oracleText: "When this creature enters, draw a card.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        enteredTrigger({
            id: "kavu-climber-etb",
            oracleText: "When this creature enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
};

// Kavu Lair — {2}{G} Enchantment. "Whenever a creature with power 4 or
// greater enters, its controller draws a card." (CR 603.6a ETB, any
// creature; CR 121.1 draw.)
//
// Migrated resolve()→effects[] (ADR 0049, issue #1283): the recipient is the
// ENTERING creature's controller, not this permanent's controller, but that
// is NOT a missing-Op gap — `PERMANENT_ENTERED.controllerId` is an already-
// censused `EVENT_FIELD_REGISTRY` row (issue #1072, added for Tectonic
// Instability), and `buildSpellContext` threads `item.triggerEvent` into
// EVERY triggered ability's `SpellContext` generically, `enteredTrigger`-built
// or not — the factory's own doc comment claiming the event isn't threaded
// was stale. `{ ref: "$event.controllerId" }` reads the entering permanent's
// controller straight off the firing event, bypassing `ctx.controller`
// entirely, exactly like Ankh of Mishra's `dealDamage` (`lea/colorless.ts`)
// already does at this SAME `enteredTrigger` `effects[]` site. Power is
// still read from the trigger's `TriggerStateView` snapshot in `condition`
// (printed/base power — the event payload itself carries no power field).
export const kavuLair: CardDefinition = {
    id: "f4581b53-23a0-4ca6-a77c-97d79e7a6570",
    rarity: "rare",
    name: "Kavu Lair",
    oracleText:
        "Whenever a creature with power 4 or greater enters, its controller draws a card.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "kavu-lair-power-4",
            oracleText:
                "Whenever a creature with power 4 or greater enters, its controller draws a card.",
            scope: "any",
            filter: { types: "Creature" },
            // CR 603.2 / 613.4 (issue #1852) — "power 4 or greater" is read
            // through the layer pipeline: the entering creature's EFFECTIVE
            // power, counters it entered with and anthems already in play
            // included, not its printed characteristic.
            condition: (event, _self, state) =>
                (enteringEffectivePower(event, state) ?? 0) >= 4,
            effects: [
                {
                    op: "draw",
                    player: { ref: "$event.controllerId" },
                    count: 1,
                },
            ],
        }),
    ],
};

// Llanowar Cavalry — {2}{G} Creature — Human Soldier, 1/4. "{W}: This
// creature gains vigilance until end of turn." (CR 613.1f keyword grant.)
export const llanowarCavalry: CardDefinition = {
    id: "21d92191-a743-4916-bbe4-5e207e964d9b",
    rarity: "common",
    name: "Llanowar Cavalry",
    oracleText: "{W}: This creature gains vigilance until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 4,
    activatedAbilities: [
        {
            id: "llanowar-cavalry-vigilance",
            oracleText: "{W}: This creature gains vigilance until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            effects: [
                {
                    op: "grantAbility",
                    ability: "vigilance",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Llanowar Elite — {G} Creature — Elf, 1/1. "Kicker {8}. Trample\nIf this
// creature was kicked, it enters with five +1/+1 counters on it." (CR 702.33
// Kicker; CR 702.19e trample; CR 122.1 ETB counters.) Trample is unconditional
// (own `staticAbilities`, not tied to kicker). Five COUNT-"kicker" entries
// (`entersWith.counters`, CR 702.33e) each read the single, non-multi kicker's
// 0-or-1 paid count and sum — 0 unkicked, 5 kicked — reusing the existing
// per-kick counter primitive five times rather than adding a multiplier field
// (ADR 0045 "generalize, don't add" via repetition, not a new shape).
export const llanowarElite: CardDefinition = {
    id: "3e207863-de68-47e1-8c63-413b5fa48943",
    rarity: "common",
    name: "Llanowar Elite",
    oracleText:
        "Kicker {8} (You may pay an additional {8} as you cast this spell.)\nTrample\nIf this creature was kicked, it enters with five +1/+1 counters on it.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 1,
    toughness: 1,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {8}",
            mana: { X: 8 },
        },
    ],
    staticAbilities: ["trample"],
    entersWith: {
        counters: [
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
        ],
    },
};

// Llanowar Vanguard — {2}{G} Creature — Dryad, 1/1. "{T}: This creature gets
// +0/+4 until end of turn." (CR 613.4c pump.)
export const llanowarVanguard: CardDefinition = {
    id: "72e6ed79-bdfd-49f9-bfa4-be4196880487",
    rarity: "common",
    name: "Llanowar Vanguard",
    oracleText: "{T}: This creature gets +0/+4 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Dryad"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "llanowar-vanguard-pump",
            oracleText: "{T}: This creature gets +0/+4 until end of turn.",
            cost: { tap: true },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 0,
                    toughness: 4,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Might Weaver — {1}{G} Creature — Human Wizard, 2/1. "{2}: Target red or
// white creature gains trample until end of turn." (CR 613.1f keyword grant;
// `colorFilterAny` OR-matches the two colors.)
export const mightWeaver: CardDefinition = {
    id: "032a4ec7-82ce-4ea0-b0dd-ebc40823a014",
    rarity: "uncommon",
    name: "Might Weaver",
    oracleText:
        "{2}: Target red or white creature gains trample until end of turn. (It can deal excess combat damage to the player or planeswalker it's attacking.)",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "might-weaver-trample",
            oracleText:
                "{2}: Target red or white creature gains trample until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["R", "W"],
            },
            effects: [
                {
                    op: "grantAbility",
                    ability: "trample",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Molimo, Maro-Sorcerer — {4}{G}{G}{G} Legendary Creature — Elemental
// Sorcerer, */*. "Trample. Molimo's power and toughness are each equal to the
// number of lands you control." (CR 702.19e trample; CR 613.4b layer 7b
// characteristic-defining P/T.) `pt-cda` compute mirrors the ICE snow-land
// counting CDA (`ice/black.ts`), generalized to every land (no snow filter).
export const molimoMaroSorcerer: CardDefinition = {
    id: "750d3475-ae72-42c1-ae4d-638f8e7c6d1a",
    rarity: "rare",
    name: "Molimo, Maro-Sorcerer",
    oracleText:
        "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nMolimo's power and toughness are each equal to the number of lands you control.",
    manaCost: { X: 4, G: 3 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elemental", "Sorcerer"],
    power: 0,
    toughness: 0,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let lands = 0;
                for (const player of state.players) {
                    for (const card of player.battlefield) {
                        if (
                            card.controllerId === source.controllerId &&
                            card.types.includes("Land")
                        ) {
                            lands++;
                        }
                    }
                }
                return { power: lands, toughness: lands };
            },
        },
    ],
};

// Nomadic Elf — {1}{G} Creature — Elf Nomad, 2/2. "{1}{G}: Add one mana of
// any color." (CR 605.1a mana ability, `useStack: false`.) Runtime colour
// choice via `manaChoices`, the established mana-ability idiom (Standing
// Stones, `drk/colorless.ts`; Celestial Prism, `lea/colorless.ts`).
export const nomadicElf: CardDefinition = {
    id: "3b69e57a-5b19-450c-9cf5-c189e8505781",
    rarity: "common",
    name: "Nomadic Elf",
    oracleText: "{1}{G}: Add one mana of any color.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Nomad"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "nomadic-elf-mana",
            oracleText: "{1}{G}: Add one mana of any color.",
            cost: { mana: { X: 1, G: 1 } },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Pincer Spider — {2}{G} Creature — Spider, 2/3. "Kicker {3}. Reach\nIf this
// creature was kicked, it enters with a +1/+1 counter on it." (CR 702.33
// Kicker; CR 702.17b reach; CR 122.1 ETB counter via `entersWith.counters`,
// CR 702.33e "kicker" count.)
export const pincerSpider: CardDefinition = {
    id: "23271658-19ae-420d-beeb-4bed4fdbb891",
    rarity: "common",
    name: "Pincer Spider",
    oracleText:
        "Kicker {3} (You may pay an additional {3} as you cast this spell.)\nReach (This creature can block creatures with flying.)\nIf this creature was kicked, it enters with a +1/+1 counter on it.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Spider"],
    power: 2,
    toughness: 3,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {3}",
            mana: { X: 3 },
        },
    ],
    staticAbilities: ["reach"],
    entersWith: { counters: [{ type: "+1/+1", count: "kicker" }] },
};

// The five colours a "choose a color" mana-ability picker offers, mirroring
// Kavu Chameleon's `KAVU_CHAMELEON_COLOR_OPTIONS` above and Fertile Ground's
// own copy below (each card keeps its own named const, per file convention).
// Written as an explicit literal list (not `.map`-generated) so each mode's
// `mana` object stays a plain `EffectManaPool` literal, not a computed-key
// type the interpreter's Op union can't narrow.
const QUIRION_SENTINEL_COLOR_MODES: NonNullable<
    Extract<EffectOp, { op: "optionChoice" }>["modes"]
> = [
    {
        label: "Add {W}",
        effects: [{ op: "addMana", player: "controller", mana: { W: 1 } }],
    },
    {
        label: "Add {U}",
        effects: [{ op: "addMana", player: "controller", mana: { U: 1 } }],
    },
    {
        label: "Add {B}",
        effects: [{ op: "addMana", player: "controller", mana: { B: 1 } }],
    },
    {
        label: "Add {R}",
        effects: [{ op: "addMana", player: "controller", mana: { R: 1 } }],
    },
    {
        label: "Add {G}",
        effects: [{ op: "addMana", player: "controller", mana: { G: 1 } }],
    },
];

// Quirion Sentinel — {1}{G} Creature — Elf Druid, 2/1. "When this creature
// enters, add one mana of any color." (CR 603.6a ETB; CR 106.1 mana; CR 700.2
// modal "choose one" skinning the runtime colour pick — `optionChoice` +
// `addMana`, both already-exercised Ops composed as designed, no new Op.)
export const quirionSentinel: CardDefinition = {
    id: "2fc639ea-a925-4f1e-879f-b8fcb12bf257",
    rarity: "common",
    name: "Quirion Sentinel",
    oracleText: "When this creature enters, add one mana of any color.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "quirion-sentinel-etb",
            oracleText: "When this creature enters, add one mana of any color.",
            scope: "self",
            effects: [
                {
                    op: "optionChoice",
                    player: "controller",
                    prompt: "Add one mana of which color?",
                    modes: QUIRION_SENTINEL_COLOR_MODES,
                },
            ],
        }),
    ],
};

// Quirion Trailblazer — {3}{G} Creature — Elf Scout, 1/2. "When this creature
// enters, you may search your library for a basic land card, put that card
// onto the battlefield tapped, then shuffle." (CR 603.6a ETB; CR 401.4
// search, `min: 0` = "you may"; CR 701.24 shuffle.)
export const quirionTrailblazer: CardDefinition = {
    id: "c2b258c1-5fb4-4072-bb32-ad364df1874a",
    rarity: "common",
    name: "Quirion Trailblazer",
    oracleText:
        "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Scout"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "quirion-trailblazer-etb",
            oracleText:
                "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Land", supertype: "Basic" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a basic land card.",
                    bind: "$land",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$land" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                    tapped: true,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        }),
    ],
};

// Serpentine Kavu — {4}{G} Creature — Kavu, 4/4. "{R}: This creature gains
// haste until end of turn." (CR 613.1f keyword grant.)
export const serpentineKavu: CardDefinition = {
    id: "699f1fe8-02c6-4d95-9231-3f8aefe603da",
    rarity: "common",
    name: "Serpentine Kavu",
    oracleText: "{R}: This creature gains haste until end of turn.",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 4,
    toughness: 4,
    activatedAbilities: [
        {
            id: "serpentine-kavu-haste",
            oracleText: "{R}: This creature gains haste until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            effects: [
                {
                    op: "grantAbility",
                    ability: "haste",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Sulam Djinn — {5}{G} Creature — Djinn, 6/6. "Trample. This creature gets
// -2/-2 as long as green is the most common color among all permanents or is
// tied for most common." (CR 702.19e trample; CR 611.2c conditional CDA
// anthem on itself.) Mirrors Zanam Djinn's own colour-census template
// (`inv/blue.ts`), generalized to green.
const SULAM_DJINN_COLORS = ["W", "U", "B", "R", "G"] as const;
function greenIsMostCommonOrTied(
    battlefield: ReadonlyArray<{ colors: readonly string[] }>
): boolean {
    const tally: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const permanent of battlefield) {
        for (const color of permanent.colors) {
            if (color in tally) tally[color]++;
        }
    }
    const green = tally.G;
    return SULAM_DJINN_COLORS.every((c) => tally[c] <= green);
}
export const sulamDjinn: CardDefinition = {
    id: "7aeab16f-e104-47e7-81c7-b6e0123120d7",
    rarity: "uncommon",
    name: "Sulam Djinn",
    oracleText:
        "Trample\nThis creature gets -2/-2 as long as green is the most common color among all permanents or is tied for most common.",
    manaCost: { X: 5, G: 1 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 6,
    toughness: 6,
    staticAbilities: ["trample"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: EFFECT_AFFECTS_SELF,
            condition: (_source, state, ctx) =>
                greenIsMostCommonOrTied(
                    state.players
                        .flatMap((p) => p.battlefield)
                        .map((c) => ({ colors: ctx.getColors(c) }))
                ),
            power: -2,
            toughness: -2,
        },
    ],
};

// Thornscape Apprentice — {G} Creature — Human Wizard, 1/1. "{R}, {T}: Target
// creature gains first strike until end of turn. {W}, {T}: Tap target
// creature." (CR 613.1f keyword grant; CR 701.26 tap.)
export const thornscapeApprentice: CardDefinition = {
    id: "505da522-73a8-4232-ae1a-d3365f3e598f",
    rarity: "common",
    name: "Thornscape Apprentice",
    oracleText:
        "{R}, {T}: Target creature gains first strike until end of turn.\n{W}, {T}: Tap target creature.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "thornscape-apprentice-first-strike",
            oracleText:
                "{R}, {T}: Target creature gains first strike until end of turn.",
            cost: { mana: { R: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "thornscape-apprentice-tap",
            oracleText: "{W}, {T}: Tap target creature.",
            cost: { mana: { W: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
        },
    ],
};

// The five "protection from <color>" modes a runtime colour choice offers —
// routed through the shared `protectionColorModes` helper (`abilities/index.ts`,
// issue #684/#928 dedup) instead of a module-local hand-rolled copy, so it
// carries the `color` tag `PendingChoiceOptions` needs for the `ManaSymbol` icon.
const THORNSCAPE_MASTER_PROTECTION_MODES = protectionColorModes([
    "W",
    "U",
    "B",
    "R",
    "G",
]);

// Thornscape Master — {2}{G}{G} Creature — Human Wizard, 2/2. "{R}{R}, {T}:
// This creature deals 2 damage to target creature. {W}{W}, {T}: Target
// creature gains protection from the color of your choice until end of
// turn." (CR 120.1 damage; CR 613.1f keyword grant; CR 700.2 modal colour
// pick.)
export const thornscapeMaster: CardDefinition = {
    id: "7e8f164d-3782-4eaa-a4db-ab7082d45ee7",
    rarity: "rare",
    name: "Thornscape Master",
    oracleText:
        "{R}{R}, {T}: This creature deals 2 damage to target creature.\n{W}{W}, {T}: Target creature gains protection from the color of your choice until end of turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "thornscape-master-damage",
            oracleText:
                "{R}{R}, {T}: This creature deals 2 damage to target creature.",
            cost: { mana: { R: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
        {
            id: "thornscape-master-protection",
            oracleText:
                "{W}{W}, {T}: Target creature gains protection from the color of your choice until end of turn.",
            cost: { mana: { W: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "optionChoice",
                    player: "controller",
                    prompt: "Grant protection from which color?",
                    modes: THORNSCAPE_MASTER_PROTECTION_MODES,
                },
            ],
        },
    ],
};

// Tranquility — a reprint of the LEA original already implemented as
// `tranquility` in `sets/lea/green.ts` (id 774cc5a6-…). ADR 0043/0014: a
// cross-set reprint is a `CardPrint` referencing the original
// `CardDefinition`, not a duplicate definition (precedent: Soul Burn,
// `inv/black.ts`).
export const tranquilityInv: CardPrint = {
    printId: "97019ba5-ce2a-460c-8a4e-2b22053ced65", // INV Tranquility
    definitionId: "774cc5a6-3a69-4812-add4-eb5eb6389238", // LEA Tranquility
    setCode: "inv",
    rarity: "common",
};

// Treefolk Healer — {4}{G} Creature — Treefolk Cleric, 2/3. "{2}{W}, {T}:
// Prevent the next 2 damage that would be dealt to any target this turn."
// (CR 615.1 prevention shield.)
export const treefolkHealer: CardDefinition = {
    id: "73c6f5c0-686d-4b3a-add7-487f9fff5faa",
    rarity: "uncommon",
    name: "Treefolk Healer",
    oracleText:
        "{2}{W}, {T}: Prevent the next 2 damage that would be dealt to any target this turn.",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk", "Cleric"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "treefolk-healer-prevent",
            oracleText:
                "{2}{W}, {T}: Prevent the next 2 damage that would be dealt to any target this turn.",
            cost: { mana: { X: 2, W: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Utopia Tree — {1}{G} Creature — Plant, 0/2. "{T}: Add one mana of any
// color." (CR 605.1a mana ability, `useStack: false`.) Same `manaChoices`
// idiom as Nomadic Elf above.
export const utopiaTree: CardDefinition = {
    id: "720452e9-3245-4b0e-94b6-843cbcb641a5",
    rarity: "rare",
    name: "Utopia Tree",
    oracleText: "{T}: Add one mana of any color.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "utopia-tree-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Wallop — {1}{G} Sorcery. "Destroy target blue or black creature with
// flying." (CR 701.8 destroy; `colorFilterAny` OR-matches the two colors,
// `requireAbility` ANDs the flying requirement.)
export const wallop: CardDefinition = {
    id: "45ce5126-e7b1-41ab-9e56-1e12927c4d27",
    rarity: "uncommon",
    name: "Wallop",
    oracleText: "Destroy target blue or black creature with flying.",
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        colorFilterAny: ["U", "B"],
        requireAbility: "flying",
    },
    effects: [{ op: "destroy", target: { target: 0 } }],
};

// Whip Silk — {G} Enchantment — Aura, enchant creature. "Enchanted creature
// has reach. {G}: Return this Aura to its owner's hand." (CR 702.17b reach
// keyword grant; CR 400.7 self-bounce via `moveZone`'s `$source` snapshot
// shape.)
export const whipSilk: CardDefinition = {
    id: "10566804-fd15-4ef0-ad7d-cc979f4cc8c5",
    rarity: "common",
    name: "Whip Silk",
    oracleText:
        "Enchant creature\nEnchanted creature has reach. (It can block creatures with flying.)\n{G}: Return this Aura to its owner's hand.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "reach",
        },
    ],
    activatedAbilities: [
        {
            id: "whip-silk-return",
            oracleText: "{G}: Return this Aura to its owner's hand.",
            cost: { mana: { G: 1 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};

// fertileGround — INV reprint of the Urza's Saga definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `usg/green.ts`.
export const fertileGroundInv: CardPrint = {
    printId: "789e3582-b541-4916-ac7e-015214d7a27a", // INV 180
    definitionId: "091dda35-59e5-456d-8804-61513a610aed", // fertileGround (Urza's Saga)
    setCode: "inv",
    rarity: "common",
};

// Kavu Titan — {1}{G} Creature — Kavu, 2/2. "Kicker {2}{G}. If this creature
// was kicked, it enters with three +1/+1 counters on it and with trample."
// The counters half composes via three `entersWith.counters` entries each
// `count: "kicker"` (see Llanowar Elite / Pincer Spider above).
//
// FREED 2026-08-25 (#1841 audit, shipped by #2761): the old marker read "the
// conditional PERMANENT trample grant has no declarative path —
// `grantAbility`'s `duration` is mandatory". WRONG at HEAD — but the CORRECT
// fix is not the `grantAbility` Op either: CR 614.1c/614.12 makes "if this
// creature was kicked, it enters with ... and with trample" ONE replacement
// effect governing how the object enters — exactly like the counters half,
// which is already `entersWith.counters` (a replacement, NOT a `PERMANENT_
// ENTERED` triggered ability carrying a `counters` Op — that shape is a bug,
// issue #1693) rather than a stack-based trigger. Wiring the ability grant as
// an `enteredTrigger` would reopen the identical bug for keywords: a window
// where the creature is on the battlefield without trample before the trigger
// resolves. The already-shipped, CR-exact, and simpler fix is Pouncing Kavu's
// OWN template (`inv/red.ts`, issue #1716): a `staticEffects` `keyword-grant`
// gated on `CardInstanceState.wasKicked` — a one-shot fact fixed at CR 614.1c
// ETB replacement time, materialized into `staticAbilities` continuously, no
// stack window. Same correction applies to Faerie Squadron (`inv/blue.ts`),
// which carried the identical wrong claim.
export const kavuTitan: CardDefinition = {
    id: "2c5fb86d-1d9a-4da2-bb5b-4266faa20197",
    name: "Kavu Titan",
    rarity: "rare",
    oracleText:
        "Kicker {2}{G} (You may pay an additional {2}{G} as you cast this spell.)\nIf this creature was kicked, it enters with three +1/+1 counters on it and with trample.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}{G}",
            mana: { X: 2, G: 1 },
        },
    ],
    entersWith: {
        counters: [
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
            { type: "+1/+1", count: "kicker" },
        ],
    },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id === source.id && target.wasKicked === true,
            keyword: "trample",
        },
    ],
};

// Rooting Kavu — {2}{G}{G} Creature — Kavu, 4/3. "When this creature dies,
// you may exile it. If you do, shuffle all creature cards from your graveyard
// into your library."
//
// FREED 2026-08-25 (#1841 audit, shipped by #2761) — the RE-AUDIT this marker
// asked for was done and the "you may exile it" half's `mayPay`-with-no-cost
// gate (issue #680) and the bulk graveyard-set move's selector
// (`EffectForEachSelector`'s `{ set: "graveyard", controller?, filter? }`,
// issue #1056) are both genuinely shipped. But the marker's PROPOSED DSL shape
// — `mayPay` → `exileSelf` → `forEach { set: "graveyard" }` — does not
// actually reach this card: `exileSelf` redirects the CURRENTLY-RESOLVING
// SPELL's own post-resolution destination (CR 608.2m); it is a no-op for an
// ABILITY (there is no spell card to redirect — see its own registry note,
// `mechanicsRegistry.ts`). "You may exile IT" here means the creature that
// JUST DIED, whose last-known-information the DSL interpreter's `effects[]`
// path cannot read at all (`diedTrigger`'s own doc: the `DeadCreatureLKI`
// payload is "NOT reachable from the script"; even the implicit `$source`
// binding fails closed, since `resolveObjectRef` only finds a snapshot ref
// still on the BATTLEFIELD, and by the time a death trigger resolves the
// creature is already in the graveyard, CR 700.4). So this stays a
// `resolve()` (protocol card, gre-development.md § DSL-first authoring) that
// exiles the LKI'd graveyard card by id (`SpellContext.moveCardById`) rather
// than the DSL `exileSelf`/`forEach` composition the old marker sketched.
// Exiling Rooting Kavu FIRST (before scanning the graveyard) matters: it must
// not sweep itself into "all creature cards from your graveyard" a second
// time.
export const rootingKavu: CardDefinition = {
    id: "12c25a4c-d93a-402b-999f-0b9919123cc5",
    name: "Rooting Kavu",
    rarity: "uncommon",
    oracleText:
        "When this creature dies, you may exile it. If you do, shuffle all creature cards from your graveyard into your library.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 4,
    toughness: 3,
    triggeredAbilities: [
        diedTrigger({
            id: "rooting-kavu-exile-shuffle",
            oracleText:
                "When this creature dies, you may exile it. If you do, shuffle all creature cards from your graveyard into your library.",
            scope: "self",
            resolve: (ctx, _event, deadCreature) => {
                const paid = ctx.requestMayPay({
                    playerId: deadCreature.controllerId,
                    choiceId: `rooting-kavu-exile-${deadCreature.id}`,
                    prompt: "Exile Rooting Kavu?",
                });
                if (paid === undefined) return; // suspended for the decision
                if (!paid) return;
                ctx.moveCardById(
                    deadCreature.controllerId,
                    deadCreature.id,
                    "graveyard",
                    "exile"
                );
                const creatureCards = ctx
                    .getGraveyardCards(deadCreature.controllerId)
                    .filter((c) => c.types.includes("Creature"));
                for (const card of creatureCards) {
                    ctx.moveCardById(
                        deadCreature.controllerId,
                        card.id,
                        "graveyard",
                        "library"
                    );
                }
                ctx.shuffleLibrary(deadCreature.controllerId);
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — bare `resolve()`
            // trigger (the graveyard-set move has no Effect Op reading LKI),
            // so the bot's value model has nothing to walk without a shadow
            // script. Approximates the real effect as exiling the source —
            // the valuer's main signal is "this creature's death is one-shot,
            // not a recurring graveyard resource," which a bare `exileSelf`
            // shadow already conveys without needing the library-shuffle
            // side effect modeled.
            aiEffects: [{ op: "exileSelf" }],
        }),
    ],
};

// Saproling Symbiosis — the CR 601.3c conditional-flash rider (issue #2146),
// shipped as `flashSurcharge`: legal to ANNOUNCE at any priority, with the {2}
// charged mandatorily only when the cast lands outside the caster's own
// sorcery-speed window. The token half is `createToken` with a DYNAMIC
// `count` — the same `EffectCount` shape Pygmy Kavu's `draw` uses
// (`pls/green.ts`) — counting the caster's own battlefield creatures at
// RESOLUTION (CR 608.2), so a creature that died in response reduces the
// count. Token art resolves from the committed Scryfall reverse-link
// (`generated/token-prints.json`) keyed by this card's id + "Saproling", the
// same 1/1 green Saproling the other INV producers use; no `imagePrintId` is
// hand-pinned.
export const saprolingSymbiosis: CardDefinition = {
    id: "2bb63748-5c84-43a0-8f17-a2a17f658337",
    name: "Saproling Symbiosis",
    rarity: "rare",
    oracleText:
        "You may cast this spell as though it had flash if you pay {2} more to cast it. Create a 1/1 green Saproling creature token for each creature you control.",
    manaCost: { X: 3, G: 1 },
    types: ["Sorcery"],
    flashSurcharge: { X: 2 },
    effects: [
        {
            op: "createToken",
            controller: "controller",
            count: {
                count: {
                    zone: "battlefield",
                    controller: "controller",
                    filter: { type: "Creature" },
                },
            },
            token: {
                name: "Saproling",
                types: ["Creature"],
                subtypes: ["Saproling"],
                power: 1,
                toughness: 1,
                colors: ["G"],
            },
        },
    ],
};

// Thicket Elemental — "Kicker {1}{G}. When this creature enters, if it was
// kicked, you may reveal cards from the top of your library until you
// reveal a creature card. If you do, put that card onto the battlefield and
// shuffle all other cards revealed this way into your library." The
// `kickerCount`-persistence gap this comment originally cited (same root
// cause as Benalish Emissary, `inv/white.ts`) closed with
// `CardInstanceState.wasKicked` (issue #1753) — see Benalish Emissary /
// Verduran Emissary above, shipped off issue #1328. Thicket Elemental itself
// stays a stub: its "reveal until a creature card" clause is not expressible
// by the fixed-count `reveal` Op (`types.ts`), and no other primitive covers
// an unbounded reveal-until sweep today — the nearest precedent, Cascade (CR
// 702.85), is itself registry `status: "planned"`. Genuinely separate,
// previously-uncaught gap; split out to its own tracked issue rather than
// blocking the other 5 cards in #1328's slice.
// tracked-by: #2058
// export const thicketElemental: CardDefinition = {
//     id: "f80a56ed-3ebb-4e20-bf6a-e27127f762e8",
//     name: "Thicket Elemental",
//     rarity: "rare",
//     manaCost: { X: 3, G: 2 },
//     types: ["Creature"],
// };

// Verduran Emissary — {2}{G} Creature — Human Wizard, 2/3. "Kicker {1}{R}.
// When this creature enters, if it was kicked, destroy target artifact. It
// can't be regenerated." (CR 702.33 Kicker, CR 603.6a ETB trigger with a CR
// 603.3d target announcement, CR 701.19c regeneration shield suppression.)
//
// VERIFIED against Scryfall (`cards/named?exact=Verduran+Emissary&set=inv`,
// id `55f3361b-e2e7-4297-85c2-94323f90cc90`): kicker cost is `{1}{R}`, NOT
// `{1}{G}` — this card's kicker splashes red, its casting cost is the only
// green pip. The stub above already had this right; do not "correct" it to
// `{1}{G}` (mono-green would be wrong per Scryfall and per MTGJSON's
// `identifiers.scryfallId`-keyed INV.json entry, both cross-checked here).
//
// Closed by issue #1328 (capability slice, decomposed from #1086): same
// `CardInstanceState.wasKicked` fix as Benalish Emissary (`inv/white.ts`),
// same Waterspout Elemental (`pls/blue.ts`) template —
// `conditionOnSelf: additionalCostPaidCondition("kicker")` at check time, `if {
// additionalCostPaid: "kicker" }` inside `effects[]` at resolution time, no
// `interveningIf`. The resolution-time branch reads the RESOLVING STACK
// ITEM's own `kickerPayments`, which is what still gates an ability COPY put
// on the stack without re-running `matches` (CR 707.10) — an `interveningIf`
// would not, and that, not blink safety, is why the pair is the template (see
// Benalish Emissary, `inv/white.ts`, and `additionalCostPaidCondition` in
// `cards/abilities/triggers/shared.ts`).
// `destroy`'s `cantBeRegenerated: true` (ADR 0053) is the
// direct Op passthrough for "It can't be regenerated" — the second half of
// the original blocker (no Op option existed) closed alongside Obliterate
// (`inv/red.ts`, issue #831).
export const verduranEmissary: CardDefinition = {
    id: "55f3361b-e2e7-4297-85c2-94323f90cc90", // INV 221
    rarity: "uncommon",
    name: "Verduran Emissary",
    oracleText:
        "Kicker {1}{R} (You may pay an additional {1}{R} as you cast this spell.)\nWhen this creature enters, if it was kicked, destroy target artifact. It can't be regenerated.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 3,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {1}{R}",
            mana: { X: 1, R: 1 },
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "verduran-emissary-kicked",
            oracleText:
                "When this creature enters, if it was kicked, destroy target artifact. It can't be regenerated.",
            scope: "self",
            // CR 603.4 check-time gate — see the card-level comment.
            conditionOnSelf: additionalCostPaidCondition("kicker"),
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "kicker" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "destroy",
                            target: { target: 0 },
                            cantBeRegenerated: true,
                        },
                    ],
                },
            ],
        }),
    ],
};

// Canopy Surge — "Kicker {2}. Canopy Surge deals 1 damage to each creature
// with flying and each player. If this spell was kicked, it deals 4 damage
// to each creature with flying and each player instead." (CR 702.33 Kicker;
// CR 120.1 damage to each creature/player.) Unblocked by issue #1097's
// `EffectCardFilter.hasAbility` field (`convex/cards/types.ts`) — "each
// creature WITH FLYING" is now `filter: { type: "Creature", hasAbility:
// "flying" }` on a `forEach { set: "permanents" }` selector, propagated onto
// `PermanentFilter.requireAbility` by `toPermanentFilter`
// (`convex/gre/effects/interpreter.ts`), which already reads the LIVE/
// materialized `staticAbilities` array (a keyword GRANT, e.g. an Aura giving
// flying, is spliced directly into it — CR 611/113.1 — so a granted flying is
// hit exactly like printed flying). The "if kicked, 4 instead of 1" branch is
// the standard `{ kickerCount: true } >= 1` gate (Overload, `inv/red.ts`);
// each branch pairs a creature-flying sweep with a `forEach { set: "players"
// }` sweep, both feeding the SAME already-exercised `dealDamage` Op — no new
// Op, just the new filter field.
export const canopySurge: CardDefinition = {
    id: "2e19d68e-7554-4627-a316-beb1f75fa494",
    rarity: "uncommon",
    name: "Canopy Surge",
    oracleText:
        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nCanopy Surge deals 1 damage to each creature with flying and each player. If this spell was kicked, it deals 4 damage to each creature with flying and each player instead.",
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}",
            mana: { X: 2 },
        },
    ],
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature", hasAbility: "flying" },
                    },
                    effects: [
                        { op: "dealDamage", amount: 4, to: { ref: "$each" } },
                    ],
                },
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 4,
                            to: { player: { ref: "$each" } },
                        },
                    ],
                },
            ],
            else: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature", hasAbility: "flying" },
                    },
                    effects: [
                        { op: "dealDamage", amount: 1, to: { ref: "$each" } },
                    ],
                },
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: { player: { ref: "$each" } },
                        },
                    ],
                },
            ],
        },
    ],
};

// Elfhame Sanctuary — "At the beginning of your upkeep, you may search your
// library for a basic land card, reveal that card, put it into your hand,
// then shuffle. If you do, you skip your draw step this turn." (CR 603.6a
// upkeep trigger; 117.3a/608.2b cost-free "you may"; 701.19 search/reveal;
// 504.1 draw-step skip, issue #1097.)
//
// The "you may … if you do" gate is the pre-existing cost-free `mayPay`
// (issue #680) + `if` shape (Formidable Speaker, `ecl/green.ts`) — bind
// `$searched` on the bare may-decision, then gate the WHOLE search/reveal/
// hand/shuffle/skip sequence on it. "If you do" is the entire preceding
// compound action (searching — even one that finds no basic land — reveals,
// puts into hand, and shuffles), NOT "if you found a land": the skip fires
// whenever the player chooses to search, mirroring how Formidable Speaker's
// own "if you do" gates on having discarded, not on finding a creature.
//
// The remaining gap (issue #1097) was "skip your draw step this turn" itself:
// no `skipDrawStepThisTurn` flag/primitive existed anywhere in `GameState`/
// `phases.ts`. Closed by a new one-shot per-player `GameState
// .skipDrawStepThisTurn` array (`SpellContext.skipDrawStepThisTurn`, the
// `skipDrawStepThisTurn` Op) armed here at upkeep and consumed by
// `advancePhase` (`gre/phases.ts`) the next time this player's DRAW step is
// entered, later the SAME turn — per CR 500.8 the whole step is skipped (no
// draw, no beginning-of-step triggers), not merely the draw. Kept
// DELIBERATELY SEPARATE from the one existing
// draw-step-skip precedent, Fasting (`drk/white.ts`, CR 504/614): Fasting is
// a STATIC per-card `drawStepReplacement` flag re-checked every turn, which
// hands off to its OWN DRAW-phase trigger for an INTERACTIVE may-skip choice
// made AT the draw step itself (the choice AND the skip happen at the same
// step). Elfhame Sanctuary's skip is already DECIDED at upkeep — nothing is
// asked again at the draw step — so unifying it with Fasting's replacement
// shape would mean inventing a fake "replacement" with no choice to offer,
// contorting a different mechanic to fit. A plain armed flag consumed
// directly is the honest shape for "if you do [something earlier], you skip
// [a later step] — no further decision".
export const elfhameSanctuary: CardDefinition = {
    id: "6ab9a90c-5fd8-4f8c-b692-f98a2974810c",
    name: "Elfhame Sanctuary",
    rarity: "uncommon",
    oracleText:
        "At the beginning of your upkeep, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle. If you do, you skip your draw step this turn.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "elfhame-sanctuary-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle. If you do, you skip your draw step this turn.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Search your library for a basic land card? If you do, you skip your draw step this turn.",
                    bind: "$searched",
                },
                {
                    op: "if",
                    predicate: { binding: "$searched" },
                    then: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: { type: "Land", supertype: "Basic" },
                            count: { min: 0, max: 1 },
                            prompt: "Search your library for a basic land card.",
                            bind: "$found",
                        },
                        {
                            op: "reveal",
                            player: "controller",
                            cards: { ref: "$found" },
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found" },
                            player: "controller",
                            from: "library",
                            to: "hand",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                        { op: "skipDrawStepThisTurn", player: "controller" },
                    ],
                },
            ],
        }),
    ],
};

// Pulse of Llanowar — "If a basic land you control is tapped for mana, it
// produces mana of a color of your choice instead of any other type." A
// mana-TYPE-CHANGE replacement (not an addition like Fertile Ground/Wild
// Growth) scoped to every basic land the controller taps, with a per-tap
// runtime colour choice substituting for the land's normal output — no
// existing primitive replaces a land's produced mana type, only adds to it
// or fixes it (`addManaTo`) or restricts its spend (`addRestrictedMana`).
//
// Confirmed still blocked (issue #1097 gap 4/3 pass, deliberately deferred —
// a smaller correct PR beats a large speculative one). Gap 4 (Quirion Elves)
// closed via the EXISTING `manaChoices`/`getManaChoices` board-conditional-
// choice machinery, but that machinery only ever attaches to a PRINTED
// `ActivatedAbility` on the tapped permanent ITSELF. Pulse of Llanowar needs
// to retrofit a choice onto every BASIC LAND'S intrinsic subtype-mana tap —
// which `getManaTapOptionsDetailed` (`gre/constants.ts`) currently emits as
// ONE fixed `{ [color]: 1 }` entry per distinct basic subtype
// (`{ kind: "basic"; subtype }` in `ManaTapOptionSource` — "has no riders",
// per its own doc comment) with no choice branch at all. Closing this
// properly needs: (1) a new choice-bearing shape for the "basic" provenance
// kind (today it carries only `subtype`, never a colour option list); (2) a
// matching branch in `resolveManaTapChoice` (`convex/game.ts`) to resolve the
// picked colour; (3) `getProducibleColors`/`producibleColorsFromAbilities`
// (CR 106.4 "could produce") updated so deck-analysis / castability callers
// see "any colour" while Pulse is in play, not just the land's printed
// colour; (4) the CLIENT tap picker (`src/lib/card-utils.ts`, which shares
// the same resolver) exercising a picker for BASIC lands, which it has never
// needed to do before. That is real, cross-cutting engine surface for one
// uncommon enchantment — out of scope for this pass.
// tracked-by: #2139
// export const pulseOfLlanowar: CardDefinition = {
//     id: "db09afe5-5f01-4f77-a239-12d7a6e59024",
//     name: "Pulse of Llanowar",
//     rarity: "uncommon",
//     manaCost: { X: 3, G: 1 },
//     types: ["Enchantment"],
// };

// quirionElvesInv — INV reprint of the Mirage definition (CardPrint, ADR
// 0041). First printed in Mirage — the mechanics (closing issue #1097 gap 4:
// the ETB colour choice + two mana abilities) live in `mir/green.ts`,
// authored against THIS printing (issue #1097's INV free-tranche audit is
// where the gap was originally surfaced). Behaviour tests stay with this INV
// tranche (`inv/__tests__/green.test.ts`), importing the definition from its
// home module.
export const quirionElvesInv: CardPrint = {
    printId: "c660a748-82a9-4d6a-8023-56aeafe1bdce", // INV 203
    definitionId: "be9a64fb-1e8d-4ed8-b4c5-3d44db9c1d3b", // Quirion Elves (Mirage)
    setCode: "inv",
    rarity: "common",
};

// Restock — "Return two target cards from your graveyard to your hand.
// Exile Restock." (CR 400.7 zone change; CR 608.2 "Exile ~".) The return
// clause is the standard Regrowth-shaped `moveZone` pair (`lea/green.ts`);
// "Exile Restock" is unblocked by issue #1097's new `exileSelf` Op
// (`convex/cards/types.ts`) — a thin declarative skin over the pre-existing
// `SpellContext.exileSelf()` primitive (Recall, `leg/blue.ts`, `resolve()`),
// now wired into the interpreter so a DSL card can redirect its own
// resolution destination from the graveyard to exile.
export const restock: CardDefinition = {
    id: "11a013ff-7c99-445a-b9e0-0fc45036f068",
    rarity: "rare",
    name: "Restock",
    oracleText:
        "Return two target cards from your graveyard to your hand. Exile Restock.",
    manaCost: { X: 3, G: 2 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "card",
        count: 2,
        zone: "graveyard",
        controller: "you",
    },
    effects: [
        { op: "moveZone", target: { target: 0 }, to: "hand" },
        { op: "moveZone", target: { target: 1 }, to: "hand" },
        { op: "exileSelf" },
    ],
};

// Saproling Infestation — {1}{G} Enchantment. "Whenever a player kicks a
// spell, you create a 1/1 green Saproling creature token."
//
// The first and so far only consumer of the `SPELL_KICKED` GameEvent
// (CR 702.33d, issue #1097), emitted per KICK from the single cast choke point
// `emitSpellCastEvent` (`gre/state.ts`) via `buildSpellKickedEvents`
// (`gre/kicker.ts`). Three properties of that event decide this card's
// behaviour, none of them expressible on the ability itself:
//
//  - **Once per KICK, not per spell** (CR 702.33d — a spell with two Kickers
//    or with Multikicker "may be kicked multiple times"). Kicking a
//    Multikicker spell three times makes THREE Saprolings, as three separate
//    trigger objects on the stack. The ability is a plain per-event trigger,
//    so it inherits that for free — deliberately NOT `oncePerEventBatch`.
//  - **Symmetric** (CR 603.2). "A player" = either player's kick fires it; the
//    ability's own controller ("you") always gets the token, which is what the
//    `"controller"` selector already means at a trigger site. `matches` needs
//    no filter beyond the event type.
//  - **Casting only** (CR 707.10). A COPY of a kicked spell makes no Saproling:
//    the copy is kicked, but no player kicked it, and the copy never reaches
//    the cast choke point that emits.
//
// Token art resolves automatically from the committed Scryfall reverse-link
// (`generated/token-prints.json`) keyed by this card's own id + the token
// name, so no `imagePrintId` is hand-pinned. Invasion itself printed NO
// tokens, so the lockfile maps this card to a same-characteristics substitute
// (a 1/1 green Saproling from a modern printing) — the token/emblem art rule's
// documented fallback, and the same print the other INV Saproling producers
// (`inv/multicolor.ts`) already resolve to. Spec matches theirs.
export const saprolingInfestation: CardDefinition = {
    id: "8642e530-914c-4149-944a-c4966ee27299",
    name: "Saproling Infestation",
    rarity: "rare",
    oracleText:
        "Whenever a player kicks a spell, you create a 1/1 green Saproling creature token.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "saproling-infestation-kicked",
            oracleText:
                "Whenever a player kicks a spell, you create a 1/1 green Saproling creature token.",
            event: "SPELL_KICKED",
            // CR 603.2 — no filter: ANY player kicking ANY spell fires it.
            // The event only exists for a genuine kick (the emitter is
            // declaration-gated and cast-gated), so the type check is the
            // whole condition.
            matches: (event) => event.type === "SPELL_KICKED",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Saproling",
                        types: ["Creature"],
                        subtypes: ["Saproling"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                    },
                    controller: "controller",
                },
            ],
        },
    ],
};

// Scouting Trek — "Search your library for any number of basic land cards,
// reveal those cards, then shuffle and put them on top." The capability gap
// this stub was originally filed for (a SUBSET shuffle, CR 701.24b) no
// longer exists: `moveZone { to: "library-top" }` (issue #1125) relocates
// the picked ids from anywhere in the library onto the top AFTER a preceding
// `libraryLook { action: "shuffle" }`, which the Op's own doc comment records
// as equivalent to CR 701.24b's "all the cards except those are shuffled",
// and it preserves PICK order (CR 401.4). Mystical Tutor (`mir/blue.ts`) is
// the reference composition; "any number" is the shipped
// `count: { min: 0, max: Number.MAX_SAFE_INTEGER }` convention (Skyship
// Weatherlight, `pls/colorless.ts`). What is left is a pure card ship whose
// only untested edge is a PLURAL pick on the `library-top` path.
// tracked-by: #2140
// export const scoutingTrek: CardDefinition = {
//     id: "1b882e68-5c03-4ec6-9982-8c3b09847969",
//     name: "Scouting Trek",
//     rarity: "uncommon",
//     manaCost: { X: 1, G: 1 },
//     types: ["Sorcery"],
// };

// Tangle — "Prevent all combat damage that would be dealt this turn. Each
// attacking creature doesn't untap during its controller's next untap
// step." (CR 615 damage prevention; CR 508.1/502.1 untap-step lock, issue
// #1097.)
//
// The prevention half is the already-shipped `preventDamage` mode
// "all-combat" (Fog precedent). The untap-lock half's Op, `skipNextUntap`
// (CR 302.6/502.1, PRD #795 — Barl's Cage, `drk/colorless.ts`), ALSO already
// shipped and explicitly supports a `forEach` `$each` target — it is NOT the
// gap the original issue text named. `lockUntap` (`EFFECT_OP_BACKLOG`,
// `mechanicsRegistry.ts`) is a DIFFERENT, still-`planned` mechanic: the
// CONTINUOUS source-linked "doesn't untap AS LONG AS … remains tapped" (CR
// 502.3), not Tangle's ONE-SHOT "doesn't untap during its controller's NEXT
// untap step" — registering `lockUntap` for this card would have been the
// wrong name for the wrong mechanic. The actual remaining gap was narrower:
// `EffectCardFilter` (the `forEach` battlefield selector's filter) had no
// combat-role field, so "each creature that's ATTACKING" couldn't be
// expressed — the same shape of gap Canopy Surge's `hasAbility` field closed
// for "each creature WITH FLYING" (issue #1097). Closed the same way: a new
// `isAttacking` filter field (mirrors `PermanentFilter.isAttacking`,
// `convex/cards/filters.ts`, already read by combat-scoped choice pickers),
// not a new Op — `forEach` selects the live attacking set, and each member
// feeds the SAME already-exercised `skipNextUntap` Op via `{ ref: "$each" }`.
export const tangle: CardDefinition = {
    id: "6b37e39c-8aa4-4938-a492-7dac5de98dfb",
    name: "Tangle",
    rarity: "uncommon",
    oracleText:
        "Prevent all combat damage that would be dealt this turn.\nEach attacking creature doesn't untap during its controller's next untap step.",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    effects: [
        { op: "preventDamage", mode: "all-combat" },
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", isAttacking: true },
            },
            effects: [{ op: "skipNextUntap", target: { ref: "$each" } }],
        },
    ],
};

// Verdeloth the Ancient — "Kicker {X}. Saproling creatures and other
// Treefolk creatures get +1/+1. When Verdeloth enters, if it was kicked,
// create X 1/1 green Saproling creature tokens." The anthem is buildable
// (`pt-buff` OR-filtered by subtype), but "Kicker {X}" is a VARIABLE-cost
// kicker: per CR 107.3a a spell announces ONE X that its mana cost AND every
// additional cost share, so the engine's existing per-cast `chosenX` is the
// right model — but the Kicker path never sees it. `foldKickerCosts`
// (`gre/kicker.ts`) calls `normalizeManaCost(kicker.mana)` with no options,
// and the cast dialog's X stepper is gated on the PRINTED cost, which
// Verdeloth's is not. Distinct from the ordinary
// `entersWith.counters[count: "kicker"]` shape used elsewhere in this file,
// which reads a FIXED per-kick count, not a caster-chosen X.
// tracked-by: #2141
// export const verdelothTheAncient: CardDefinition = {
//     id: "72d5fab1-fa20-4006-b19d-179d36238c9b",
//     name: "Verdeloth the Ancient",
//     rarity: "rare",
//     manaCost: { X: 4, G: 2 },
//     types: ["Creature"],
// };

// Vigorous Charge — "Kicker {W}. Target creature gains trample until end of
// turn. Whenever that creature deals combat damage this turn, if this spell
// was kicked, you gain life equal to that damage." The trample grant is
// free, but "whenever THAT CREATURE deals combat damage THIS TURN" needs a
// `delayedTrigger` timing keyed to a repeating damage-dealt-by-a-specific-
// permanent event, and `DelayedTriggerTiming` has no such member: the two
// nearest members each hold half of it —
// `this-turn-creature-deals-combat-damage-to-player` (#1199) repeats but is
// scoped by scheduling CONTROLLER, matches player targets only and collapses
// a whole damage batch into one firing; `attacks-unblocked` (#2117) is
// instance-scoped via `watch` but one-shot and forbids `$event` in its body
// (which "life equal to that damage" must read).
// tracked-by: #2142
// export const vigorousCharge: CardDefinition = {
//     id: "af6f57ad-d370-4c81-8da0-c15d87725ab1",
//     name: "Vigorous Charge",
//     rarity: "common",
//     manaCost: { G: 1 },
//     types: ["Instant"],
// };
