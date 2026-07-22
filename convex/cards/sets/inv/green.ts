// Invasion (INV) — green cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).

import type {
    CardDefinition,
    CardPrint,
    Color,
    EffectOp,
    StaticKeywordGrant,
} from "../../types";
import { AURA_AFFECTS_HOST, EFFECT_AFFECTS_SELF } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";

// Blurred Mongoose — "This spell can't be countered. Shroud (This creature
// can't be the target of spells or abilities.)" (CR 701.5c can't-be-countered
// flag, issue #1065; CR 702.18 Shroud.)
//
// The registry's `staticAbilities: ["shroud"]` string is decorative on its
// own (`mechanicsRegistry.ts` — "shroud" is registry status "planned": no
// engine path derives real target-illegality from the bare keyword string
// generically). The established per-card pattern for a printed Shroud/self-
// guard clause (Lurker `drk/green.ts`, Spectral Cloak `leg/blue.ts`) is an
// explicit `permanent-guard` static effect scoped to the permanent itself
// (`target.id === source.id`) — unconditional and unfiltered here (unlike
// Lurker's combat-gated version), matching CR 702.18's unqualified "can't be
// the target of spells or abilities."
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

// The five basic colours a "becomes the color of your choice" effect may
// pick, mirroring Shyft's mono-colour reading of "color or colors of your
// choice"-style effects (`ice/blue.ts` SHYFT_COLOR_OPTIONS) — Kavu
// Chameleon's oracle text is already single-colour ("the color", not "color
// or colors"), so no simplification is needed here.
const KAVU_CHAMELEON_COLOR_OPTIONS: { id: Color; label: string }[] = [
    { id: "W", label: "White" },
    { id: "U", label: "Blue" },
    { id: "B", label: "Black" },
    { id: "R", label: "Red" },
    { id: "G", label: "Green" },
];

// Kavu Chameleon — "This spell can't be countered. {G}: This creature
// becomes the color of your choice until end of turn." (CR 701.5c can't-be-
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
                    modes: KAVU_CHAMELEON_COLOR_OPTIONS.map((option) => ({
                        id: option.id,
                        label: option.label,
                        effects: [
                            {
                                op: "setColor",
                                target: { ref: "$source" },
                                colors: [option.id],
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    })),
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Wandering Stream — {2}{G} Sorcery. "Domain — You gain 2 life for each
// basic land type among lands you control." (CR 119.3a life gain, CR 702
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
// can't be targeted.) Draw a card." (CR 701.5a counter; CR 605.3a mana
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
// toughness; CR 702.13c forestwalk evasion.) Group `keyword-grant` mirrors
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
    kicker: { cost: { X: 5 } },
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

// Harrow — {2}{G} Instant. "As an additional cost to cast this spell,
// sacrifice a land. Search your library for up to two basic land cards, put
// them onto the battlefield, then shuffle." (CR 601.2b / 117.9 additional
// sacrifice cost; CR 401.4 search; CR 701.20 shuffle.)
export const harrow: CardDefinition = {
    id: "ed0f633e-7238-4d02-ad8b-06dd20453030",
    rarity: "common",
    name: "Harrow",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a land.\nSearch your library for up to two basic land cards, put them onto the battlefield, then shuffle.",
    manaCost: { X: 2, G: 1 },
    types: ["Instant"],
    additionalCosts: { sacrificeFilter: { types: "Land" } },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Land", supertype: "Basic" },
            count: { min: 0, max: 2 },
            prompt: "Search your library for up to two basic land cards.",
            bind: "$lands",
        },
        {
            op: "moveZone",
            cards: { ref: "$lands" },
            player: "controller",
            from: "library",
            to: "battlefield",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
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
// NOT DSL-migratable (ADR 0045): the recipient is the ENTERING creature's
// controller, not this permanent's controller — `enteredTrigger`'s `effects`
// site always binds `ctx.controller` to the SOURCE's controller by design
// (documented on `EnteredTriggerArgs.effects`, `enteredTrigger.ts`), so a
// cross-player payout needs the factory's `resolve` callback, which is handed
// the raw event/`EnteredPermanentInfo` (`entered.controllerId`) precisely for
// this shape. Not "the Op doesn't exist" — the DSL site's controller binding
// is fixed by design; `resolve` is the sanctioned escape for an event-field
// player ref (mirrors the `PERMANENT_TAPPED`-trigger precedent documented on
// Wild Growth, `lea/green.ts`).
// Blocked on: `enteredTrigger`'s `effects[]` site has no entering-permanent
// controller binding (protocol-adjacent factory limitation, not a missing
// Op). Power is read from the trigger's `TriggerStateView` snapshot
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
            condition: (event, _self, state) => {
                if (!state) return false;
                for (const player of state.players) {
                    const entered = player.battlefield.find(
                        (c) => c.id === event.instanceId
                    );
                    if (entered) return (entered.power ?? 0) >= 4;
                }
                return false;
            },
            resolve: (ctx, _event, entered) => {
                ctx.drawCards(entered.controllerId, 1);
            },
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
    kicker: { cost: { X: 8 } },
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
    kicker: { cost: { X: 3 } },
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
// search, `min: 0` = "you may"; CR 701.20 shuffle.)
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
// composed via `optionChoice` (5 modes) + `grantAbility`, both already-
// exercised Ops; `grantAbility`'s free-form `ability` string already accepts
// a parametrized "protection from X" keyword (precedent: Goblin Wizard,
// `drk/red.ts`, a FIXED colour; here the colour itself is the runtime choice).
const THORNSCAPE_MASTER_PROTECTION_MODES: NonNullable<
    Extract<EffectOp, { op: "optionChoice" }>["modes"]
> = [
    {
        label: "Protection from white",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from white",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
    {
        label: "Protection from blue",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from blue",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
    {
        label: "Protection from black",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from black",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
    {
        label: "Protection from red",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from red",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
    {
        label: "Protection from green",
        effects: [
            {
                op: "grantAbility",
                ability: "protection from green",
                target: { target: 0 },
                duration: { phase: "end-of-turn" },
            },
        ],
    },
];

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

// Fertile Ground — {1}{G} Enchantment — Aura, enchant land. "Whenever
// enchanted land is tapped for mana, its controller adds an additional one
// mana of any color." (CR 303.4 aura attachment, CR 603.2 PERMANENT_TAPPED
// trigger, CR 605 mana ability.)
//
// NOT DSL-migratable (ADR 0045, twin of Wild Growth, `lea/green.ts`, same
// tranche convention; re-verified against the current engine, 2026-07):
// `tappedTrigger` now DOES have an `effects[]` site, but its script only
// binds the SOURCE's controller (`ctx.controller`) and `$source` — the
// tapped permanent's last-known-info (id, controller, subtypes) is a
// separate payload never threaded into the script (`TappedTriggerArgs.effects`
// doc, `tappedTrigger.ts`). Fertile Ground's recipient is the ENCHANTED
// LAND's controller, who can differ from the Aura's own controller (no
// controller-filter on the target), so this still needs the imperative
// `resolve` callback's `tapped.controllerId`.
// Blocked on: an event-field player ref reachable from a `tappedTrigger`
// script (same gap Wild Growth's own comment documents). The runtime colour
// choice reuses the `requestOptionChoice` picker Kavu Chameleon uses above.
const FERTILE_GROUND_COLOR_OPTIONS: { id: Color; label: string }[] = [
    { id: "W", label: "White" },
    { id: "U", label: "Blue" },
    { id: "B", label: "Black" },
    { id: "R", label: "Red" },
    { id: "G", label: "Green" },
];
export const fertileGround: CardDefinition = {
    id: "789e3582-b541-4916-ac7e-015214d7a27a",
    rarity: "common",
    name: "Fertile Ground",
    oracleText:
        "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "fertile-ground-extra-mana",
            oracleText:
                "Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.",
            scope: "any",
            forMana: true,
            manaAbility: true, // CR 605.1b / 605.4 — resolves without the stack
            // CR 605.4 — predictive extra-mana descriptor: the enchanted land
            // yields one additional mana of any colour (chosen at resolve). The
            // castability gate models it as fully flexible; the auto-tap solver
            // treats it as generic (it can't pre-encode the colour choice).
            manaBonusForPotential: {
                appliesTo: "host",
                amount: { kind: "anyColor", count: 1 },
            },
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                const chosen = ctx.requestOptionChoice({
                    playerId: tapped.controllerId,
                    choiceId: `fertile-ground-${ctx.sourceInstanceId}`,
                    options: FERTILE_GROUND_COLOR_OPTIONS,
                    prompt: "Fertile Ground: add one mana of which color?",
                });
                if (chosen === undefined) return; // suspended
                ctx.addManaTo(tapped.controllerId, {
                    [chosen as Color]: 1,
                });
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Capability-gap stubs — genuine engine/DSL gaps discovered authoring this
// tranche (issue #1073). Some reuse capability gaps already tracked by an
// earlier INV colour tranche (referenced inline); the rest are new to this
// tranche, tracked collectively by issue #1097 (opened alongside this PR).
// ─────────────────────────────────────────────────────────────────────────

// Kavu Titan — "Kicker {2}{G}. If this creature was kicked, it enters with
// three +1/+1 counters on it and with trample." The counters half composes
// via three `entersWith.counters` entries each `count: "kicker"` (see
// Llanowar Elite / Pincer Spider above), but the conditional PERMANENT
// trample grant has no declarative path — same shape as Faerie Squadron
// (`inv/blue.ts`): `grantAbility`'s `duration` is mandatory, and
// `entersWith` is counters-only. Never ships a silent partial (counters
// without trample), so the whole card stays a stub.
// tracked-by: #1083
// export const kavuTitan: CardDefinition = {
//     id: "2c5fb86d-1d9a-4da2-bb5b-4266faa20197",
//     name: "Kavu Titan",
//     rarity: "rare",
//     manaCost: { X: 1, G: 1 },
//     types: ["Creature"],
// };

// Rooting Kavu — "When this creature dies, you may exile it. If you do,
// shuffle all creature cards from your graveyard into your library." The
// "you may" gate is buildable (`mayPay` with no `cost`, issue #680), but the
// second clause is a BULK graveyard-set move (all creature cards, no per-card
// choice) — no `forEach`/`moveZone` selector iterates a graveyard set at all,
// only `players`, `permanents` (battlefield), and `bound`. Same gap Gaea's
// Blessing's mill-shuffle trigger hit (`wth/green.ts`, `resolve()` there
// because it needed the WHOLE graveyard, no filter); this needs a FILTERED
// bulk move, an even narrower case of the same open design.
// tracked-by: #1056
// export const rootingKavu: CardDefinition = {
//     id: "12c25a4c-d93a-402b-999f-0b9919123cc5",
//     name: "Rooting Kavu",
//     rarity: "uncommon",
//     manaCost: { X: 2, G: 2 },
//     types: ["Creature"],
// };

// Saproling Symbiosis — "You may cast this spell as though it had flash if
// you pay {2} more to cast it. Create a 1/1 green Saproling creature token
// for each creature you control." The token-creation clause is free
// (`createToken` + a battlefield `count`), but the "pay {N} more to cast
// with flash" cast-timing rider has no home — `AlternativeCost` REPLACES the
// mana cost rather than adding to it. Same gap as Twilight's Call
// (`inv/black.ts` issue #1085).
// tracked-by: #1085
// export const saprolingSymbiosis: CardDefinition = {
//     id: "2bb63748-5c84-43a0-8f17-a2a17f658337",
//     name: "Saproling Symbiosis",
//     rarity: "rare",
//     manaCost: { X: 3, G: 1 },
//     types: ["Sorcery"],
// };

// Thicket Elemental — "Kicker {1}{G}. When this creature enters, if it was
// kicked, you may reveal cards from the top of your library until you
// reveal a creature card. If you do, put that card onto the battlefield and
// shuffle all other cards revealed this way into your library." A triggered
// ability fired after a kicked creature resolves cannot read the originating
// spell's kicker count — `kickerCount` lives only on the resolving
// `StackItem`, never persisted onto `CardInstanceState`/`PERMANENT_ENTERED`
// for a later trigger to read. Same root cause as Benalish Emissary
// (`inv/white.ts` issue #1086).
// tracked-by: #1086
// export const thicketElemental: CardDefinition = {
//     id: "f80a56ed-3ebb-4e20-bf6a-e27127f762e8",
//     name: "Thicket Elemental",
//     rarity: "rare",
//     manaCost: { X: 3, G: 2 },
//     types: ["Creature"],
// };

// Verduran Emissary — "Kicker {1}{R}. When this creature enters, if it was
// kicked, destroy target artifact. It can't be regenerated." Same
// kickerCount-in-a-later-trigger gap as Benalish Emissary / Thicket Elemental
// above (issue #1086) — additionally, `destroy`'s Op shape carries no
// "can't be regenerated" option (Obliterate/#831 precedent, `inv/red.ts`),
// so the card would be double-blocked even if the trigger gap closed first.
// tracked-by: #1086
// export const verduranEmissary: CardDefinition = {
//     id: "55f3361b-e2e7-4297-85c2-94323f90cc90",
//     name: "Verduran Emissary",
//     rarity: "uncommon",
//     manaCost: { X: 2, G: 1 },
//     types: ["Creature"],
// };

// Canopy Surge — "Kicker {2}. Canopy Surge deals 1 damage to each creature
// with flying and each player. If this spell was kicked, it deals 4 damage
// to each creature with flying and each player instead." `EffectCardFilter`
// (the `forEach` battlefield selector's filter) has no ability/keyword field
// (type/subtype/supertype/color/manaValueAtMost/isToken/excludeType/name
// only) — "each creature WITH FLYING" can't be expressed as a `forEach`
// filter today.
// tracked-by: #1097
// export const canopySurge: CardDefinition = {
//     id: "2e19d68e-7554-4627-a316-beb1f75fa494",
//     name: "Canopy Surge",
//     rarity: "uncommon",
//     manaCost: { X: 1, G: 1 },
//     types: ["Sorcery"],
// };

// Elfhame Sanctuary — "At the beginning of your upkeep, you may search your
// library for a basic land card, reveal that card, put it into your hand,
// then shuffle. If you do, you skip your draw step this turn." The "you may…
// if you do" gate is buildable (`mayPay` with no `cost`, issue #680), but
// "skip your draw step this turn" has no primitive: no `skipDrawStepThisTurn`
// flag exists anywhere in `GameState`/`phases.ts`. The one existing
// draw-step-skip precedent (Fasting, `drk/white.ts`) is a DIFFERENT shape — a
// replacement decision made AT the draw step itself ("if you would begin your
// draw step, you may skip it"), not a flag SET earlier (at upkeep) and
// consumed later (at draw).
// tracked-by: #1097
// export const elfhameSanctuary: CardDefinition = {
//     id: "6ab9a90c-5fd8-4f8c-b692-f98a2974810c",
//     name: "Elfhame Sanctuary",
//     rarity: "uncommon",
//     manaCost: { X: 1, G: 1 },
//     types: ["Enchantment"],
// };

// Pulse of Llanowar — "If a basic land you control is tapped for mana, it
// produces mana of a color of your choice instead of any other type." A
// mana-TYPE-CHANGE replacement (not an addition like Fertile Ground/Wild
// Growth) scoped to every basic land the controller taps, with a per-tap
// runtime colour choice substituting for the land's normal output — no
// existing primitive replaces a land's produced mana type, only adds to it
// or fixes it (`addManaTo`) or restricts its spend (`addRestrictedMana`).
// tracked-by: #1097
// export const pulseOfLlanowar: CardDefinition = {
//     id: "db09afe5-5f01-4f77-a239-12d7a6e59024",
//     name: "Pulse of Llanowar",
//     rarity: "uncommon",
//     manaCost: { X: 3, G: 1 },
//     types: ["Enchantment"],
// };

// Quirion Elves — "As this creature enters, choose a color. {T}: Add {G}.
// {T}: Add one mana of the chosen color." The fixed-{G} ability is free, but
// the second mana ability needs to read a per-instance ETB colour choice
// (`getChosenModeId()`/`chosenModeId`) — and a MANA ability's `effect`
// context (`ActivatedAbilityContext`) exposes ONLY `addMana`, with no way to
// read ANY instance/game state (not even via the board-conditional
// `manaAmount` hook, whose `PermanentView` carries no `chosenModeId` field
// either). No existing seam lets a mana ability react to a stored per-
// instance choice.
// tracked-by: #1097
// export const quirionElves: CardDefinition = {
//     id: "c660a748-82a9-4d6a-8023-56aeafe1bdce",
//     name: "Quirion Elves",
//     rarity: "common",
//     manaCost: { X: 1, G: 1 },
//     types: ["Creature"],
// };

// Restock — "Return two target cards from your graveyard to your hand.
// Exile Restock." The return clause is free (`moveZone` targeting graveyard
// cards), but "Exile Restock" (CR 608.2 — the resolving SPELL instructs
// itself to be exiled instead of hitting the graveyard) has no Op:
// `SpellContext.exileSelf()` exists (Recall, `leg/blue.ts`, `resolve()`) but
// is not wired to the interpreter — no Op calls it, and the DSL `exile` Op
// only moves an announced PERMANENT/graveyard-card target, never the
// resolving stack object itself.
// tracked-by: #1097
// export const restock: CardDefinition = {
//     id: "11a013ff-7c99-445a-b9e0-0fc45036f068",
//     name: "Restock",
//     rarity: "rare",
//     manaCost: { X: 3, G: 2 },
//     types: ["Sorcery"],
// };

// Saproling Infestation — "Whenever a player kicks a spell, you create a 1/1
// green Saproling creature token." No trigger EVENT exists anywhere in the
// engine for "a player pays a kicker cost" — kicker payment is captured only
// as a snapshot (`kickerCount`) on the resulting stack item at cast commit,
// never emitted as its own `GameEvent`, so no triggered ability can listen
// for it.
// tracked-by: #1097
// export const saprolingInfestation: CardDefinition = {
//     id: "8642e530-914c-4149-944a-c4966ee27299",
//     name: "Saproling Infestation",
//     rarity: "rare",
//     manaCost: { X: 1, G: 1 },
//     types: ["Enchantment"],
// };

// Scouting Trek — "Search your library for any number of basic land cards,
// reveal those cards, then shuffle and put them on top." Reveals the
// same-shape gap Drafna's Restoration (`atq/blue.ts`) hit for "put on top in
// any order" (a `reorder-library` choice kind, `resolve()`-only, no Op) —
// but Drafna's composition never needed to shuffle (the moved cards simply
// appended to the bottom via a fresh graveyard→library move, then were
// reordered on top ahead of the untouched remainder). Scouting Trek's cards
// are ALREADY somewhere in the library when found, so "shuffle [the rest]
// and put them on top" needs a SUBSET shuffle (randomize everything except
// the found cards, which then go on top in chosen order) — no primitive
// shuffles anything narrower than the whole library (`shuffleLibrary`).
// tracked-by: #1097
// export const scoutingTrek: CardDefinition = {
//     id: "1b882e68-5c03-4ec6-9982-8c3b09847969",
//     name: "Scouting Trek",
//     rarity: "uncommon",
//     manaCost: { X: 1, G: 1 },
//     types: ["Sorcery"],
// };

// Tangle — "Prevent all combat damage that would be dealt this turn. Each
// attacking creature doesn't untap during its controller's next untap
// step." The prevention half is free (`preventDamage` mode "all-combat"),
// but the untap-lock half needs `skipNextUntap` (the Barl's Cage precedent,
// `drk/colorless.ts`, `resolve()`-only) — its Op skin (`lockUntap`) is
// `status: "planned"` in `EFFECT_OP_BACKLOG` (`mechanicsRegistry.ts`), not
// registered, so it isn't usable DSL vocabulary yet.
// tracked-by: #1097
// export const tangle: CardDefinition = {
//     id: "6b37e39c-8aa4-4938-a492-7dac5de98dfb",
//     name: "Tangle",
//     rarity: "uncommon",
//     manaCost: { X: 1, G: 1 },
//     types: ["Instant"],
// };

// Verdeloth the Ancient — "Kicker {X}. Saproling creatures and other
// Treefolk creatures get +1/+1. When Verdeloth enters, if it was kicked,
// create X 1/1 green Saproling creature tokens." The anthem is buildable
// (`pt-buff` OR-filtered by subtype), but "Kicker {X}" is a VARIABLE-cost
// kicker (the paid amount is chosen, like the card's own {X}, but scoped to
// the KICKER leg specifically) — no existing card models a variable-cost
// kicker, and it's unclear whether `getX()` would read the kicker's chosen
// amount or collide with a card's own {X} cost (Verdeloth has none, but the
// primitive's semantics for this combination are undocumented/untested).
// Distinct from the ordinary `entersWith.counters[count: "kicker"]` shape
// used elsewhere in this file, which reads a FIXED per-kick count, not a
// caster-chosen X.
// tracked-by: #1097
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
// permanent event; `DelayedTriggerTiming` has no such member (only phase
// boundaries, an instance leave-watch, and a repeating "creature blocks"
// watch — no repeating "creature deals combat damage" watch).
// tracked-by: #1097
// export const vigorousCharge: CardDefinition = {
//     id: "af6f57ad-d370-4c81-8da0-c15d87725ab1",
//     name: "Vigorous Charge",
//     rarity: "common",
//     manaCost: { G: 1 },
//     types: ["Instant"],
// };
