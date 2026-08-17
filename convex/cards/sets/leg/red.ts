// Legends (LEG) — Red (mono-R) cards, split by colour per ADR 0043.
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
import { rampageTrigger } from "../../abilities/triggers/rampageTrigger";

// Gravity Sphere — World enchantment, "All creatures lose flying."
// (CR 702.9, 613.1a layer 6 — keyword-remove on every creature, any controller.)
export const gravitySphere: CardDefinition = {
    id: "a2749332-e99a-4a0c-b3a3-5578b552fa11",
    rarity: "rare",
    name: "Gravity Sphere",
    oracleText: "All creatures lose flying.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    staticEffects: [
        {
            kind: "keyword-remove",
            applies: (target: PermanentView) =>
                target.types.includes("Creature"),
            keyword: "flying",
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Red free tranche (#374) — every mono-red Legends card expressible with
// existing primitives (keywords, staticEffects / layer system, trigger
// factories, prevention shields, delayed triggers, SpellContext methods).
// Data + resolve() closures only; zero engine change (ADR 0014).
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • C3 Rampage (#380, shipped) — Aerathi Berserker (rampage 3), Frost Giant
//     (rampage 2). Now defined at the foot of this file via `rampageTrigger`.
//   • C9 combat-cap World enchantment — Caverns of Despair ("no more than two
//     creatures can attack / block each combat") SHIPPED in the C9 section at
//     the foot of this file (#386).
//   • C5 named counters + upkeep cycle — Primordial Ooze (+1/+1 counters each
//     upkeep, pay {X} or take X damage).
//   • World rule (C2) — Gravity Sphere ("all creatures lose flying"), Land's
//     Edge, Storm World. These carry the World supertype; like every other
//     World-supertype LEG card they are deferred to the world-rule cluster so
//     the supertype and its SBA ship together (mirrors the blue/black tranches).
//
// Out of scope for the whole set (per #369): Tempest Efreet (ante, ADR 0010).
//
// Cards that genuinely need an unbuilt primitive are SKIPPED (not built here):
//   • Backdraft — "half the damage dealt by one of those sorcery spells this
//     turn" needs a per-spell damage tally; no such surface exists. (Its
//     "copy that spell" clause is now expressible via the `copyResolvingSpell`
//     / `copyStackItem` primitives shipped with Chain Lightning — only the
//     per-spell damage tally remains unbuilt.)
//   • Blazing Effigy — death damage = 3 + "damage dealt to this by other
//     sources named Blazing Effigy this turn"; no per-source-name damage tally.
//   • Crevasse — "creatures with mountainwalk can be blocked as though they
//     didn't have mountainwalk" — buildable with the `landwalk-negation` static
//     (Great Wall / Undertow, #484), `subtypes: ["Mountain"]`. Deferred to its
//     tranche.
//   • Crimson Manticore — "{R}, {T}: deal 1 damage to target attacking OR
//     blocking creature"; `combatRoleFilter` admits only one role at a time, no
//     combined "attacking-or-blocking" target filter.
//   • Disharmony — "untap target attacking creature, remove it from combat,
//     gain control of it until end of turn"; no "until end of turn" control-
//     change condition (only controls-source / source-tapped-power conditions).
//   • Falling Star — a physical-dexterity flip card; not implementable.
//   • Feint — "tap all creatures blocking target attacker; prevent all combat
//     damage by that creature and each creature blocking it" needs a per-attacker
//     blocker-set combat-damage prevention with no primitive.
//   • Firestorm Phoenix — its dies-replacement ("return to hand; until that
//     player's next turn play with it revealed and can't play it") needs a
//     can't-play + revealed-in-hand restriction with no primitive.
//   • Pyrotechnics — "4 damage divided AS YOU CHOOSE among any number of
//     targets"; only `dealDividedDamage` (divided EVENLY, Fireball) exists, no
//     player-chosen damage division.
//   • Quarum Trench Gnomes — "{T}: target Plains produces colorless mana
//     instead of white (indefinitely)" needs a continuous tap-for-mana
//     replacement; no mana-production override static.
//   • Wall of Dust — "whenever this blocks a creature, that creature can't
//     attack during its controller's next turn" needs an other-creature
//     cross-turn attack-lock (same gap flagged for Demonic Torment in black).
// ─────────────────────────────────────────────────────────────────────────────

// --- Burn / copy spells (CR 119 damage, CR 707.12 "copy this spell") -------

// Chain Lightning — "Chain Lightning deals 3 damage to any target. Then that
// player or that permanent's controller may pay {R}{R}. If the player does,
// they may copy this spell and may choose a new target for that copy."
//
// Two resolveSteps so the irreversible damage (step 0) is checkpointed before
// the may-pay gate (step 1) suspends for player input (CR 608.2 stepped
// resolution). The "may copy" / "may choose a new target" clauses compose the
// `copyResolvingSpell` (CR 707.12 "copy this spell") + `requestCopyRetarget`
// (CR 707.10c new targets) primitives — the copy is a fresh resolution that
// can itself chain again if its damaged player pays {R}{R}.
//
// "that player or that permanent's controller" (CR 119.3): for a player target
// the chooser is the player dealt damage; for a permanent target it's the
// permanent's controller. The copy is OPTIONAL and uses the stack, so it does
// not auto-resolve — paying {R}{R} is a genuine tactical choice (per the
// auto-resolve rule, a real branch keeps its prompt).
export const chainLightning: CardDefinition = {
    id: "b5883762-ca0a-4932-8d2a-41a45796a5f8",
    rarity: "common",
    name: "Chain Lightning",
    oracleText:
        "Chain Lightning deals 3 damage to any target. Then that player or that permanent's controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    // NOT DSL-migratable (ADR 0045): "may copy this spell and may choose a
    // new target for that copy" (CR 707.12) — spell-copying / retargeting
    // (`copyResolvingSpell` / `requestCopyRetarget`) has no Op, and the
    // step-0 last-known-information chooser capture (`noteChoice`, New-Op
    // backlog `noteChoice`, migration-classifier.mjs) is a bare imperative
    // primitive too. Blocked on: spell-copy/retarget Ops + a `noteChoice` Op.
    resolveSteps: [
        // Step 0 — capture the chooser by last-known information (CR 608.2h),
        // THEN deal the damage (CR 119.3 "any target"). The chooser must be
        // read BEFORE the damage: 3 damage can destroy the targeted permanent
        // inline (CR 704.5g), after which `getController` would have no live
        // permanent to read. Persisted for step 1 via `noteChoice`; the damage
        // stays in step 0 so the suspend/replay of the step-1 may-pay never
        // re-applies it.
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target) return;
            // CR 119.3 — "that player or that permanent's controller".
            const chooser =
                target.type === "player"
                    ? target.id
                    : ctx.getController(target);
            ctx.noteChoice("chain-lightning-chooser", [chooser]);
            ctx.dealDamage(target, 3);
        },
        // Step 1 — offer the damaged player / permanent's controller the
        // {R}{R} may-pay; on pay, copy this spell and let them retarget.
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target) return;
            // Last-known chooser captured in step 0 (the permanent may have died
            // to the damage, so it can no longer be read off the battlefield).
            const chooser = ctx.recallChoice("chain-lightning-chooser")?.[0];
            if (!chooser) return;
            const paid = ctx.requestMayPay({
                playerId: chooser,
                choiceId: "chain-lightning-pay",
                cost: { R: 2 },
                prompt: "Pay {R}{R} to copy Chain Lightning (you may choose a new target)?",
            });
            if (paid === undefined) return; // suspended on the may-pay choice
            if (!paid) return; // declined — nothing further happens
            // CR 707.12 — the chooser copies THIS spell. The copy is controlled
            // by the chooser (the player who paid), who may choose a new target.
            const copyId = ctx.copyResolvingSpell({ controllerId: chooser });
            if (copyId) ctx.requestCopyRetarget(copyId);
        },
    ],
};

// Raging Bull — vanilla 2/2 Ox (CR 110.1).
export const ragingBull: CardDefinition = {
    id: "ec10a51c-d2c3-4d14-9a71-9e59155bf980",
    rarity: "common",
    name: "Raging Bull",
    oracleText: "",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Ox"],
    power: 2,
    toughness: 2,
};

// Mountain Yeti — mountainwalk (CR 702.19 landwalk variant) + protection from
// white (CR 702.16).
export const mountainYeti: CardDefinition = {
    id: "09242f08-3bfc-4082-b32f-703c7fed62a0",
    rarity: "uncommon",
    name: "Mountain Yeti",
    oracleText:
        "Mountainwalk (This creature can't be blocked as long as defending player controls a Mountain.)\nProtection from white",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Yeti"],
    power: 3,
    toughness: 3,
    staticAbilities: ["mountainwalk", "protection from white"],
};

// Wall of Earth — Defender (CR 702.3).
export const wallOfEarth: CardDefinition = {
    id: "c12e97c1-ca28-432a-8140-3f08bb4485a3",
    rarity: "common",
    name: "Wall of Earth",
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 6,
    staticAbilities: ["defender"],
};

// Wall of Heat — Defender (CR 702.3).
export const wallOfHeat: CardDefinition = {
    id: "a38059a8-be69-4cc1-969b-951c610f2f11",
    rarity: "common",
    name: "Wall of Heat",
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 2,
    toughness: 6,
    staticAbilities: ["defender"],
};

// --- Lord / anthem creatures (CR 611 layer 7c + keyword grant) ------------

// Kobold Taskmaster — "Other Kobold creatures you control get +1/+0."
// (CR 611 filtered anthem excluding self.)
export const koboldTaskmaster: CardDefinition = {
    id: "1b9c63eb-8d4e-4d8b-8637-308459ef036b",
    rarity: "uncommon",
    name: "Kobold Taskmaster",
    oracleText: "Other Kobold creatures you control get +1/+0.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 1,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Kobold"),
            power: 1,
            toughness: 0,
        },
    ],
};

// Kobold Drill Sergeant — "Other Kobold creatures you control get +0/+1 and
// have trample." (CR 611 filtered anthem + keyword grant, excluding self.)
export const koboldDrillSergeant: CardDefinition = {
    id: "741b14f8-625d-41be-a734-0efe042a6ee8",
    rarity: "uncommon",
    name: "Kobold Drill Sergeant",
    oracleText:
        "Other Kobold creatures you control get +0/+1 and have trample.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kobold", "Soldier"],
    power: 1,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Kobold"),
            power: 0,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Kobold"),
            keyword: "trample",
        },
    ],
};

// Kobold Overlord — first strike (CR 702.7) + "Other Kobold creatures you
// control have first strike." (CR 611 keyword grant, excluding self.)
export const koboldOverlord: CardDefinition = {
    id: "490eeedb-9c03-4dc7-81fd-ae54a7932e4d",
    rarity: "rare",
    name: "Kobold Overlord",
    oracleText:
        "First strike\nOther Kobold creatures you control have first strike.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 1,
    toughness: 2,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Kobold"),
            keyword: "first strike",
        },
    ],
};

// Beasts of Bogardan — protection from red (CR 702.16) + "gets +1/+1 as long as
// an opponent controls a nontoken white permanent." (CR 611.2c conditional
// self-anthem.)
const BEASTS_OF_BOGARDAN_ID = "f885d776-2953-4ed4-b63f-91dc2b42783b";

export const beastsOfBogardan: CardDefinition = {
    id: BEASTS_OF_BOGARDAN_ID,
    rarity: "uncommon",
    name: "Beasts of Bogardan",
    oracleText:
        "Protection from red\nThis creature gets +1/+1 as long as an opponent controls a nontoken white permanent.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 3,
    toughness: 3,
    staticAbilities: ["protection from red"],
    staticEffects: [
        {
            kind: "pt-buff",
            // "This creature" — only the source itself (CR 611.2c).
            applies: (target, source) => target.id === source.id,
            condition: (source, state, ctx) =>
                state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            !c.isToken &&
                            ctx.getColors(c).includes("W")
                    )
                ),
            power: 1,
            toughness: 1,
        },
    ],
};

// --- Activated-ability creatures (CR 605) ----------------------------------

// Spinal Villain — "{T}: Destroy target blue creature." (CR 701.8 destroy on a
// colour-restricted target, CR 202.2.)
export const spinalVillain: CardDefinition = {
    id: "d6d5e36f-0049-4be8-bf85-8dc0186339a4",
    rarity: "rare",
    name: "Spinal Villain",
    oracleText: "{T}: Destroy target blue creature.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "spinal-villain-destroy",
            oracleText: "{T}: Destroy target blue creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, colorFilter: "U" },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// Hyperion Blacksmith — "{T}: You may tap or untap target artifact an opponent
// controls." (CR 701.26 tap/untap; the optional + the tap-or-untap pick are a
// single option choice — choose tap, untap, or decline.)
export const hyperionBlacksmith: CardDefinition = {
    id: "44d499a9-fe7c-4a1a-9eb3-a7fd9f85ae08",
    rarity: "uncommon",
    name: "Hyperion Blacksmith",
    oracleText:
        "{T}: You may tap or untap target artifact an opponent controls.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "hyperion-blacksmith-tap-untap",
            oracleText:
                "{T}: You may tap or untap target artifact an opponent controls.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                controller: "opponent",
            },
            // Migrated resolve()→effects[] (ADR 0045, issue #849): the "tap or
            // untap" pick is the `optionChoice` Op — two modes over the
            // announced target artifact (CR 701.26), preserving the "tap" /
            // "untap" option ids. The printed "you may" (decline) auto-resolves
            // to the no-op direction (tap an already-tapped / untap an untapped
            // artifact is a no-op), so two modes suffice — same treatment as
            // Elder Druid.
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Tap or untap the target artifact?",
                    modes: [
                        {
                            id: "tap",
                            label: "Tap",
                            effects: [
                                {
                                    op: "tapUntap",
                                    action: "tap",
                                    target: { target: 0 },
                                },
                            ],
                        },
                        {
                            id: "untap",
                            label: "Untap",
                            effects: [
                                {
                                    op: "tapUntap",
                                    action: "untap",
                                    target: { target: 0 },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

// Wall of Opposition — Defender (CR 702.3) + "{1}: This creature gets +1/+0
// until end of turn." (CR 611.1 repeatable temporary pump.)
export const wallOfOpposition: CardDefinition = {
    id: "2b3d1430-9978-4983-a4fd-d1fa8dea2169",
    rarity: "rare",
    name: "Wall of Opposition",
    oracleText:
        "Defender (This creature can't attack.)\n{1}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 6,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-opposition-pump",
            oracleText: "{1}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1 } },
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

// --- Auras (CR 303 — Enchant creature) ------------------------------------

// Giant Strength — Enchanted creature gets +2/+2 (CR 303.4, 611).
export const giantStrength: CardDefinition = {
    id: "a86190bb-1f41-4128-b9fb-dfb1d178359d",
    rarity: "common",
    name: "Giant Strength",
    oracleText: "Enchant creature\nEnchanted creature gets +2/+2.",
    manaCost: { R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 2,
            toughness: 2,
        },
    ],
};

// Immolation — Enchanted creature gets +2/-2 (CR 303.4, 611).
export const immolation: CardDefinition = {
    id: "9b3d34fa-398c-4ea0-a392-6690bd3a615c",
    rarity: "common",
    name: "Immolation",
    oracleText: "Enchant creature\nEnchanted creature gets +2/-2.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 2,
            toughness: -2,
        },
    ],
};

// Eternal Warrior — Enchanted creature has vigilance (CR 303.4 keyword grant,
// CR 702.21).
export const eternalWarrior: CardDefinition = {
    id: "97cdc38e-1d96-4de2-98e2-713f5d4d2180",
    rarity: "uncommon",
    name: "Eternal Warrior",
    oracleText: "Enchant creature\nEnchanted creature has vigilance.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) => target.id === source.attachedTo,
            keyword: "vigilance",
        },
    ],
};

// The Brute — "Enchanted creature gets +1/+0." + "{R}{R}{R}: Regenerate
// enchanted creature." (CR 303.4 pt-buff + a host-aware regeneration ability,
// CR 701.19a.)
export const theBrute: CardDefinition = {
    id: "f9ffb265-872f-47b3-974c-92bcbebd557e",
    rarity: "common",
    name: "The Brute",
    oracleText:
        "Enchant creature\nEnchanted creature gets +1/+0.\n{R}{R}{R}: Regenerate enchanted creature.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 1,
            toughness: 0,
        },
    ],
    activatedAbilities: [
        {
            id: "the-brute-regenerate",
            oracleText: "{R}{R}{R}: Regenerate enchanted creature.",
            cost: { mana: { R: 3 } },
            useStack: true,
            // NOT DSL-migratable (ADR 0045): regenerates the Aura's enchanted
            // host, read via getAttachedToId — the object-selector grammar has
            // no attached-host ("enchanted permanent") ref (same block as
            // Fylgja #845 / Regeneration / Thrull Retainer). The `regenerate`
            // Op itself is available; only the target selector is missing.
            // Blocked on: an attached-host object selector (planned-migratable).
            resolve: (ctx: SpellContext) => {
                const host = ctx.getAttachedToId();
                if (host)
                    ctx.applyRegenerationShield({
                        type: "permanent",
                        id: host,
                    });
            },
        },
    ],
};

// --- Pump / colour-change spells (CR 611.1, end-of-turn duration) ----------

// Dwarven Song — "One or more target creatures become red until end of turn."
// (CR 305.7 layer-5 colour override, end-of-turn duration; variable count,
// CR 601.2c.)
export const dwarvenSong: CardDefinition = {
    id: "29a50f72-9524-4440-9380-9d3e0b693351",
    rarity: "uncommon",
    name: "Dwarven Song",
    oracleText: "One or more target creatures become red until end of turn.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1 } },
    // Migrated resolve()→effects[] (ADR 0045): `{ set: "targets" }` iterates
    // the WHOLE variable-count announced target set (issue #1083), each
    // member set via `setColor` with an end-of-turn duration (CR 305.7 /
    // 611.2c — the colour override expires at cleanup via
    // `tickAllDurations`/`finalizeCleanup`, mirroring the sibling colour-
    // change spells `leg/blue.ts` and `leg/black.ts`). Fixed issue #1833
    // (the duration was previously dropped, making the change permanent —
    // same shape as Sylvan Paradise, `green.ts`, issue #1834).
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [
                {
                    op: "setColor",
                    target: { ref: "$each" },
                    colors: ["R"],
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Blood Lust — "If target creature has toughness 5 or greater, it gets +4/-4
// until end of turn. Otherwise, it gets +4/-X until end of turn, where X is its
// toughness minus 1." (CR 611.1 temporary P/T; the toughness branch snapshots
// effective toughness at resolution. The -X case always leaves toughness 1 —
// +4/-(T-1) makes the new toughness T - (T-1) = 1.)
export const bloodLust: CardDefinition = {
    id: "fbbf1a9c-8b94-4ee7-92db-65b531149990",
    rarity: "uncommon",
    name: "Blood Lust",
    oracleText:
        "If target creature has toughness 5 or greater, it gets +4/-4 until end of turn. Otherwise, it gets +4/-X until end of turn, where X is its toughness minus 1.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // NOT DSL-migratable (ADR 0045, issue #840): the toughness delta is a
    // non-literal amount derived from the target's toughness (getToughness)
    // with arithmetic (-(T-1)). Blocked on: an X-value / arithmetic construct,
    // not pump.
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const toughness = ctx.getToughness(target);
        const toughnessDelta = toughness >= 5 ? -4 : -(toughness - 1);
        ctx.addTemporaryPTBuff(target, 4, toughnessDelta, {
            phase: "end-of-turn",
        });
    },
};

// Glyph of Destruction — "Target blocking Wall you control gets +10/+0 until
// end of combat. Prevent all damage that would be dealt to it this turn.
// Destroy it at the beginning of the next end step." (CR 611.1 pump until end
// of combat + CR 615 prevention shield + CR 603.7a delayed destroy.)
export const glyphOfDestruction: CardDefinition = {
    id: "8e9c153c-9224-491b-bc84-8a9f0a83ee5a",
    rarity: "common",
    name: "Glyph of Destruction",
    oracleText:
        "Target blocking Wall you control gets +10/+0 until end of combat. Prevent all damage that would be dealt to it this turn. Destroy it at the beginning of the next end step.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        controller: "you",
        subtypeFilter: "Wall",
        combatRoleFilter: "blocking",
    },
    // Migrated resolve()→effects[] (ADR 0045, #845 + #840 + #838): +10/+0 until
    // end of combat (pump, CR 611.1), a prevent-all-damage shield on the target
    // (preventDamage "next-n" with a very large amount modeling "prevent all
    // damage to it this turn", CR 615), then the delayed destroy as a
    // `delayedTrigger` Op capturing the target slot and destroying it at the
    // next end step (CR 603.7a). Replaces the old `delayedTriggers[]` template.
    effects: [
        {
            op: "pump",
            target: { target: 0 },
            power: 10,
            toughness: 0,
            duration: { phase: "end-of-combat" },
        },
        {
            op: "preventDamage",
            mode: "next-n",
            to: { target: 0 },
            amount: 9999,
            duration: { phase: "end-of-turn" },
        },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText:
                "At the beginning of the next end step, destroy the enchanted Wall.",
            capture: { $it: { target: 0 } },
            effects: [{ op: "destroy", target: { ref: "$it" } }],
        },
    ],
};

// --- Removal / modal spells (CR 700.2, 701.7) ------------------------------

// Active Volcano — modal: "Destroy target blue permanent." OR "Return target
// Island to its owner's hand." (CR 700.2 modal spell.)
export const activeVolcano: CardDefinition = {
    id: "ad402e65-6fac-4005-a2d4-592983df0c30",
    rarity: "common",
    name: "Active Volcano",
    oracleText:
        "Choose one —\n• Destroy target blue permanent.\n• Return target Island to its owner's hand.",
    manaCost: { R: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] (ADR 0045): both modes are single-Op
    // scripts on the announced target slot (`SpellMode.effects`, issue
    // #1280) — `destroy` / `moveZone` to hand.
    modes: [
        {
            id: "destroy-blue",
            label: "Destroy target blue permanent",
            oracleText: "Destroy target blue permanent.",
            targetRequirement: { type: "any", count: 1, colorFilter: "U" },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "return-island",
            label: "Return target Island to its owner's hand",
            oracleText: "Return target Island to its owner's hand.",
            targetRequirement: {
                type: "Land",
                count: 1,
                subtypeFilter: "Island",
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// --- Hand / library disruption (CR 121, 701.20) ----------------------------

// Winds of Change — "Each player shuffles the cards from their hand into their
// library, then draws that many cards." (Composed: count each hand, move
// hand → library, shuffle, redraw that many. CR 701.24 / 121.1.)
export const windsOfChange: CardDefinition = {
    id: "186fd917-8d65-4de5-8546-a32a5f6d3bab",
    rarity: "uncommon",
    name: "Winds of Change",
    oracleText:
        "Each player shuffles the cards from their hand into their library, then draws that many cards.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    // NOT DSL-migratable (ADR 0045): the whole-hand-zone move gap #1279
    // tracked is now CLOSED (`moveZone`'s bulk whole-zone shape, no
    // target/cards) — Timetwister / Echo of Eons / Wheel of Fortune / Anje's
    // Ravager all migrated on it. Winds of Change stays resolve() on a
    // DIFFERENT, narrower gap that shape doesn't close: "then draws THAT MANY
    // cards" needs each player's hand size captured BEFORE the shuffle (the
    // whole-zone move carries no count-of-cards-moved bind, and the `count`
    // construct doesn't support `zone: "hand"`). Blocked on: a dynamic
    // count-of-cards-moved / hand-size-count capability. tracked-by: #1388
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            const handSize = ctx.getHandSize(pid);
            ctx.moveZone(pid, "hand", "library");
            ctx.shuffleLibrary(pid);
            ctx.drawCards(pid, handSize);
        }
    },
};

// Aerathi Berserker — {2}{R}{R}{R} 2/4, Rampage 3.
export const aerathiBerserker: CardDefinition = {
    id: "06673800-22a7-4ee3-92fa-7c7cd4865d30",
    rarity: "uncommon",
    name: "Aerathi Berserker",
    oracleText:
        "Rampage 3 (Whenever this creature becomes blocked, it gets +3/+3 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 2, R: 3 },
    types: ["Creature"],
    subtypes: ["Human", "Berserker"],
    power: 2,
    toughness: 4,
    staticAbilities: ["rampage 3"],
    triggeredAbilities: [rampageTrigger(3)],
};

// Frost Giant — {3}{R}{R}{R} 4/4, Rampage 2.
export const frostGiant: CardDefinition = {
    id: "6955d54f-7b37-4e43-8183-51677fb1ee11",
    rarity: "uncommon",
    name: "Frost Giant",
    oracleText:
        "Rampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, R: 3 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 4,
    toughness: 4,
    staticAbilities: ["rampage 2"],
    triggeredAbilities: [rampageTrigger(2)],
};

// Primordial Ooze — {R} 1/1 Ooze that must attack. Each upkeep it grows a +1/+1
// counter; then its controller may pay {X} (X = its +1/+1 counter count) or it
// taps and deals X damage to its controller. CR 122 +1/+1 counters, CR 508.1d
// must-attack, CR 603.6a upkeep, CR 117.3a optional pay-or-else with a power-
// scaled {X} cost (X read from the live counter count).
export const primordialOoze: CardDefinition = {
    id: "a46e47e1-8639-48f7-94c4-5f9e9666839a",
    rarity: "uncommon",
    name: "Primordial Ooze",
    oracleText:
        "This creature attacks each combat if able.\nAt the beginning of your upkeep, put a +1/+1 counter on this creature. Then you may pay {X}, where X is the number of +1/+1 counters on it. If you don't, tap this creature and it deals X damage to you.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Ooze"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            // CR 508.1d — attacks each combat if able.
            kind: "attack-requirement",
            id: "primordial-ooze-attacks-if-able",
            oracleText: "This creature attacks each combat if able.",
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "primordial-ooze-upkeep",
            oracleText:
                "At the beginning of your upkeep, put a +1/+1 counter on this creature. Then you may pay {X}, where X is the number of +1/+1 counters on it. If you don't, tap this creature and it deals X damage to you.",
            phase: "UPKEEP",
            scope: "your",
            // CR 608.2 — two steps so the counter add (step 0, irreversible)
            // is NOT re-applied when the `requestMayPay` in step 1 suspends and
            // resumes. A single `resolve` would grow the Ooze twice on resume.
            // NOT DSL-migratable (ADR 0045): the `counters` add is expressible,
            // but the follow-on `mayPay` cost is {X} where X is the +1/+1
            // counter tally (`getCounterCount`) and the punisher damage equals
            // that same tally — neither a dynamic counter-count mayPay cost nor
            // a counter-count value is expressible today. Stays resolve().
            resolveSteps: [
                (ctx) => {
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "+1/+1",
                        1
                    );
                },
                (ctx, scopedPlayerId) => {
                    const self: TargetSelection = {
                        type: "permanent",
                        id: ctx.sourceInstanceId,
                    };
                    const x = ctx.getCounterCount(self, "+1/+1");
                    const paid = ctx.requestMayPay({
                        playerId: scopedPlayerId,
                        choiceId: `primordial-ooze-${ctx.sourceInstanceId}`,
                        cost: { X: x },
                        prompt: `Pay {${x}} or Primordial Ooze taps and deals ${x} damage to you?`,
                    });
                    if (paid === undefined) return; // suspended
                    if (paid) return;
                    // CR 117.3a — didn't pay: tap it and it pings its controller.
                    ctx.tap(self);
                    ctx.dealDamage({ type: "player", id: scopedPlayerId }, x);
                },
            ],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C9 — Global combat caps + conditional attack restriction (#386)
//
// Two World enchantments (CR 205.4 World supertype; the world-rule SBA shipped
// in C2, #379) that reshape combat declarations GLOBALLY rather than per-card.
// Their rules can't ride a per-attacker `staticEffects[]` predicate (ADR 0006)
// because such a predicate sees only one creature at a time, while a count cap
// and a defender-history restriction are judged with full combat context:
//
//   • Caverns of Despair (CR 508.1a / 509.1a) — caps DECLARED attackers and
//     blockers at two each per combat. Expressed as DATA: two
//     `combat-declaration-cap` static effects, one per side (#1127). Every
//     consumer reads them through the one battlefield scanner
//     `combatDeclarationCap` (`cards/attackRestrictions.ts`) — the
//     declareAttacker / assignBlocker mutations, the confirm-time whole-set
//     checks in `gre/combat.ts`, the bot's move enumeration (`moves.ts`) and
//     the client's board affordance. Until Dueling Grounds arrived as the
//     second card of this shape the cap was an engine constant keyed off this
//     card's id (`CAVERNS_OF_DESPAIR_ID`); the second card is what earned it a
//     generic, card-agnostic shape.
//   • Arboria (CR 508.1c) — a defender-history attack restriction. A player can
//     be attacked only if they cast a spell or put a NONTOKEN permanent onto
//     the battlefield during their last turn. The per-player history rides two
//     PlayerState flags (`qualifyingActionThisTurn` set by emitSpellCastEvent /
//     emitPermanentEntered, frozen into `qualifyingActionLastTurn` at
//     advanceTurn) and is read in `validateAttackerEligibility`. Still keyed by
//     id (`ARBORIA_ID` in `convex/gre/combat.ts`) — it remains the only card of
//     its shape.
//
// ZERO new SpellContext primitive in either case.
// ─────────────────────────────────────────────────────────────────────────────

// Caverns of Despair — {2}{R}{R} World Enchantment. "No more than two creatures
// can attack each combat. No more than two creatures can block each combat."
// (CR 508.1a / 509.1a — global declaration caps, one `combat-declaration-cap`
// static effect per side.)
export const cavernsOfDespair: CardDefinition = {
    id: "209f7479-b3a0-4c27-9602-78babb8d2e99",
    rarity: "rare",
    name: "Caverns of Despair",
    oracleText:
        "No more than two creatures can attack each combat.\nNo more than two creatures can block each combat.",
    manaCost: { X: 2, R: 2 },
    types: ["Enchantment"],
    supertypes: ["World"],
    staticEffects: [
        {
            kind: "combat-declaration-cap",
            id: "caverns-of-despair-attack-cap",
            side: "attack",
            max: 2,
            oracleText: "No more than two creatures can attack each combat.",
        },
        {
            kind: "combat-declaration-cap",
            id: "caverns-of-despair-block-cap",
            side: "block",
            max: 2,
            oracleText: "No more than two creatures can block each combat.",
        },
    ],
};
