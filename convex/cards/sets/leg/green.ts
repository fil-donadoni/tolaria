// Legends (LEG) — Green (mono-G) cards, split by colour per ADR 0043.
// The registry's `import * as leg from "./sets/leg"` resolves through
// leg/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).

import type {
    CardDefinition,
    SpellContext,
    PermanentView,
    TargetSelection,
} from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { rampageTrigger } from "../../abilities/triggers/rampageTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// World enchantments (CR 205.4a — World supertype; CR 704.5m world rule lands
// as an SBA in cluster C2, #379). A World permanent carries the `World`
// supertype as data; the world-rule SBA (`checkWorldRuleSBA`) consumes the flag
// globally: when two or more World permanents exist, all but the newest go to
// their owners' graveyards (a simultaneous tie destroys all of them). These two
// carry no other new mechanic — their continuous effects ride the existing
// layer system (keyword grant / removal, CR 613.1a layer 6) — so they double as
// the real cards the world-rule SBA acts on.
// ─────────────────────────────────────────────────────────────────────────────

// Concordant Crossroads — World enchantment, "All creatures have haste."
// (CR 702.10, 613.1a layer 6 — keyword-grant to every creature, any controller.)
export const concordantCrossroads: CardDefinition = {
    id: "3bdcfae4-86c9-4d8a-bcfe-f0a928ec29db",
    rarity: "rare",
    name: "Concordant Crossroads",
    oracleText: "All creatures have haste.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    staticEffects: [
        {
            kind: "keyword-grant",
            // Global — every creature on the battlefield, regardless of
            // controller (CR 109.2 "all creatures").
            applies: (target: PermanentView) =>
                target.types.includes("Creature"),
            keyword: "haste",
        },
    ],
};

// Sylvan Library — "At the beginning of your draw step, you may draw two
// additional cards. If you do, choose two cards in your hand drawn this turn.
// For each of those cards, pay 4 life or put the card on top of your library."
// (CR 603.6a draw-step trigger, CR 121.1 draw, CR 118.4 life payment.)
//
// Migrated resolve()→effects[] (ADR 0045, issue #1283) via two Ops: the "you
// may draw two additional cards" decision is a cost-free `mayPay` (issue
// #680 — `cost` omitted, `bind: "$mayDraw"`) feeding an `if` whose `then`
// runs the draw + topdeck body and whose `else` is simply OMITTED (the `if`
// construct's else is optional — Squee, Goblin Nabob, `mmq/red.ts`, is the
// reference shape for this exact idiom). `optionChoice` was considered and
// rejected here: EVERY mode's `effects` must be non-empty (`isModeList`), and
// "decline" is a genuine no-op with nothing to put in it — the project
// deliberately has no no-op Op to plug that gap (fem/blue.ts,
// fem/colorless.ts document the same constraint). The topdeck-or-pay body is
// the new `rangedTopdeck` Op (a single ranged 0..N "drawn this turn" hand
// pick with a per-NOT-chosen life cost — the two printed per-card options,
// "pay 4 / put on top", are collapsed into one pick since the reachable
// outcomes are identical: keep both = pay 8, topdeck both = pay 0, mix = pay
// 4). No `resolveSteps` isolation needed any more: `runOpList` checkpoints
// EACH Op's own pre-order position (CR 608.3), so the irreversible "draw two"
// inside the `if`'s `then` is skipped on resume exactly like the old
// hand-rolled `resolveSteps` split — the interpreter's own checkpointing now
// does for free what that split used to need by hand (mirrors `putBack`'s
// doc note on the identical Brainstorm-era bug).
export const sylvanLibrary: CardDefinition = {
    id: "f486df00-7c4a-4ff0-bb0b-c8b5432ac742",
    rarity: "uncommon",
    name: "Sylvan Library",
    oracleText:
        "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "sylvan-library-draw-step",
            oracleText:
                "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.",
            phase: "DRAW",
            scope: "your",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Sylvan Library: draw two additional cards?",
                    bind: "$mayDraw",
                },
                {
                    op: "if",
                    predicate: { binding: "$mayDraw" },
                    then: [
                        { op: "draw", player: "controller", count: 2 },
                        {
                            op: "rangedTopdeck",
                            player: "controller",
                            pool: "drawn-this-turn",
                            max: 2,
                            costPerKept: 4,
                        },
                    ],
                },
            ],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Green free tranche (#375) — every mono-green Legends card expressible with
// existing primitives (keywords, staticEffects / layer system incl. pt-cda,
// block-restriction static, trigger factories, library tutor, SpellContext
// methods). Data + resolve() closures only; zero engine change (ADR 0014).
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • C3 Rampage (#380, shipped) — Craw Giant (rampage 2), Wolverine Pack
//     (rampage 2). Now defined at the foot of this file via `rampageTrigger`.
//   • C4 bands-with-other — Master of the Hunt (Wolves-of-the-Hunt token band),
//     Shelkin Brownie ("loses all bands-with-other abilities").
//   • C5 named counters — Cocoon (pupa counters), Whirling Dervish (+1/+1
//     counter on its own combat-damage end-step trigger).
//   • World rule (C2) — Concordant Crossroads, Living Plane, Revelation. These
//     carry the World supertype; like every other World-supertype LEG card they
//     are deferred to the world-rule cluster so the supertype and its SBA ship
//     together (mirrors the blue/black/red tranches).
//   • C9 conditional attack restriction (World) — Arboria. SHIPPED in the C9
//     section at the foot of this file (#386).
//
// Out of scope for the whole set (per #369): Rebirth (ante, ADR 0010).
//
// Cards that genuinely need an unbuilt primitive are SKIPPED (not built here):
//   • Aisling Leprechaun / Floral Spuzzem — "whenever this blocks / becomes
//     blocked" and "whenever this attacks and isn't blocked" need a combat
//     attack/block triggered-ability factory; only ETB/death/tap/cast/phase
//     factories exist.
//   • Avoid Fate — "counter target instant or Aura spell that targets a
//     permanent you control" needs a spell-target predicate gating the legal
//     spell on what IT targets; the `spell` target requirement only filters the
//     spell's own types, not its targets.
//   • Deadfall — "creatures with forestwalk can be blocked as though they
//     didn't have forestwalk" — buildable with the `landwalk-negation` static
//     (Great Wall / Undertow, #484), `subtypes: ["Forest"]`. Deferred to its
//     tranche.
//   • Eureka — "starting with you, each player may put a permanent card from
//     hand onto the battlefield; repeat until no one does" needs an alternating
//     multi-player put-from-hand loop with no primitive.
//   • Glyph of Reincarnation — destroy creatures a target Wall blocked this turn
//     and reanimate per their last-blocked controller needs per-Wall blocked-
//     history tracking with no surface.
//   • Ichneumon Druid — "other than the first instant that player casts each
//     turn" needs a per-player per-turn instant-cast tally not surfaced to
//     trigger conditions.
//   • Radjan Spirit — "target creature loses flying until end of turn" needs a
//     temporary (duration-scoped) keyword-removal; only static keyword-remove
//     (Earthbind) and keyword GRANT (Jump) exist.
//   • Reincarnation — "when that creature dies this turn, return a creature from
//     its owner's graveyard" needs a per-target delayed dies-watcher; the
//     delayed-trigger timings are phase boundaries only, not "when X dies".
//   • Rust — "counter target activated ability from an artifact source" needs an
//     ability-on-the-stack target type that does not exist.
//   • Subdue — "prevent all combat damage that would be dealt BY target
//     creature" needs a per-source combat-damage prevention; only the global
//     Fog-style `preventAllCombatDamage` exists.
//   • Untamed Wilds — "search your library for a basic land card" needs a
//     basic-supertype filter on hidden library cards; `getLibraryCards` exposes
//     only id/types/manaValue, so the candidate allow-list can't isolate
//     basics without widening that accessor (an engine change).
//   • Willow Satyr — "gain control of target legendary creature for as long as
//     you control this AND this remains tapped" needs a control-change condition
//     combining controls-source + source-tapped; only the separate
//     `controller-controls-source` and `source-tapped-and-power-ge` kinds exist
//     (same may-not-untap clause deferred for Old Man of the Sea).
//   • Wood Elemental — "P/T each equal to the number of Forests sacrificed as it
//     entered" needs an entry-time sacrifice count stored and read by a CDA (or
//     an indefinite base-P/T set); only phase-scoped `setBasePT` exists.
// ─────────────────────────────────────────────────────────────────────────────

// --- Vanilla / keyword creatures (CR 110.1 / 702 — pure data) -------------

// Barbary Apes — vanilla 2/2 Ape (CR 110.1).
export const barbaryApes: CardDefinition = {
    id: "df25ffdd-995d-46ae-856b-f6368f9438ed",
    rarity: "common",
    name: "Barbary Apes",
    oracleText: "",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Ape"],
    power: 2,
    toughness: 2,
};

// Durkwood Boars — vanilla 4/4 Boar (CR 110.1).
export const durkwoodBoars: CardDefinition = {
    id: "8d41f08b-68fb-45f2-bdc9-488baedc7d6f",
    rarity: "common",
    name: "Durkwood Boars",
    oracleText: "",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Boar"],
    power: 4,
    toughness: 4,
};

// Moss Monster — vanilla 3/6 Elemental (CR 110.1).
export const mossMonster: CardDefinition = {
    id: "9903c043-9a7a-4994-b532-136d4c46edfd",
    rarity: "common",
    name: "Moss Monster",
    oracleText: "",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 3,
    toughness: 6,
};

// Cat Warriors — forestwalk (CR 702.14 landwalk variant).
export const catWarriors: CardDefinition = {
    id: "d2187a64-2823-4f58-ad35-70f8913db2dc",
    rarity: "common",
    name: "Cat Warriors",
    oracleText:
        "Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Cat", "Warrior"],
    power: 2,
    toughness: 2,
    staticAbilities: ["forestwalk"],
};

// Hornet Cobra — first strike (CR 702.7).
export const hornetCobra: CardDefinition = {
    id: "27180bad-9bbc-462b-8832-626dc403a3fd",
    rarity: "common",
    name: "Hornet Cobra",
    oracleText: "First strike",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Snake"],
    power: 2,
    toughness: 1,
    staticAbilities: ["first strike"],
};

// Elven Riders — "can't be blocked except by Walls and/or creatures with
// flying" (CR 509.1b block restriction via a `block-restriction` static on the
// attacker side; the combat validator scans the attacker's own statics).
export const elvenRiders: CardDefinition = {
    id: "ad1d349b-b5ab-4b2b-9b39-f8d8f6374aa5",
    rarity: "rare",
    name: "Elven Riders",
    oracleText:
        "This creature can't be blocked except by Walls and/or creatures with flying.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 3,
    toughness: 3,
    staticEffects: [
        {
            // A `block-restriction` declared on a creature's own
            // `staticEffects` is intrinsic to that creature: `side: "attacker"`
            // means `self` is this attacker and `opponent` is the candidate
            // blocker (CR 509.1b). Legal blockers are Walls and/or creatures
            // with flying (CR 702.9).
            kind: "block-restriction",
            id: "elven-riders-walls-or-flyers-only",
            side: "attacker" as const,
            predicate: (_self, opponent) =>
                opponent.subtypes.includes("Wall") ||
                (
                    (opponent as { staticAbilities?: string[] })
                        .staticAbilities ?? []
                ).includes("flying"),
            oracleText:
                "This creature can't be blocked except by Walls and/or creatures with flying.",
        },
    ],
};

// --- pt-cda creatures (CR 604.3 — characteristic-defining P/T) -------------

// Rabid Wombat — Vigilance; "This creature gets +2/+2 for each Aura attached to
// it." (CR 702.20 vigilance + a `pt-cda` that counts Auras attached to the
// source at stat-read time, added on top of its base 0/1.)
export const rabidWombat: CardDefinition = {
    id: "9d9b9eb8-6367-4ab5-8e00-a9c9e1d69032",
    rarity: "uncommon",
    name: "Rabid Wombat",
    oracleText:
        "Vigilance\nThis creature gets +2/+2 for each Aura attached to it.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Wombat"],
    power: 0,
    toughness: 1,
    staticAbilities: ["vigilance"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                let auras = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.subtypes.includes("Aura") &&
                            p.attachedTo === source.id
                        ) {
                            auras++;
                        }
                    }
                }
                return { power: auras * 2, toughness: auras * 2 };
            },
        },
    ],
};

// --- Activated-ability creatures (CR 605) ----------------------------------

// Emerald Dragonfly — Flying; "{G}{G}: This creature gains first strike until
// end of turn." (CR 702.9 flying + CR 611.2a end-of-turn keyword grant.)
export const emeraldDragonfly: CardDefinition = {
    id: "a3e81250-52c3-49f6-be43-17c34339e177",
    rarity: "common",
    name: "Emerald Dragonfly",
    oracleText:
        "Flying\n{G}{G}: This creature gains first strike until end of turn.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "emerald-dragonfly-first-strike",
            oracleText:
                "{G}{G}: This creature gains first strike until end of turn.",
            cost: { mana: { G: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant first
            // strike until end of turn (CR 611.2a).
            effects: [
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Fire Sprites — Flying; "{G}, {T}: Add {R}." (CR 702.9 flying + CR 605.1a mana
// ability — `useStack: false`, resolves immediately, no priority.)
export const fireSprites: CardDefinition = {
    id: "d26fa79a-ede8-4c80-98d5-f49696f8104d",
    rarity: "common",
    name: "Fire Sprites",
    oracleText: "Flying\n{G}, {T}: Add {R}.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "fire-sprites-mana",
            oracleText: "{G}, {T}: Add {R}.",
            cost: { mana: { G: 1 }, tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 1 }),
            manaProduced: { R: 1 },
        },
    ],
};

// Killer Bees — Flying; "{G}: This creature gets +1/+1 until end of turn."
// (CR 702.9 flying + CR 611.1 repeatable temporary buff.)
export const killerBees: CardDefinition = {
    id: "2e30b5ff-1239-4c4d-ac7c-554ecf8e1e27",
    rarity: "rare",
    name: "Killer Bees",
    oracleText: "Flying\n{G}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "killer-bees-pump",
            oracleText: "{G}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { G: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #840): self-pump +1/+1
            // until end of turn (CR 611.1) via the `pump` Op.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Pixie Queen — Flying; "{G}{G}{G}, {T}: Target creature gains flying until end
// of turn." (CR 702.9 flying + CR 611.2a keyword grant on a chosen target.)
export const pixieQueen: CardDefinition = {
    id: "b9527c2a-23bb-4d33-9e72-6e0ab3de0e6b",
    rarity: "rare",
    name: "Pixie Queen",
    oracleText:
        "Flying\n{G}{G}{G}, {T}: Target creature gains flying until end of turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "pixie-queen-grant-flying",
            oracleText:
                "{G}{G}{G}, {T}: Target creature gains flying until end of turn.",
            cost: { mana: { G: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #843): grant flying to the
            // announced target creature until end of turn (CR 611.2a).
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

// Pradesh Gypsies — "{1}{G}, {T}: Target creature gets -2/-0 until end of
// turn." (CR 611.1 temporary debuff via a tap ability.)
export const pradeshGypsies: CardDefinition = {
    id: "0370330d-83d9-44d2-a1ed-c4827edc60fd",
    rarity: "uncommon",
    name: "Pradesh Gypsies",
    oracleText: "{1}{G}, {T}: Target creature gets -2/-0 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Nomad"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "pradesh-gypsies-debuff",
            oracleText:
                "{1}{G}, {T}: Target creature gets -2/-0 until end of turn.",
            cost: { mana: { X: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #840): -2/-0 to the
            // targeted creature until end of turn (CR 611.1) via `pump`.
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: -2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// --- Burn spells scaling on a per-player count (CR 120.1) ------------------

// Storm Seeker — "Storm Seeker deals damage to target player equal to the
// number of cards in that player's hand." (CR 120.1 damage = hand-size snapshot
// at resolution, CR 402.1.)
export const stormSeeker: CardDefinition = {
    id: "3b66d0cc-84d7-41ad-b0e7-74ebf604543f",
    rarity: "uncommon",
    name: "Storm Seeker",
    oracleText:
        "Storm Seeker deals damage to target player equal to the number of cards in that player's hand.",
    manaCost: { X: 3, G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    // UNBLOCKED since issue #2006: the damage amount is "the number of cards
    // in that player's HAND", and `count` now has a `zone: "hand"` member
    // (CR 402.2 — hidden zone, public SIZE, the `library` member's twin), so
    // `{ count: { zone: "hand", controller: { target: 0 } } }` expresses this
    // exactly. The closure stays only because migrating it is free-tranche
    // work with its own batch, not part of the issue that shipped the member.
    // tracked-by: #1438
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        ctx.dealDamage(target, ctx.getHandSize(target.id));
    },
};

// Typhoon — "Typhoon deals damage to each opponent equal to the number of
// Islands that player controls." (CR 120.1 damage scaled per opponent's Island
// count, CR 205.3.)
export const typhoon: CardDefinition = {
    id: "254e0403-67d8-4e73-8d89-c901ebeba49f",
    rarity: "rare",
    name: "Typhoon",
    oracleText:
        "Typhoon deals damage to each opponent equal to the number of Islands that player controls.",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    // Migrated resolve()→effects[] (ADR 0045): 2-player game (CR 102.2), so
    // "each opponent" is the plain `"opponent"` player selector (The Fallen
    // shape, `drk/black.ts`); the amount is a `count` of the opponent's
    // battlefield filtered to the Island subtype. `dealDamage` no-ops on a
    // resolved amount of 0 (`reduced <= 0` guard in `SpellContext.dealDamage`),
    // matching the original `if (islands > 0)` guard exactly.
    effects: [
        {
            op: "dealDamage",
            amount: {
                count: {
                    zone: "battlefield",
                    controller: "opponent",
                    filter: { subtype: "Island" },
                },
            },
            to: { player: "opponent" },
        },
    ],
};

// --- Combat tricks (CR 611.1) ----------------------------------------------

// Winter Blast — "Tap X target creatures. Winter Blast deals 2 damage to each
// of those creatures with flying." (CR 107.3 X chosen on cast → CR 701.26a tap
// of each target → CR 120.1 damage gated on flying, snapshot at resolution.)
export const winterBlast: CardDefinition = {
    id: "fb846366-2105-4999-8af1-a11687f42e17",
    rarity: "rare",
    name: "Winter Blast",
    oracleText:
        "Tap X target creatures. Winter Blast deals 2 damage to each of those creatures with flying.",
    manaCost: { X: "X", G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: "X" },
    // NOT DSL-migratable (ADR 0045), re-assessed: the VARIABLE-target-count
    // iteration gap is CLOSED (`{ set: "targets" }` forEach selector, issue
    // #1083). The remaining blocker is narrower: gating the 2 damage on
    // "those creatures WITH FLYING" — a per-member keyword-ability predicate —
    // has no `EffectPredicate` member (the grammar has binding/comparison/
    // picks-nonempty/target-is-another/picks-match-filter, none of which read
    // "has ability X"). Also has no per-card test, so it is not AFK-eligible
    // regardless. Blocked on: a has-keyword-ability `EffectPredicate` member.
    resolve: (ctx: SpellContext) => {
        // "each of those creatures with flying" — derive the flying set from
        // the live battlefield (CR 702.9, snapshot at resolution) and gate the
        // 2 damage on membership.
        const flyers = new Set<string>();
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
                requireAbility: "flying",
            })) {
                flyers.add(id);
            }
        }
        for (const target of ctx.targets) {
            if (target.type !== "permanent") continue;
            ctx.tap(target);
            if (flyers.has(target.id)) ctx.dealDamage(target, 2);
        }
    },
};

// Sylvan Paradise — "One or more target creatures become green until end of
// turn." (CR 305.7 layer-5 colour override, end-of-turn duration; variable
// target count, CR 601.2c.)
export const sylvanParadise: CardDefinition = {
    id: "f323c3bb-cece-4035-b1a7-c4817cf7a08c",
    rarity: "uncommon",
    name: "Sylvan Paradise",
    oracleText: "One or more target creatures become green until end of turn.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1 } },
    // Migrated resolve()→effects[] (ADR 0045): `{ set: "targets" }` iterates
    // the WHOLE variable-count announced target set (issue #1083), each
    // member set via `setColor` with an end-of-turn duration (CR 305.7 /
    // 611.2c — the colour override expires at cleanup via
    // `tickAllDurations`/`finalizeCleanup`, mirroring the sibling colour-
    // change spells `leg/blue.ts` and `leg/black.ts`). Fixed issue #1834
    // (the duration was previously dropped, making the change permanent —
    // same shape as Dwarven Song, `red.ts`, issue #1833).
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [
                {
                    op: "setColor",
                    target: { ref: "$each" },
                    colors: ["G"],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Craw Giant — {3}{G}{G}{G}{G} 6/4, Trample, Rampage 2.
export const crawGiant: CardDefinition = {
    id: "707dadf0-735f-445d-9240-e49660913314",
    rarity: "uncommon",
    name: "Craw Giant",
    oracleText:
        "Trample\nRampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, G: 4 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 6,
    toughness: 4,
    staticAbilities: ["trample", "rampage 2"],
    triggeredAbilities: [rampageTrigger(2)],
};

// Wolverine Pack — {2}{G}{G} 2/4, Rampage 2.
export const wolverinePack: CardDefinition = {
    id: "ba5aee52-095e-4c69-93eb-5adac11ed1fc",
    rarity: "common",
    name: "Wolverine Pack",
    oracleText:
        "Rampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Wolverine"],
    power: 2,
    toughness: 4,
    staticAbilities: ["rampage 2"],
    triggeredAbilities: [rampageTrigger(2)],
};

// Master of the Hunt — "{2}{G}{G}: Create a 1/1 green Wolf creature token named
// Wolves of the Hunt. It has 'bands with other creatures named Wolves of the
// Hunt.'" (CR 702.22j name-quality band via a token with the parametric
// keyword.) The token's name-quality keyword lets every Wolves-of-the-Hunt
// token band together (CR 702.22j: all members share the name).
export const masterOfTheHunt: CardDefinition = {
    id: "4e6bf56e-2d74-4e4d-a667-885853979377",
    rarity: "rare",
    name: "Master of the Hunt",
    oracleText:
        '{2}{G}{G}: Create a 1/1 green Wolf creature token named Wolves of the Hunt. It has "bands with other creatures named Wolves of the Hunt."',
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "master-of-the-hunt-wolves",
            oracleText:
                '{2}{G}{G}: Create a 1/1 green Wolf creature token named Wolves of the Hunt. It has "bands with other creatures named Wolves of the Hunt."',
            cost: { mana: { X: 2, G: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #847): create one 1/1
            // green Wolf token named Wolves of the Hunt with "bands with other
            // creatures named Wolves of the Hunt" on the controller's
            // battlefield (CR 111 / 707.1). No `imagePrintId` — Scryfall has
            // no printed Wolves of the Hunt token for Master of the Hunt
            // (`all_parts` is empty), so this stays a placeholder-rendered
            // token by design (issue #941 documented exception).
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Wolves of the Hunt",
                        types: ["Creature"],
                        subtypes: ["Wolf"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                        staticAbilities: [
                            "bands with other:name=Wolves of the Hunt",
                        ],
                    },
                    controller: "controller",
                },
            ],
        },
    ],
};

// Shelkin Brownie — "{T}: Target creature loses all 'bands with other' abilities
// until end of turn." (CR 611.2a layer-6 duration-scoped keyword removal.)
export const shelkinBrownie: CardDefinition = {
    id: "fddcc557-871d-425b-b4ee-bc0c9bc717aa",
    rarity: "common",
    name: "Shelkin Brownie",
    oracleText:
        '{T}: Target creature loses all "bands with other" abilities until end of turn.',
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Ouphe"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "shelkin-brownie-strip",
            oracleText:
                '{T}: Target creature loses all "bands with other" abilities until end of turn.',
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // NOT DSL-migratable (ADR 0045): `removeStaticAbilities` takes a
            // PREDICATE closure (any "bands with other:"-prefixed keyword) —
            // no Op wraps ability REMOVAL (only `grantAbility`'s GRANT
            // direction is an Op; New-Op backlog `removeStaticAbilities`,
            // migration-classifier.mjs; same gap as Tolaria's strip ability,
            // `colorless.ts`). Blocked on: a keyword-removal Op.
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.removeStaticAbilities(
                    target,
                    (kw) => kw.startsWith("bands with other:"),
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Cocoon — {G} Aura ("Enchant creature you control"). ETB taps the host and
// puts three pupa counters ON THE AURA; the host doesn't untap while the Aura
// has a pupa counter; each upkeep remove a pupa counter, and if none remain to
// remove, sacrifice the Aura, put a +1/+1 counter on the host, and the host
// gains flying. CR 122 (counters on the Aura itself), CR 502.1 untap skip,
// CR 701.21 sacrifice, CR 613.1b/6 flying grant.
export const cocoon: CardDefinition = {
    id: "a82c87b1-de37-4423-a1a4-533a1d8108b2",
    rarity: "uncommon",
    name: "Cocoon",
    oracleText:
        "Enchant creature you control\nWhen this Aura enters, tap enchanted creature and put three pupa counters on this Aura.\nEnchanted creature doesn't untap during your untap step if this Aura has a pupa counter on it.\nAt the beginning of your upkeep, remove a pupa counter from this Aura. If you can't, sacrifice it, put a +1/+1 counter on enchanted creature, and that creature gains flying.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    staticEffects: [
        {
            // CR 502.1 — the host doesn't untap while the AURA (source) still
            // holds a pupa counter. Predicate reads the source's counters.
            kind: "keyword-grant",
            // CR 613.5 (issue #1711) — same materialization gap as Venarian
            // Gold, with the counters on the SOURCE: `refreshCounterGatedStatics`
            // re-runs the whole predicate, so either side is covered.
            dependsOnCounters: true,
            applies: (target, source) =>
                target.id === source.attachedTo &&
                (source.counters?.pupa ?? 0) > 0,
            keyword: "does-not-untap",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "cocoon-etb",
            oracleText:
                "When this Aura enters, tap enchanted creature and put three pupa counters on this Aura.",
            scope: "self",
            // NOT DSL-migratable (ADR 0045): taps the ENCHANTED creature — the
            // Aura's attached host, read via `getAttachedToId`. The
            // EffectObjectSelector grammar has no attached-object member.
            // Blocked on: an attached-object EffectObjectSelector.
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (hostId) ctx.tap({ type: "permanent", id: hostId });
                // CR 122.1 — counters go on the Aura itself.
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "pupa",
                    3
                );
            },
        }),
        phaseTrigger({
            id: "cocoon-upkeep",
            oracleText:
                "At the beginning of your upkeep, remove a pupa counter from this Aura. If you can't, sacrifice it, put a +1/+1 counter on enchanted creature, and that creature gains flying.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): the hatch branch acts on the
            // Aura's ENCHANTED creature (host), read via `getAttachedToId` —
            // the `EffectObjectSelector` grammar has no attached-host ref
            // (same gap as the sibling `cocoon-etb` trigger above and The
            // Brute's regenerate ability, `red.ts`). Blocked on: an
            // attached-host object selector.
            // The INDEFINITE flying grant ("that creature gains flying", no
            // duration) is NOT a blocker: omitting `duration` on the
            // `grantAbility` Op routes to `grantStaticAbilityPermanent`
            // (CR 611.2b, issue #1746) — the same source-independent primitive
            // the closure below already calls directly.
            resolve: (ctx) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const pupa = ctx.getCounterCount(self, "pupa");
                if (pupa > 0) {
                    ctx.removeCounter(self, "pupa", 1);
                    return;
                }
                // CR 122.6 — "if you can't" remove a counter: hatch. Snapshot
                // the host BEFORE sacrificing the Aura (sacrifice detaches it).
                const hostId = ctx.getAttachedToId();
                ctx.sacrifice(ctx.sourceInstanceId);
                if (!hostId) return;
                const host: TargetSelection = { type: "permanent", id: hostId };
                ctx.addCounter(host, "+1/+1", 1);
                ctx.grantStaticAbilityPermanent(host, "flying");
            },
        }),
    ],
};

// Whirling Dervish — {G}{G} 1/1, protection from black. "At the beginning of
// each end step, if this creature dealt damage to an opponent this turn, put a
// +1/+1 counter on it." CR 702.16 protection, CR 603.6a end-step state-condition
// trigger (intervening-if reads the turn-scoped `dealtDamageToOpponentThisTurn`
// flag), CR 122.1 +1/+1 counter.
export const whirlingDervish: CardDefinition = {
    id: "eba294e7-7097-4bc3-b396-72e85dd4f441",
    rarity: "uncommon",
    name: "Whirling Dervish",
    oracleText:
        "Protection from black\nAt the beginning of each end step, if this creature dealt damage to an opponent this turn, put a +1/+1 counter on it.",
    manaCost: { G: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Monk"],
    power: 1,
    toughness: 1,
    staticAbilities: ["protection from black"],
    triggeredAbilities: [
        phaseTrigger({
            id: "whirling-dervish-end-step",
            oracleText:
                "At the beginning of each end step, if this creature dealt damage to an opponent this turn, put a +1/+1 counter on it.",
            phase: "END_STEP",
            scope: "each",
            // CR 603.4 — only fires if it dealt damage to an opponent this
            // turn. Re-checked at resolve (the flag persists to CLEANUP).
            interveningIf: (_event, self) =>
                self.dealtDamageToOpponentThisTurn === true,
            // CR 122 (issue #841) — put one +1/+1 counter on the source.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
};

// Arboria — {2}{G}{G} World Enchantment. "Creatures can't attack a player
// unless that player cast a spell or put a nontoken permanent onto the
// battlefield during their last turn." (CR 508.1c — defender-history attack
// restriction; engine-enforced by id via per-player turn-history flags.)
export const arboria: CardDefinition = {
    id: "095078b0-0f26-442f-9d3b-45e30cdb33c4",
    rarity: "uncommon",
    name: "Arboria",
    oracleText:
        "Creatures can't attack a player unless that player cast a spell or put a nontoken permanent onto the battlefield during their last turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Enchantment"],
    supertypes: ["World"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Giant Turtle (#490) — "attacked during your last turn" self attack
// restriction.
//
// CR 508.1 — a creature's attack-restriction static is checked when it's
// declared as an attacker. The engine snapshots `attackedDuringLastTurn` per
// creature at its controller's CLEANUP (phases.ts `finalizeCleanup`, before
// `hasAttackedThisTurn` is cleared), so the predicate reads whether THIS
// creature attacked during its controller's most recent PRIOR turn — never the
// current one. Reuses the generic self `attack-restriction` plumbing
// (validateAttackerEligibility → collectAttackRestrictions), so the rule is
// data-driven and not hardcoded to Giant Turtle.
export const giantTurtle: CardDefinition = {
    id: "87e5fc19-3b10-476f-9a73-e8bf4b5fbec0",
    rarity: "common",
    name: "Giant Turtle",
    oracleText:
        "This creature can't attack if it attacked during your last turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Turtle"],
    power: 2,
    toughness: 4,
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "giant-turtle-rest-this-turn",
            oracleText:
                "This creature can't attack if it attacked during your last turn.",
            // CR 508.1 — legal only when it did NOT attack last turn.
            predicate: (self) => self.attackedDuringLastTurn !== true,
        },
    ],
};
