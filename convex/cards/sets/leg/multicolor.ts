// Legends (LEG) — Multicolor (gold, 2+ colours — Legends debuted gold cards) cards, split by colour per ADR 0043.
// The registry's `import * as leg from "./sets/leg"` resolves through
// leg/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).

import type { CardDefinition, ManaCost } from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { rampageTrigger } from "../../abilities/triggers/rampageTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla legendary creatures (CR 205.4a — Legendary supertype; CR 704.5j legend
// rule lands as an SBA in cluster C1, #369. A legendary vanilla creature is
// playable before that SBA ships and fully correct after — legendary-ness does
// not gate the card's release.)
// ─────────────────────────────────────────────────────────────────────────────

export const jasmineBoreal: CardDefinition = {
    id: "db6ef678-4ce9-48d6-aa4f-2afd9a1ad724",
    rarity: "uncommon",
    name: "Jasmine Boreal",
    oracleText: "",
    manaCost: { X: 3, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 4,
    toughness: 5,
};

export const ladyOrca: CardDefinition = {
    id: "b2779553-74eb-42ba-97d0-96269f48c269",
    rarity: "uncommon",
    name: "Lady Orca",
    oracleText: "",
    manaCost: { X: 5, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Demon"],
    power: 7,
    toughness: 4,
};

// Untamed Wilds ("search your library for a basic land card, put it onto the
// battlefield, then shuffle") is SKIPPED: `getLibraryCards` exposes only
// `{ id, types, manaValue }`, so the basic-land restriction cannot be
// expressed as a `candidateIds` allow-list without widening that accessor to
// carry supertypes — an engine change out of scope for this data-only tranche.

// ─────────────────────────────────────────────────────────────────────────────
// Multicolor / gold free tranche (#376) — every multicolor (2+ colors) Legends
// card expressible with existing primitives (keywords, staticEffects / layer
// system incl. pt-cda, trigger factories, prevention shields, mana abilities,
// createToken, control/regeneration machinery, SpellContext methods). Data +
// resolve() closures only; zero engine change (ADR 0014). Almost every
// multicolor card in Legends is a Legendary creature — the simple ones ship
// here carrying the `Legendary` supertype as data (CR 205.4a); they become
// fully rules-correct once the legend-rule SBA (#369 C1) lands.
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • Elder Dragon Legends (upkeep pay-or-sacrifice, C7): Arcades Sabboth,
//     Nicol Bolas, Palladia-Mors, Vaevictis Asmadi. (Chromium's Rampage 2 +
//     Flying ship with C3 (#380) at the foot of this file; its upkeep
//     pay-or-sacrifice still belongs to C7.)
//   • Rampage N (C3, #380, shipped): Hunding Gjornersen (rampage 1) and
//     Marhault Elsdragon (rampage 1) are now defined at the foot of this file.
//     Gabriel Angelfire (its upkeep choice includes "rampage 3") still waits on
//     its choice cluster; its Rampage piece reuses `rampageTrigger` when built.
//   • Banding / bands-with-other (C4): Ayesha Tanaka.
//   • Shroud / can't-be-targeted (C6): Bartel Runeaxe, Tetsuo Umezawa.
//   • Named counters (C5): Rasputin Dreamweaver (dream counters).
//   • Control-change-to-opponent upkeep penalty + named anthem (cluster-shaped):
//     Rohgahh of Kher Keep.
//
// Cards that genuinely need an unbuilt primitive are SKIPPED (not built here):
//   • Axelrod Gunnarson — "whenever a creature dealt damage by Axelrod this
//     turn dies, ..." needs a per-source combat-damage tally keyed to the
//     dealer; no such surface exists (same gap flagged for Blazing Effigy).
//   • Gosta Dirk / Lord Magnus / Ur-Drago — each carries a landwalk-suppression
//     static ("creatures with islandwalk/forestwalk/plainswalk/swampwalk can be
//     blocked as though they didn't have it"). The `landwalk-negation` static
//     (Great Wall / Undertow, #484) now expresses the suppression half with a
//     multi-subtype `subtypes` array; these creatures are buildable once their
//     remaining halves (keyword grant + P/T) are wired in a follow-up.
//   • Hazezon Tamar — delayed X 1/1 Sand Warrior tokens at the next upkeep plus
//     a leaves-the-battlefield "exile all Sand Warriors" sweep keyed by token
//     name across both players; the cross-board named-token tracking has no
//     primitive.
//   • Johan — "attacking doesn't cause creatures you control to tap this combat"
//     is a combat-tap replacement with no primitive.
//   • Lady Caleria / Tor Wauki — "{T}: deal N damage to target attacking OR
//     blocking creature"; `combatRoleFilter` admits only one role at a time
//     (same gap flagged for Crimson Manticore).
//   • Lady Evangela — "prevent all combat damage that would be dealt BY target
//     creature this turn"; only `preventAllCombatDamageToAndBy` (both
//     directions, Ebony Horse) exists — a by-only shield would over-prevent.
//   • Nebuchadnezzar — "name a card, reveal X cards at random from target
//     player's hand, then discard all with the chosen name". The name-a-card
//     half now exists (`requestNameCard`, #489 — Petra Sphinx); what's still
//     missing is a random-reveal-N-from-hand primitive (pick X hand cards at
//     random and reveal them). Unblocked on the naming side; deferred on the
//     random-hand-reveal side.
//   • Ramses Overdark — "destroy target enchanted creature"; no
//     enchanted-permanent target filter on `TargetRequirement`.
//   • Stangg — creates a linked legendary token twin with a sacrifice-the-pair
//     LTB linkage (token leaves → sacrifice Stangg, Stangg leaves → exile
//     token); no token-linkage primitive.
// ─────────────────────────────────────────────────────────────────────────────

// --- Vanilla / keyword multicolor creatures (CR 110.1, 702 — pure data) ----

// Barktooth Warbeard — vanilla legendary 6/5 (CR 205.4a Legendary supertype).
export const barktoothWarbeard: CardDefinition = {
    id: "0ea52228-f8ad-4623-9e05-f162473bfc03",
    rarity: "uncommon",
    name: "Barktooth Warbeard",
    oracleText: "",
    manaCost: { X: 4, B: 1, R: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 6,
    toughness: 5,
};

// Jedit Ojanen — vanilla legendary 5/5.
export const jeditOjanen: CardDefinition = {
    id: "97b80124-2b59-425c-93cc-9b032e631c6e",
    rarity: "uncommon",
    name: "Jedit Ojanen",
    oracleText: "",
    manaCost: { X: 4, W: 2, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Cat", "Warrior"],
    power: 5,
    toughness: 5,
};

// Jerrard of the Closed Fist — vanilla legendary 6/5.
export const jerrardOfTheClosedFist: CardDefinition = {
    id: "7f841918-813b-4784-ab57-907185b0a355",
    rarity: "uncommon",
    name: "Jerrard of the Closed Fist",
    oracleText: "",
    manaCost: { X: 3, R: 1, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 6,
    toughness: 5,
};

// Kasimir the Lone Wolf — vanilla legendary 5/3.
export const kasimirTheLoneWolf: CardDefinition = {
    id: "45b1e60d-54dd-41cd-b9a2-00890725a3df",
    rarity: "uncommon",
    name: "Kasimir the Lone Wolf",
    oracleText: "",
    manaCost: { X: 4, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 5,
    toughness: 3,
};

// Sir Shandlar of Eberyn — vanilla legendary 4/7.
export const sirShandlarOfEberyn: CardDefinition = {
    id: "31570ded-f5e3-44c4-b95f-294ac10b2cd2",
    rarity: "uncommon",
    name: "Sir Shandlar of Eberyn",
    oracleText: "",
    manaCost: { X: 4, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 4,
    toughness: 7,
};

// Sivitri Scarzam — vanilla legendary 6/4.
export const sivitriScarzam: CardDefinition = {
    id: "9c12ee9e-db13-4b4d-a061-b6566f538f09",
    rarity: "uncommon",
    name: "Sivitri Scarzam",
    oracleText: "",
    manaCost: { X: 5, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 6,
    toughness: 4,
};

// The Lady of the Mountain — vanilla legendary 5/5.
export const theLadyOfTheMountain: CardDefinition = {
    id: "83717eb2-220e-4086-be09-dee9174798b8",
    rarity: "uncommon",
    name: "The Lady of the Mountain",
    oracleText: "",
    manaCost: { X: 4, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Giant"],
    power: 5,
    toughness: 5,
};

// Tobias Andrion — vanilla legendary 4/4.
export const tobiasAndrion: CardDefinition = {
    id: "cac56eda-5ed3-4abd-beec-f5063fbf930a",
    rarity: "uncommon",
    name: "Tobias Andrion",
    oracleText: "",
    manaCost: { X: 3, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Advisor"],
    power: 4,
    toughness: 4,
};

// Torsten Von Ursus — vanilla legendary 5/5.
export const torstenVonUrsus: CardDefinition = {
    id: "5fd99522-4a91-4ccd-91bf-5f32a6ac3510",
    rarity: "uncommon",
    name: "Torsten Von Ursus",
    oracleText: "",
    manaCost: { X: 3, G: 2, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Soldier"],
    power: 5,
    toughness: 5,
};

// Ramirez DePietro — first strike (CR 702.7) legendary 4/3.
export const ramirezDePietro: CardDefinition = {
    id: "e5c66c61-aadf-433b-9958-fc9b44b327b9",
    rarity: "uncommon",
    name: "Ramirez DePietro",
    oracleText: "First strike",
    manaCost: { X: 3, U: 1, B: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Pirate"],
    power: 4,
    toughness: 3,
    staticAbilities: ["first strike"],
};

// Livonya Silone — first strike (CR 702.7) + legendary landwalk (CR 702.13).
// "Legendary landwalk" is landwalk keyed on the land *supertype* Legendary
// (CR 205.4) rather than a basic-land subtype: Livonya can't be blocked while
// the defending player controls a land with the Legendary supertype. The
// evasion is a parametric registry rule (`LANDWALK_SUPERTYPE_KEYWORDS` →
// `LANDWALK_SUPERTYPE_RULES`), so the keyword string carries the whole
// behavior — no per-card resolve() or staticEffect.
export const livonyaSilone: CardDefinition = {
    id: "b9211949-66a5-4039-ac6d-3e42b008b58e",
    rarity: "rare",
    name: "Livonya Silone",
    oracleText:
        "First strike; legendary landwalk (This creature can't be blocked as long as defending player controls a legendary land.)",
    manaCost: { X: 2, R: 2, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 4,
    toughness: 4,
    staticAbilities: ["first strike", "legendary landwalk"],
};

// --- Characteristic-defining P/T (CR 604.3) --------------------------------

// Dakkon Blackblade — "Dakkon Blackblade's power and toughness are each equal
// to the number of lands you control." (CR 604.3 pt-cda; base 0/0, the CDA
// supplies the whole value from a land count.)
export const dakkonBlackblade: CardDefinition = {
    id: "fbfd1278-1486-4516-8846-007ce1985ee9",
    rarity: "rare",
    name: "Dakkon Blackblade",
    oracleText:
        "Dakkon Blackblade's power and toughness are each equal to the number of lands you control.",
    manaCost: { X: 2, W: 1, U: 2, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let lands = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.types.includes("Land")
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

// --- Filtered anthem (CR 611 layer 7c) -------------------------------------

// Jacques le Vert — "Green creatures you control get +0/+2." (CR 611 filtered
// anthem keyed on colour + controller.)
export const jacquesLeVert: CardDefinition = {
    id: "ee5a45b1-169b-468e-9251-424c09cd7f0f",
    rarity: "rare",
    name: "Jacques le Vert",
    oracleText: "Green creatures you control get +0/+2.",
    manaCost: { X: 1, R: 1, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 3,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId &&
                ctx.getColors(target).includes("G"),
            power: 0,
            toughness: 2,
        },
    ],
};

// --- Spell-cast trigger (CR 603.2) -----------------------------------------

// Sol'kanar the Swamp King — Swampwalk (CR 702.13) + "Whenever a player casts a
// black spell, you gain 1 life." (CR 603.2 spell-cast trigger, any caster,
// colour-filtered → CR 119.3 lifegain.)
export const solkanarTheSwampKing: CardDefinition = {
    id: "7a20dcb0-5350-40e0-82d3-c8d0186fc9d2",
    rarity: "rare",
    name: "Sol'kanar the Swamp King",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)\nWhenever a player casts a black spell, you gain 1 life.",
    manaCost: { X: 2, U: 1, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Demon"],
    power: 5,
    toughness: 5,
    staticAbilities: ["swampwalk"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "solkanar-black-spell-lifegain",
            oracleText:
                "Whenever a player casts a black spell, you gain 1 life.",
            scope: "any",
            filter: { colors: "B" },
            // Migrated resolve()→effects[] (ADR 0045): event-independent
            // 1-life gain for the source's controller (CR 119.3a) via the
            // `gainLife` Op.
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ],
};

// --- Activated abilities (CR 602) ------------------------------------------

// Adun Oakenshield — "{B}{R}{G}, {T}: Return target creature card from your
// graveyard to your hand." (CR 602 activated ability + CR 400.7 graveyard→hand
// move on a chosen graveyard creature.)
export const adunOakenshield: CardDefinition = {
    id: "60252226-a102-4d88-9b80-42d021b5184d",
    rarity: "rare",
    name: "Adun Oakenshield",
    oracleText:
        "{B}{R}{G}, {T}: Return target creature card from your graveyard to your hand.",
    manaCost: { B: 1, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "adun-oakenshield-regrowth",
            oracleText:
                "{B}{R}{G}, {T}: Return target creature card from your graveyard to your hand.",
            cost: { mana: { B: 1, R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            // Migrated resolve()→effects[] (ADR 0045, #839): return the
            // targeted graveyard creature card to its owner's hand (CR 400.7).
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// Angus Mackenzie — "{G}{W}{U}, {T}: Prevent all combat damage that would be
// dealt this turn. Activate only before the combat damage step." (CR 602.5b
// activation-window restriction + CR 615 fog-style global combat-damage
// prevention.)
export const angusMackenzie: CardDefinition = {
    id: "57264bd9-94f6-4d4d-baff-2b2900585635",
    rarity: "rare",
    name: "Angus Mackenzie",
    oracleText:
        "{G}{W}{U}, {T}: Prevent all combat damage that would be dealt this turn. Activate only before the combat damage step.",
    manaCost: { G: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "angus-mackenzie-fog",
            oracleText:
                "{G}{W}{U}, {T}: Prevent all combat damage that would be dealt this turn. Activate only before the combat damage step.",
            cost: { mana: { G: 1, W: 1, U: 1 }, tap: true },
            useStack: true,
            // "before the combat damage step" — legal through the declare-
            // blockers step at the latest (CR 508–510).
            activationPhaseRestriction: [
                "BEGINNING_OF_COMBAT",
                "DECLARE_ATTACKERS",
                "DECLARE_BLOCKERS",
            ],
            // Migrated resolve()→effects[] (ADR 0045): a turn-scoped global
            // Fog (CR 615) via the `preventDamage` Op's "all-combat" mode.
            effects: [{ op: "preventDamage", mode: "all-combat" }],
        },
    ],
};

// Boris Devilboon — "{2}{B}{R}, {T}: Create a 1/1 black and red Demon creature
// token named Minor Demon." (CR 602 activated ability + CR 111 token
// creation.)
export const borisDevilboon: CardDefinition = {
    id: "82ae30e8-2dcd-46b8-925b-cc24e11fb95d",
    rarity: "rare",
    name: "Boris Devilboon",
    oracleText:
        "{2}{B}{R}, {T}: Create a 1/1 black and red Demon creature token named Minor Demon.",
    manaCost: { X: 3, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Zombie", "Wizard"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "boris-devilboon-minor-demon",
            oracleText:
                "{2}{B}{R}, {T}: Create a 1/1 black and red Demon creature token named Minor Demon.",
            cost: { mana: { X: 2, B: 1, R: 1 }, tap: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #847): create one 1/1
            // black-and-red Demon token named Minor Demon on the controller's
            // battlefield (CR 111 / 707.1). No `imagePrintId` — Scryfall has
            // no printed Minor Demon token for Boris Devilboon (`all_parts`
            // is empty), so this stays a placeholder-rendered token by
            // design (issue #941 documented exception).
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Minor Demon",
                        types: ["Creature"],
                        subtypes: ["Demon"],
                        power: 1,
                        toughness: 1,
                        colors: ["B", "R"],
                    },
                    controller: "controller",
                },
            ],
        },
    ],
};

// Gwendlyn Di Corci — "{T}: Target player discards a card at random. Activate
// only during your turn." (CR 602.5b turn restriction + CR 701.8a random
// discard.)
export const gwendlynDiCorci: CardDefinition = {
    id: "473d70b6-a88c-49f4-9415-19919c4468ae",
    rarity: "rare",
    name: "Gwendlyn Di Corci",
    oracleText:
        "{T}: Target player discards a card at random. Activate only during your turn.",
    manaCost: { X: 1, U: 1, B: 2, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Rogue"],
    power: 3,
    toughness: 5,
    activatedAbilities: [
        {
            id: "gwendlyn-di-corci-discard",
            oracleText:
                "{T}: Target player discards a card at random. Activate only during your turn.",
            cost: { tap: true },
            useStack: true,
            controllerTurnOnly: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [
                { op: "discardAtRandom", player: { target: 0 }, count: 1 },
            ],
        },
    ],
};

// Kei Takahashi — "{T}: Prevent the next 2 damage that would be dealt to target
// creature this turn." (CR 602 tap ability + CR 615 prevent-N shield on a
// chosen target.)
export const keiTakahashi: CardDefinition = {
    id: "6a4a524a-fdc7-432d-994b-953808528349",
    rarity: "rare",
    name: "Kei Takahashi",
    oracleText:
        "{T}: Prevent the next 2 damage that would be dealt to target creature this turn.",
    manaCost: { X: 2, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "kei-takahashi-prevent",
            oracleText:
                "{T}: Prevent the next 2 damage that would be dealt to target creature this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-2
            // shield on the announced target creature (CR 615.1).
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

// Pavel Maliki — "{B}{R}: Pavel Maliki gets +1/+0 until end of turn." (CR 611.1
// repeatable temporary buff.)
export const pavelMaliki: CardDefinition = {
    id: "304f9d39-3ea2-4274-b23e-e4eaabbc1c4b",
    rarity: "uncommon",
    name: "Pavel Maliki",
    oracleText: "{B}{R}: Pavel Maliki gets +1/+0 until end of turn.",
    manaCost: { X: 4, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 5,
    toughness: 3,
    activatedAbilities: [
        {
            id: "pavel-maliki-pump",
            oracleText: "{B}{R}: Pavel Maliki gets +1/+0 until end of turn.",
            cost: { mana: { B: 1, R: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #840): self-pump +1/+0
            // until end of turn (CR 611.1) via the `pump` Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Ragnar — "{G}{W}{U}, {T}: Regenerate target creature." (CR 602 tap ability +
// CR 701.15a regeneration shield on a chosen target.)
export const ragnar: CardDefinition = {
    id: "2cf6a3a3-4a06-4eb7-981a-b70cf05b2473",
    rarity: "rare",
    name: "Ragnar",
    oracleText: "{G}{W}{U}, {T}: Regenerate target creature.",
    manaCost: { G: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "ragnar-regenerate",
            oracleText: "{G}{W}{U}, {T}: Regenerate target creature.",
            cost: { mana: { G: 1, W: 1, U: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #846): regenerate the
            // announced creature target (CR 701.15a).
            effects: [{ op: "regenerate", target: { target: 0 } }],
        },
    ],
};

// Tuknir Deathlock — Flying (CR 702.9) + "{R}{G}, {T}: Target creature gets
// +2/+2 until end of turn." (CR 611.1 buff on a chosen target.)
export const tuknirDeathlock: CardDefinition = {
    id: "9dfbcb4d-a9ae-4d76-8dde-7312fbad56b0",
    rarity: "rare",
    name: "Tuknir Deathlock",
    oracleText:
        "Flying\n{R}{G}, {T}: Target creature gets +2/+2 until end of turn.",
    manaCost: { X: 0, R: 2, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "tuknir-deathlock-pump",
            oracleText:
                "{R}{G}, {T}: Target creature gets +2/+2 until end of turn.",
            cost: { mana: { R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #840): +2/+2 to the
            // targeted creature until end of turn (CR 611.1) via `pump`.
            effects: [
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

// Xira Arien — Flying (CR 702.9) + "{B}{R}{G}, {T}: Target player draws a
// card." (CR 602 tap ability + CR 121.1 draw.)
export const xiraArien: CardDefinition = {
    id: "cc6c7d89-32e7-4c3f-ac90-7db3a46eed4b",
    rarity: "rare",
    name: "Xira Arien",
    oracleText: "Flying\n{B}{R}{G}, {T}: Target player draws a card.",
    manaCost: { B: 1, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Insect", "Wizard"],
    power: 1,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "xira-arien-draw",
            oracleText: "{B}{R}{G}, {T}: Target player draws a card.",
            cost: { mana: { B: 1, R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [{ op: "draw", player: { target: 0 }, count: 1 }],
        },
    ],
};

// --- Mana abilities (CR 605.1a — useStack: false, resolve immediately) ------

// Princess Lucrezia — "{T}: Add {U}." (CR 605.1a mana ability.)
export const princessLucrezia: CardDefinition = {
    id: "a1dcf48c-2700-4024-807e-9244e4c649ac",
    rarity: "uncommon",
    name: "Princess Lucrezia",
    oracleText: "{T}: Add {U}.",
    manaCost: { X: 3, U: 2, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Wizard"],
    power: 5,
    toughness: 4,
    activatedAbilities: [
        {
            id: "princess-lucrezia-mana",
            oracleText: "{T}: Add {U}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 1 }),
            manaProduced: { U: 1 },
        },
    ],
};

// Riven Turnbull — "{T}: Add {B}." (CR 605.1a mana ability.)
export const rivenTurnbull: CardDefinition = {
    id: "d11f90e7-ced1-4d80-8083-99acbf459ad7",
    rarity: "uncommon",
    name: "Riven Turnbull",
    oracleText: "{T}: Add {B}.",
    manaCost: { X: 5, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Advisor"],
    power: 5,
    toughness: 7,
    activatedAbilities: [
        {
            id: "riven-turnbull-mana",
            oracleText: "{T}: Add {B}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ B: 1 }),
            manaProduced: { B: 1 },
        },
    ],
};

// Sunastian Falconer — "{T}: Add {C}{C}." (CR 605.1a mana ability.)
export const sunastianFalconer: CardDefinition = {
    id: "587075f3-a568-4089-83ca-fe1e473c025d",
    rarity: "uncommon",
    name: "Sunastian Falconer",
    oracleText: "{T}: Add {C}{C}.",
    manaCost: { X: 3, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Shaman"],
    power: 4,
    toughness: 4,
    activatedAbilities: [
        {
            id: "sunastian-falconer-mana",
            oracleText: "{T}: Add {C}{C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 2 }),
            manaProduced: { C: 2 },
        },
    ],
};

// Chromium — {2}{W}{W}{U}{U}{B}{B} 7/7, Flying, Rampage 2. Elder Dragon Legend.
// Rampage + Flying shipped with C3 (#380); the C7 (#383) upkeep "sacrifice
// unless you pay {W}{U}{B}" maintenance cost is wired here via
// `payOrSacrificeUpkeepTrigger` (see the C7 section at the foot of this file).
export const chromium: CardDefinition = {
    id: "8cd7d7e1-f928-4429-9a59-ba0590a78e98",
    rarity: "rare",
    name: "Chromium",
    oracleText:
        "Flying\nRampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)\nAt the beginning of your upkeep, sacrifice Chromium unless you pay {W}{U}{B}.",
    manaCost: { X: 2, W: 2, U: 2, B: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying", "rampage 2"],
    triggeredAbilities: [
        rampageTrigger(2),
        payOrSacrificeUpkeepTrigger({
            id: "chromium-upkeep",
            cardName: "Chromium",
            cost: { W: 1, U: 1, B: 1 },
            costText: "{W}{U}{B}",
        }),
    ],
};

// Hunding Gjornersen — {3}{W}{U}{U} 5/4, Rampage 1. Legendary.
export const hundingGjornersen: CardDefinition = {
    id: "07d8e501-6857-4a52-a3b9-2bf0bee5b08c",
    rarity: "uncommon",
    name: "Hunding Gjornersen",
    oracleText:
        "Rampage 1 (Whenever this creature becomes blocked, it gets +1/+1 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, W: 1, U: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 5,
    toughness: 4,
    staticAbilities: ["rampage 1"],
    triggeredAbilities: [rampageTrigger(1)],
};

// Marhault Elsdragon — {3}{R}{R}{G} 4/6, Rampage 1. Legendary.
export const marhaultElsdragon: CardDefinition = {
    id: "67330004-6720-46d9-9de0-c79230110583",
    rarity: "uncommon",
    name: "Marhault Elsdragon",
    oracleText:
        "Rampage 1 (Whenever this creature becomes blocked, it gets +1/+1 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, R: 2, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elf", "Warrior"],
    power: 4,
    toughness: 6,
    staticAbilities: ["rampage 1"],
    triggeredAbilities: [rampageTrigger(1)],
};

// Bartel Runeaxe — Legendary 6/5 Giant Warrior, "Vigilance\nBartel Runeaxe can't
// be the target of Aura spells." (CR 702.18-style untargetability narrowed to
// AURA SPELLS: a self-targeting guard with `targetSourceMustBeSpell` +
// `targetSourceSubtypeFilter: ["Aura"]`, CR 109.5 / 113.3. Vigilance is a plain
// keyword, CR 702.21.)
export const bartelRuneaxe: CardDefinition = {
    id: "f1a42691-98bb-4234-9b56-085e6677f3e4",
    rarity: "rare",
    name: "Bartel Runeaxe",
    oracleText: "Vigilance\nBartel Runeaxe can't be the target of Aura spells.",
    manaCost: { X: 3, B: 1, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Giant", "Warrior"],
    power: 6,
    toughness: 5,
    staticAbilities: ["vigilance"],
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "bartel-runeaxe-no-aura-spell",
            cantBeTargeted: true,
            // Only Aura SPELLS (CR 109.5 subtype + CR 113.3 spell-not-ability).
            // Aura abilities (rare) and non-Aura spells/abilities still hit.
            targetSourceMustBeSpell: true,
            targetSourceSubtypeFilter: ["Aura"],
            applies: (target, source) => target.id === source.id,
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C6 deferred (need an unbuilt primitive — left for a future batch):
//   • Tetsuo Umezawa — its "{U}{B}{B}{R}, {T}: Destroy target tapped or blocking
//     creature" needs a disjunctive "tapped OR blocking" target filter across
//     two different axes (tappedFilter vs combatRoleFilter, today combined as
//     AND). Same combat-target-OR gap flagged for Crimson Manticore ("attacking
//     or blocking"). Its can't-be-target-of-Aura-spells static IS expressible
//     here (identical to Bartel Runeaxe), but shipping a Tetsuo whose flagship
//     removal ability can't be cast would be partial — defer the whole card.
//   • Wall of Shadows — "Prevent all damage that would be dealt to this by
//     creatures it's blocking" is a CONTINUOUS, blocking-pair-scoped combat
//     prevention (only a turn-scoped `combatDamageImmunity` exists, no
//     per-blocking-pair continuous prevention static — same gap flagged for Wall
//     of Vapor / Feint). Its "can't be the target of spells/abilities that can
//     target only Walls" clause is also not expressible (no card in the pool
//     carries a "Walls only" target restriction, so there is nothing to match
//     against). Defer until the continuous combat-prevention primitive lands.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// C7 — Upkeep "pay-or-sacrifice" maintenance cost (#383)
//
// The Legends Elder-Dragon drawback (CR 603.6a beginning-of-upkeep trigger +
// CR 117.3a "do X unless you pay [cost]" intervening-cost pattern). At the
// beginning of the controller's upkeep a triggered ability goes on the stack;
// on resolution the controller MAY pay a cost, and if they don't (or can't),
// the permanent is sacrificed/destroyed (CR 701.16 / 701.7). Each pay-or-not
// decision is an independent trigger on the stack (CR 603.3b), so multiple
// taxed permanents resolve their choices one at a time.
//
// ZERO engine change: the whole family is expressible with the existing
// `phaseTrigger` factory + `requestMayPay` (the same pending-choice → mutation
// path Energy Flux and Junún Efreet use) + `sacrifice` / `destroy` / `dealDamage`
// primitives. The shared body lives in `payOrSacrificeUpkeepTrigger` below so
// the five Elder Dragons + The Tabernacle's granted trigger don't repeat it
// (the closure is extracted on the 2nd card per the project's helper-extraction
// rule); Cosmic Horror's destroy-and-self-damage and Mold Demon's
// sacrifice-as-cost ETB variants compose the same primitives inline.
//
// Cards shipped here:
//   • Arcades Sabboth, Chromium (trigger added above), Nicol Bolas,
//     Palladia-Mors, Vaevictis Asmadi — "sacrifice this unless you pay {C}{C}{C}".
//   • Cosmic Horror — "destroy this unless you pay {3}{B}{B}{B}. If destroyed
//     this way, it deals 7 damage to you" (destroy variant + self-damage rider).
//   • Mold Demon — "When this enters, sacrifice it unless you sacrifice two
//     Swamps" (ETB sacrifice-as-cost variant; not an upkeep trigger, but the
//     same do-X-unless-you-pay shape — CR 603.6a ETB + CR 118.3 alternate cost).
//   • The Tabernacle at Pendrell Vale — Legendary Land that GRANTS every
//     creature "At the beginning of your upkeep, destroy this creature unless
//     you pay {1}" via a `triggered-grant` static effect (CR 113.1 / 611),
//     exactly like Energy Flux grants its tax to every artifact. Each creature's
//     own controller pays at their own upkeep (CR 603.6a, `scope: "your"`).
//
// Deferred (need a primitive not yet built): Elder Spawn, Forethought Amulet,
//   Primordial Ooze (upkeep-maintenance cards, tracked-by: #1216); Pit Scorpion,
//   Takklemaggot (named counters, tracked-by: #1213).
// ─────────────────────────────────────────────────────────────────────────────

/** Shared resolve body for the Elder-Dragon "sacrifice this unless you pay
 *  [cost]" upkeep trigger (CR 603.6a + CR 117.3a). Returns a `phaseTrigger`
 *  bound to the UPKEEP step in the source controller's own scope. On
 *  resolution the controller may pay `cost`; declining (or being unable to
 *  pay) sacrifices the source permanent (CR 701.16). Reused by all five Elder
 *  Dragons and — with `consequence: "destroy"` — by The Tabernacle's granted
 *  trigger. */
export function payOrSacrificeUpkeepTrigger(args: {
    id: string;
    cardName: string;
    cost: ManaCost;
    costText: string;
    /** "sacrifice" (Elder Dragons, CR 701.16) or "destroy" (Tabernacle's
     *  granted tax, CR 701.7). Defaults to "sacrifice". */
    consequence?: "sacrifice" | "destroy";
}) {
    const verb = args.consequence ?? "sacrifice";
    // Migrated resolve()→effects[] (ADR 0045): `mayPay` binds the CR 117.3a
    // pay-or-not decision (`scope: "your"` means the trigger's controller IS
    // the scoped player, so the plain "controller" player selector is safe —
    // see `phaseTrigger`'s effects doc); `if { not: { binding: "$paid" } }`
    // fires the sacrifice/destroy consequence on `$source` only when the cost
    // went unpaid (the Force Spike "unless pays" template, `leg/blue.ts`).
    return phaseTrigger({
        id: args.id,
        oracleText: `At the beginning of your upkeep, ${verb} ${args.cardName} unless you pay ${args.costText}.`,
        phase: "UPKEEP",
        scope: "your",
        effects: [
            {
                op: "mayPay",
                player: "controller",
                cost: args.cost,
                prompt: `Pay ${args.costText} or ${verb} ${args.cardName}?`,
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [
                    verb === "destroy"
                        ? { op: "destroy", target: { ref: "$source" } }
                        : { op: "sacrifice", target: { ref: "$source" } },
                ],
            },
        ],
    });
}

// Arcades Sabboth — {2}{G}{G}{W}{W}{U}{U} 7/7 Elder Dragon. C7 wires its Flying
// keyword + the upkeep "sacrifice unless you pay {G}{W}{U}" tax (CR 603.6a +
// CR 117.3a). Its +0/+2 untapped-non-attacker anthem and {W} pump are
// free-tranche abilities (staticEffects / activated) owned by #369's mono /
// multicolor batch — NOT part of the C7 maintenance-cost cluster — and are
// added by that batch; the oracleText is the full card.
export const arcadesSabboth: CardDefinition = {
    id: "2c1dbc62-ceb5-4540-ae38-901e5deafc75",
    rarity: "rare",
    name: "Arcades Sabboth",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice Arcades Sabboth unless you pay {G}{W}{U}.\nEach untapped creature you control gets +0/+2 as long as it's not attacking.\n{W}: Arcades Sabboth gets +0/+1 until end of turn.",
    manaCost: { X: 2, G: 2, W: 2, U: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "arcades-sabboth-upkeep",
            cardName: "Arcades Sabboth",
            cost: { G: 1, W: 1, U: 1 },
            costText: "{G}{W}{U}",
        }),
    ],
};

// Nicol Bolas — {2}{U}{U}{B}{B}{R}{R} 7/7 Elder Dragon. C7 wires its Flying
// keyword + the upkeep "sacrifice unless you pay {U}{B}{R}" tax (CR 603.6a +
// CR 117.3a). Its "deals damage to an opponent → that player discards their
// hand" trigger is a free-tranche ability owned by #369's batch — not part of
// the C7 maintenance-cost cluster — and is added there; oracleText is full.
export const nicolBolas: CardDefinition = {
    id: "729feb73-4581-4f9d-ba47-bece72481b86",
    rarity: "rare",
    name: "Nicol Bolas",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice Nicol Bolas unless you pay {U}{B}{R}.\nWhenever Nicol Bolas deals damage to an opponent, that player discards their hand.",
    manaCost: { X: 2, U: 2, B: 2, R: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "nicol-bolas-upkeep",
            cardName: "Nicol Bolas",
            cost: { U: 1, B: 1, R: 1 },
            costText: "{U}{B}{R}",
        }),
    ],
};

// Palladia-Mors — {2}{R}{R}{G}{G}{W}{W} 7/7 Elder Dragon. Flying, trample +
// the C7 upkeep tax. CR 603.6a + CR 117.3a.
export const palladiaMors: CardDefinition = {
    id: "ad64874d-ce33-4e0a-bcca-723f129ef415",
    rarity: "rare",
    name: "Palladia-Mors",
    oracleText:
        "Flying, trample\nAt the beginning of your upkeep, sacrifice Palladia-Mors unless you pay {R}{G}{W}.",
    manaCost: { X: 2, R: 2, G: 2, W: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying", "trample"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "palladia-mors-upkeep",
            cardName: "Palladia-Mors",
            cost: { R: 1, G: 1, W: 1 },
            costText: "{R}{G}{W}",
        }),
    ],
};

// Vaevictis Asmadi — {2}{B}{B}{R}{R}{G}{G} 7/7 Elder Dragon. C7 wires its Flying
// keyword + the upkeep "sacrifice unless you pay {B}{R}{G}" tax (CR 603.6a +
// CR 117.3a). Its three single-color +1/+0 pump abilities are free-tranche
// activated abilities owned by #369's batch — not part of the C7 cluster — and
// are added there; oracleText is the full card.
export const vaevictisAsmadi: CardDefinition = {
    id: "22ea73ec-1325-4437-a23f-dcda1767c713",
    rarity: "rare",
    name: "Vaevictis Asmadi",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice Vaevictis Asmadi unless you pay {B}{R}{G}.\n{B}: Vaevictis Asmadi gets +1/+0 until end of turn.\n{R}: Vaevictis Asmadi gets +1/+0 until end of turn.\n{G}: Vaevictis Asmadi gets +1/+0 until end of turn.",
    manaCost: { X: 2, B: 2, R: 2, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "vaevictis-asmadi-upkeep",
            cardName: "Vaevictis Asmadi",
            cost: { B: 1, R: 1, G: 1 },
            costText: "{B}{R}{G}",
        }),
    ],
};

// Rasputin Dreamweaver — {4}{W}{U} Legendary 4/1. Enters with seven dream
// counters; each removes one for {C} or to prevent 1 damage to it; each upkeep,
// if it started the turn untapped, it regains one (capped at seven). CR 122
// named counters, CR 122.6 counter-removal cost, CR 502.1 "started the turn
// untapped" flag, CR 614 damage prevention.
export const rasputinDreamweaver: CardDefinition = {
    id: "503256f8-3aab-49d0-b78b-6502aa29ce52",
    rarity: "rare",
    name: "Rasputin Dreamweaver",
    oracleText:
        "Rasputin Dreamweaver enters with seven dream counters on it.\nRemove a dream counter from Rasputin Dreamweaver: Add {C}.\nRemove a dream counter from Rasputin Dreamweaver: Prevent the next 1 damage that would be dealt to Rasputin Dreamweaver this turn.\nAt the beginning of your upkeep, if Rasputin Dreamweaver started the turn untapped, put a dream counter on it.\nRasputin Dreamweaver can't have more than seven dream counters on it.",
    manaCost: { X: 4, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Wizard"],
    power: 4,
    toughness: 1,
    entersWith: { counters: [{ type: "dream", count: 7 }] },
    activatedAbilities: [
        {
            id: "rasputin-dream-mana",
            cost: { removeCounter: { type: "dream", count: 1 } },
            oracleText:
                "Remove a dream counter from Rasputin Dreamweaver: Add {C}.",
            useStack: false,
            manaProduced: { C: 1 },
            effect: (ctx) => {
                ctx.addMana({ C: 1 });
            },
        },
        {
            id: "rasputin-dream-prevent",
            cost: { removeCounter: { type: "dream", count: 1 } },
            oracleText:
                "Remove a dream counter from Rasputin Dreamweaver: Prevent the next 1 damage that would be dealt to Rasputin Dreamweaver this turn.",
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #845): a one-shot
            // prevent-the-next-1 shield on the source itself (`$source`,
            // CR 615.1) for the rest of the turn.
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { ref: "$source" },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "rasputin-upkeep-regrow",
            oracleText:
                "At the beginning of your upkeep, if Rasputin Dreamweaver started the turn untapped, put a dream counter on it.",
            phase: "UPKEEP",
            scope: "your",
            // CR 603.4d — only if it started the turn untapped.
            interveningIf: (_event, self) => self.startedTurnUntapped === true,
            // Migrated resolve()→effects[] (ADR 0045): the stale blocker (no
            // counter-count predicate) is resolved — the `counters` EffectValue
            // member (issue #1015) reads the LIVE "dream" counter count on
            // `$source` directly in an `if` comparison predicate (The Fallen
            // shape, `drk/black.ts`), gating the add at the CR 122 seven-counter
            // cap.
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: {
                            counters: { of: { ref: "$source" }, type: "dream" },
                        },
                        op: "lt",
                        right: 7,
                    },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "dream",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        }),
    ],
};

// Halfdane — {1}{W}{U}{B} 3/3 Legendary Shapeshifter. "At the beginning of your
// upkeep, change Halfdane's base power and toughness to the power and toughness
// of target creature other than Halfdane until your next upkeep."
//
// TARGETING (CR 603.3d): "target creature other than Halfdane" is a REAL
// target chosen when the upkeep trigger is put on the stack — declared as a
// `targetRequirement` on the TriggeredAbility (issue #1193 machinery,
// `raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes it subject to hexproof / protection / ward and
// fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. `excludeSource` drops Halfdane
// herself ("other than ~"). The modern Oracle wording carries no "may", so the
// single target is MANDATORY (`count: 1`); with no legal creature other than
// Halfdane the trigger is removed from the stack (CR 603.3c) and never
// resolves. The copied P/T is the target's EFFECTIVE power/toughness
// (`getPower`/`getToughness`), snapshotted and locked at resolution (CR 611.2).
// The set is scoped to the controller's next upkeep (CR 500.2), reverting
// Halfdane to 3/3 before the re-fire.
export const halfdane: CardDefinition = {
    id: "2e939761-3542-4044-9038-d1d30c6a38fc",
    rarity: "rare",
    name: "Halfdane",
    oracleText:
        "At the beginning of your upkeep, change Halfdane's base power and toughness to the power and toughness of target creature other than Halfdane until your next upkeep.",
    manaCost: { X: 1, W: 1, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Shapeshifter"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        {
            ...phaseTrigger({
                id: "halfdane-copy-pt",
                oracleText:
                    "At the beginning of your upkeep, change Halfdane's base power and toughness to the power and toughness of target creature other than Halfdane until your next upkeep.",
                phase: "UPKEEP",
                scope: "your",
                // NOT DSL-migratable (ADR 0045): the `setBasePT` Op (CR 613.4b,
                // issue #1318) now ships, BUT it takes LITERAL power/toughness
                // only. Halfdane sets its base P/T to a SNAPSHOT of the target's
                // effective P/T (`ctx.getPower(target)` / `getToughness`, CR
                // 611.2) — a value-from-target read the `EffectValue` grammar
                // (literal / bound-snapshot ref / count) can't express for an
                // ANNOUNCED target (no bound snapshot exists for it). Blocked
                // on: a target-P/T value construct, NOT the setBasePT Op. Same
                // gap flagged for Wood Elemental / Sentinel.
                resolve: (ctx) => {
                    const self = ctx.sourceInstanceId;
                    // CR 603.3d — the target was chosen when the trigger was put
                    // on the stack (`targetRequirement` below); read it back
                    // instead of raising a resolution-time choice.
                    const target = ctx.targets[0];
                    if (!target) return; // CR 608.2b — target left / no legal target
                    // CR 611.2 — snapshot the target's effective P/T now and lock it.
                    const power = ctx.getPower(target);
                    const toughness = ctx.getToughness(target);
                    ctx.setBasePT(
                        { type: "permanent", id: self },
                        power,
                        toughness,
                        { phase: "upkeep", player: "controller" }
                    );
                },
            }),
            // CR 603.3d — "target creature other than Halfdane" chosen at stack
            // placement (issue #1193, `raiseTriggerTargetSelection`), subject to
            // hexproof / protection / ward. `excludeSource` self-excludes
            // Halfdane ("other than ~"); `count: 1` is a MANDATORY single target
            // (no "may" in the modern Oracle text).
            targetRequirement: {
                type: "Creature",
                count: 1,
                excludeSource: true,
            },
        },
    ],
};
