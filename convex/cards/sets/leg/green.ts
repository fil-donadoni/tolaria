// Legends (LEG) — Green (mono-G) cards, split by colour per ADR 0043.
// The registry's `import * as leg from "./sets/leg"` resolves through
// leg/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).

import type {
    CardDefinition,
    SpellContext,
    PermanentView,
    GameEvent,
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
// Resolved in steps (CR 608.2) because the draw is IRREVERSIBLE and must run
// once, before the topdeck selection that suspends — a single `resolve` would
// re-draw on every resume (the Bazaar of Baghdad bug). Steps:
//   0. may-draw decision; if accepted, draw two (isolated → drawn once).
//   1. a SINGLE ranged selection over the N = min(2, cardsDrawnThisTurnStill-
//      InHand) cards drawn this turn. The chooser selects 0..N of them to put
//      on top of the library; for each of the N NOT selected, they pay 4 life
//      (CR 118.4). The two printed per-card options ("pay 4 / put on top") are
//      collapsed into one pick — the reachable outcomes are identical (keep
//      both = pay 8, topdeck both = pay 0, mix = pay 4).
//
// `recallChoice` carries the may-draw answer forward (per-step choice keys
// can't be re-read by a later step otherwise). The topdeck commit reads the
// pick back directly from the SAME step's choiceId.
//
// CR 119.4 ("can't pay life you don't have"): a player can keep at most
// floor(life / 4) of the N cards, so the MINIMUM number that must be topdecked
// is max(0, N − floor(life / 4)). With life < 4 all N must be topdecked. The
// ranged choice's `min` enforces this server-side and the Done button enables
// at that minimum client-side.
export const sylvanLibrary: CardDefinition = {
    id: "f486df00-7c4a-4ff0-bb0b-c8b5432ac742",
    rarity: "uncommon",
    name: "Sylvan Library",
    oracleText:
        "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "sylvan-library-draw-step",
            oracleText:
                "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.",
            event: "PHASE_BEGIN",
            matches: (event: GameEvent, self: PermanentView) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "DRAW" &&
                event.activePlayerId === self.controllerId,
            // NOT DSL-migratable (ADR 0045, issue #849): has NO per-card test, so
            // it is not AFK-eligible (green-before is the migration's whole
            // safety mechanism). Independently blocked beyond `optionChoice`: the
            // step-1 body is a ranged topdeck selection (choose 0..N drawn-this-
            // turn cards) whose per-card life cost is "4 for each NOT selected"
            // — a choice-result-cardinality + pay-life composition the current
            // Op vocabulary can't express (the `optionChoice` here is only the
            // step-0 may-draw). Stays resolve().
            resolveSteps: [
                // Step 0 — "you may draw two additional cards" (CR 121.1).
                // Isolated so the draw never re-runs on a later suspension.
                (ctx: SpellContext) => {
                    const accept = ctx.requestOptionChoice({
                        playerId: ctx.controller,
                        choiceId: "sylvan-may",
                        options: [
                            { id: "draw", label: "Draw two cards" },
                            { id: "decline", label: "Don't draw" },
                        ],
                        prompt: "Sylvan Library: draw two additional cards?",
                    });
                    if (accept === undefined) return; // suspended
                    if (accept === "draw") ctx.drawCards(ctx.controller, 2);
                },
                // Step 1 — the SINGLE ranged topdeck selection (CR 118.4 /
                // 121.1). The chooser selects which of the N drawn-this-turn
                // cards to put on top of the library; each of the N NOT
                // selected costs 4 life. On resume the picks are read back from
                // this same step's choiceId and committed (topdeck + pay).
                (ctx: SpellContext) => {
                    if (ctx.recallChoice("sylvan-may")?.[0] !== "draw") return;
                    const controller = ctx.controller;
                    const hand = new Set(ctx.getHandIds(controller));
                    // Candidate pool: every card drawn this turn still in hand.
                    // The player may topdeck up to N = min(2, pool) of them
                    // ("choose two cards … put the card on top"); each of the N
                    // they DON'T topdeck costs 4 life.
                    const pool = ctx
                        .getDrawnThisTurnIds(controller)
                        .filter((id) => hand.has(id));
                    const n = Math.min(2, pool.length);
                    if (n === 0) return;
                    // CR 119.4 — keep at most floor(life / 4) cards, so at least
                    // max(0, N − floor(life / 4)) must be topdecked. With
                    // life < 4 all N must go on top.
                    const keepCap = Math.floor(ctx.getLife(controller) / 4);
                    const minTopdeck = Math.max(0, n - keepCap);
                    const picks = ctx.requestChoice({
                        playerId: controller,
                        choiceId: "sylvan-pick",
                        kind: "choose-hand-card",
                        zone: "hand",
                        candidateIds: pool,
                        count: { min: minTopdeck, max: n },
                        prompt: `Select up to ${n} card${n === 1 ? "" : "s"} drawn this turn to put on top of your library; pay 4 life for each of the ${n} you keep.`,
                    });
                    if (picks === undefined) return; // suspended
                    // Commit: selected cards go on top of the library; pay 4
                    // life for each of the N that was NOT selected (kept).
                    const topdeck = picks.filter((id) => hand.has(id));
                    for (const id of topdeck) {
                        ctx.moveHandCardToLibraryTop(controller, id);
                    }
                    const kept = n - topdeck.length;
                    if (kept > 0) ctx.loseLife(controller, 4 * kept);
                },
            ],
        },
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

// Cat Warriors — forestwalk (CR 702.19 landwalk variant).
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
// it." (CR 702.21 vigilance + a `pt-cda` that counts Auras attached to the
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
// end of turn." (CR 702.9 flying + CR 611.1b end-of-turn keyword grant.)
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
            // strike until end of turn (CR 611.1b).
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
// of turn." (CR 702.9 flying + CR 611.1b keyword grant on a chosen target.)
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
            // announced target creature until end of turn (CR 611.1b).
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
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            if (pid === ctx.caster) continue;
            const islands = ctx.getBattlefieldIds(pid, {
                types: "Land",
                subtypes: "Island",
            }).length;
            if (islands > 0) {
                ctx.dealDamage({ type: "player", id: pid }, islands);
            }
        }
    },
};

// --- Combat tricks (CR 611.1) ----------------------------------------------

// Winter Blast — "Tap X target creatures. Winter Blast deals 2 damage to each
// of those creatures with flying." (CR 107.3 X chosen on cast → CR 701.20a tap
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
    // NOT DSL-migratable (ADR 0045): acts on a VARIABLE number (X) of announced
    // targets (no forEach-over-target-slots construct) and gates the 2 damage on
    // "those creatures with flying" (a subset of the targets, not expressible by
    // a value/filter). Also has no per-card test, so it is not AFK-eligible.
    // Blocked on: an announced-targets iteration construct + a per-target flying
    // predicate.
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
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") {
                ctx.setColorOverride(target, ["G"]);
            }
        }
    },
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
// until end of turn." (CR 611.1b layer-6 duration-scoped keyword removal.)
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
// CR 701.16 sacrifice, CR 613.1b/6 flying grant.
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
            // CR 603.4d — only fires if it dealt damage to an opponent this
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
