// Invasion (INV) — white cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
//
// Free tranche (issue #1069, parent PRD #1063): 25 of the 41 candidate free
// White cards ship as active `CardDefinition`s below, all 25 as DSL Effect
// Scripts (ADR 0045). (Restrain migrated resolve()->effects[] via the
// `markAssignsNoCombatDamage` Op, CR 510.1c. Liberate migrated resolve()
// ->effects[] via the exile(bind)+delayedTrigger "blink" idiom, issue
// #1401/#1403.) Holy Day is NOT a new card here —
// it was first printed in Legends and already ships from `leg/white.ts`; no
// duplicate `CardDefinition`/lockfile row for the same oracleId. The
// remaining 16 candidates need engine capabilities that do not exist yet
// (confirmed by direct code audit, not "didn't look hard enough") and are
// left as commented-out stubs at the bottom of this file, each tagged
// `// tracked-by: #1086`. Domain-cluster and
// pile-division-cluster cards are tracked to their own cluster issues
// (#1066, #1067); the 2 split cards (Stand // Deliver, Wax // Wane) are
// out-of-scope (ADR 0010/0041, unmodelled `split` layout) and carry no stub.

import type { CardDefinition, Color } from "../../types";
import {
    AURA_AFFECTS_HOST,
    countDomain,
    EFFECT_AFFECTS_SELF,
} from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// ─────────────────────────────────────────────────────────────────────────
// Cost-modifier static effect (CR 601.2f, layer-agnostic — scanned at cast
// announcement)
// ─────────────────────────────────────────────────────────────────────────

// Alabaster Leech — "White spells you cast cost {W} more to cast." Precedent:
// Gloom (lea/black.ts) is the SAME `cost-modifier` static effect shape for a
// SYMMETRIC ("White spells cost {3} more", any caster) tax; here the
// `appliesToSpell` predicate additionally scopes to "YOU cast" by comparing
// the cast card's `controllerId` (the caster, while the card is still in
// hand) against this permanent's own `controllerId` (the 3rd `effectSource`
// argument `getCostModifiers` passes to every predicate).
export const alabasterLeech: CardDefinition = {
    id: "c86b45d9-aba6-4c09-8605-037754ba7fd4",
    rarity: "rare",
    name: "Alabaster Leech",
    oracleText: "White spells you cast cost {W} more to cast.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Leech"],
    power: 1,
    toughness: 3,
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                ctx.getColors(card).includes("W") &&
                card.controllerId === effectSource?.controllerId,
            costIncrease: { W: 1 },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// ETB triggers (CR 603.6a) — Effect Script
// ─────────────────────────────────────────────────────────────────────────

// Angel of Mercy — "Flying. When this creature enters, you gain 3 life."
export const angelOfMercy: CardDefinition = {
    id: "5b6de688-685f-4389-be35-a472ada988e1",
    rarity: "uncommon",
    name: "Angel of Mercy",
    oracleText: "Flying\nWhen this creature enters, you gain 3 life.",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "angel-of-mercy-etb",
            oracleText: "When this creature enters, you gain 3 life.",
            scope: "self",
            effects: [{ op: "gainLife", player: "controller", amount: 3 }],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Kicker (CR 702.33) — entersWith.counters
// ─────────────────────────────────────────────────────────────────────────

// Ardent Soldier — "Kicker {2}. Vigilance. If this creature was kicked, it
// enters with a +1/+1 counter on it." `entersWith.counters` with
// `count: "kicker"` reads the Kicker tally (0/1 for a single, non-Multi
// kicker) directly at ETB — no triggered ability needed (Everflowing
// Chalice precedent, `EffectKickerCountValue` doc, types.ts).
export const ardentSoldier: CardDefinition = {
    id: "39dce974-846f-4365-b0a5-851e38668e7d",
    rarity: "common",
    name: "Ardent Soldier",
    oracleText:
        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nVigilance\nIf this creature was kicked, it enters with a +1/+1 counter on it.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
    staticAbilities: ["vigilance"],
    kicker: { cost: { X: 2 } },
    entersWith: { counters: [{ type: "+1/+1", count: "kicker" }] },
};

// ─────────────────────────────────────────────────────────────────────────
// Activated abilities (CR 605)
// ─────────────────────────────────────────────────────────────────────────

// Benalish Heralds — "{3}{U}, {T}: Draw a card."
export const benalishHeralds: CardDefinition = {
    id: "13c6e51d-54eb-4e5b-9ec9-54521b16b8d1",
    rarity: "uncommon",
    name: "Benalish Heralds",
    oracleText: "{3}{U}, {T}: Draw a card.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 4,
    activatedAbilities: [
        {
            id: "benalish-heralds-draw",
            oracleText: "{3}{U}, {T}: Draw a card.",
            cost: { mana: { X: 3, U: 1 }, tap: true },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Benalish Trapper — "{W}, {T}: Tap target creature."
export const benalishTrapper: CardDefinition = {
    id: "e312653d-c3e1-4c79-90d2-0963419b618c",
    rarity: "common",
    name: "Benalish Trapper",
    oracleText: "{W}, {T}: Tap target creature.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "benalish-trapper-tap",
            oracleText: "{W}, {T}: Tap target creature.",
            cost: { mana: { W: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
        },
    ],
};

// Capashen Unicorn — "{1}{W}, {T}, Sacrifice this creature: Destroy target
// artifact or enchantment." `type: ["Artifact", "Enchantment"]` is the
// standard "destroy artifact or enchantment" target shape (precedent:
// lea/white.ts, bro/colorless.ts, dmu/green.ts, and Dismantling Blow below).
export const capashenUnicorn: CardDefinition = {
    id: "ec3e5741-88d7-4837-9b43-ba8304d9ee74",
    rarity: "common",
    name: "Capashen Unicorn",
    oracleText:
        "{1}{W}, {T}, Sacrifice this creature: Destroy target artifact or enchantment.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Unicorn"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "capashen-unicorn-destroy",
            oracleText:
                "{1}{W}, {T}, Sacrifice this creature: Destroy target artifact or enchantment.",
            cost: { mana: { X: 1, W: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Protection cycle (CR 702.16) — static keyword + temporary grantAbility
// ─────────────────────────────────────────────────────────────────────────

// Crimson Acolyte — "Protection from red. {W}: Target creature gains
// protection from red until end of turn."
export const crimsonAcolyte: CardDefinition = {
    id: "c1718028-3009-4bdd-9f6f-59c17edd1344",
    rarity: "common",
    name: "Crimson Acolyte",
    oracleText:
        "Protection from red\n{W}: Target creature gains protection from red until end of turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    staticAbilities: ["protection from red"],
    activatedAbilities: [
        {
            id: "crimson-acolyte-grant",
            oracleText:
                "{W}: Target creature gains protection from red until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "grantAbility",
                    ability: "protection from red",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Obsidian Acolyte — same shape as Crimson Acolyte, black instead of red.
export const obsidianAcolyte: CardDefinition = {
    id: "868efcee-bb13-4b6f-b81b-99408685e4c4",
    rarity: "common",
    name: "Obsidian Acolyte",
    oracleText:
        "Protection from black\n{W}: Target creature gains protection from black until end of turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    staticAbilities: ["protection from black"],
    activatedAbilities: [
        {
            id: "obsidian-acolyte-grant",
            oracleText:
                "{W}: Target creature gains protection from black until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "grantAbility",
                    ability: "protection from black",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Characteristic-defining P/T (CR 604.3, layer 7a) — board-wide scans
// ─────────────────────────────────────────────────────────────────────────

// Crusading Knight — "Protection from black. This creature gets +1/+1 for
// each Swamp your opponents control." Precedent: Angry Mob's "2 plus Swamps
// your opponents control" CDA (drk/white.ts) — same
// `state.players.flatMap(battlefield).filter(controllerId !== self, Swamp)`
// scan. `getEffectivePower`/`getEffectiveToughness` ADD the CDA `compute`
// result on top of the printed base (power/toughness: 2), so the compute
// returns only the Swamp-count DELTA (not the full 2+swamps total, unlike
// Angry Mob's 0/0-base convention — both are equivalent, this one keeps the
// printed 2/2 stats visible on the definition).
export const crusadingKnight: CardDefinition = {
    id: "a4ab4640-1871-41dd-bd21-64741e21ba37",
    rarity: "rare",
    name: "Crusading Knight",
    oracleText:
        "Protection from black\nThis creature gets +1/+1 for each Swamp your opponents control.",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["protection from black"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                const swamps = state.players
                    .flatMap((pl) => pl.battlefield)
                    .filter(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            c.subtypes.includes("Swamp")
                    ).length;
                return {
                    power: swamps,
                    toughness: swamps,
                };
            },
        },
    ],
};

// Ruham Djinn — "First strike. This creature gets -2/-2 as long as white is
// the most common color among all permanents or is tied for most common."
// A board-wide colour tally (via `ctx.getColors`) gates a `pt-buff` — same
// `StaticEffectContext`/board-scan capability as Crusading Knight/Angry Mob,
// just tallying colours instead of a subtype.
export const ruhamDjinn: CardDefinition = {
    id: "a46c7718-1ecc-418c-b213-13be9de5cb7f",
    rarity: "uncommon",
    name: "Ruham Djinn",
    oracleText:
        "First strike\nThis creature gets -2/-2 as long as white is the most common color among all permanents or is tied for most common.",
    manaCost: { X: 5, W: 1 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 5,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.id,
            condition: (_source, state, ctx) => {
                const tally: Record<string, number> = {
                    W: 0,
                    U: 0,
                    B: 0,
                    R: 0,
                    G: 0,
                };
                for (const permanent of state.players.flatMap(
                    (pl) => pl.battlefield
                )) {
                    for (const color of ctx.getColors(permanent)) {
                        tally[color] = (tally[color] ?? 0) + 1;
                    }
                }
                const whiteCount = tally.W;
                return (["U", "B", "R", "G"] as const).every(
                    (c) => whiteCount >= tally[c]
                );
            },
            power: -2,
            toughness: -2,
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Kicker + Effect Script (spell-level kickerCount read, CR 702.33e)
// ─────────────────────────────────────────────────────────────────────────

// Dismantling Blow — "Kicker {2}{U}. Destroy target artifact or enchantment.
// If this spell was kicked, draw two cards."
export const dismantlingBlow: CardDefinition = {
    id: "39514d54-cb6c-4b3b-a3be-46db991be4d4",
    rarity: "common",
    name: "Dismantling Blow",
    oracleText:
        "Kicker {2}{U} (You may pay an additional {2}{U} as you cast this spell.)\nDestroy target artifact or enchantment. If this spell was kicked, draw two cards.",
    manaCost: { X: 2, W: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 2, U: 1 } },
    targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
    effects: [
        { op: "destroy", target: { target: 0 } },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [{ op: "draw", player: "controller", count: 2 }],
        },
    ],
};

// Orim's Touch — "Kicker {1}. Prevent the next 2 damage that would be dealt
// to any target this turn. If this spell was kicked, prevent the next 4
// damage instead."
export const orimsTouch: CardDefinition = {
    id: "559f551e-7891-4c6d-8798-a25c0255fa3b",
    rarity: "common",
    name: "Orim's Touch",
    oracleText:
        "Kicker {1} (You may pay an additional {1} as you cast this spell.)\nPrevent the next 2 damage that would be dealt to any target this turn. If this spell was kicked, prevent the next 4 damage that would be dealt to that permanent or player this turn instead.",
    manaCost: { W: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 1 } },
    targetRequirement: { type: "any", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 4,
                    duration: { phase: "end-of-turn" },
                },
            ],
            else: [
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

// ─────────────────────────────────────────────────────────────────────────
// Replacement effects (CR 614, ADR 0020) — damage clamp / redirect
// ─────────────────────────────────────────────────────────────────────────

// Divine Presence — "If a source would deal 4 or more damage to a permanent
// or player, that source deals 3 damage to that permanent or player
// instead." A flat clamp: no color/board scan needed (unlike Spirit of
// Resistance, deferred — see the stub section), just the event's own
// `amount` field.
export const divinePresence: CardDefinition = {
    id: "28cb898d-d6ce-410a-83bf-37962cca2735",
    rarity: "rare",
    name: "Divine Presence",
    oracleText:
        "If a source would deal 4 or more damage to a permanent or player, that source deals 3 damage to that permanent or player instead.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    replacementEffects: [
        {
            id: "divine-presence-clamp",
            oracleText:
                "If a source would deal 4 or more damage to a permanent or player, that source deals 3 damage to that permanent or player instead.",
            eventKind: "damage",
            appliesTo: (event) => event.kind === "damage" && event.amount >= 4,
            replace: (event) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return { kind: "modified", event: { ...event, amount: 3 } };
            },
        },
    ],
};

const HARSH_JUDGMENT_COLORS = ["W", "U", "B", "R", "G"] as const;
const HARSH_JUDGMENT_COLOR_NAMES: Record<
    (typeof HARSH_JUDGMENT_COLORS)[number],
    string
> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
};

// Harsh Judgment — "As this enchantment enters, choose a color. If an
// instant or sorcery spell of the chosen color would deal damage to you, it
// deals that damage to its controller instead." ETB colour choice via
// `modes` (precedent: Prismatic Ward, ice/white.ts — `chosenModeId` read by
// the replacement, no per-mode resolve needed) + a redirect replacement
// (precedent: Personal Incarnation's `kind: "modified"` target rewrite,
// lea/white.ts).
export const harshJudgment: CardDefinition = {
    id: "34c78dee-ab45-4638-b89a-10686145b19a",
    rarity: "rare",
    name: "Harsh Judgment",
    oracleText:
        "As this enchantment enters, choose a color.\nIf an instant or sorcery spell of the chosen color would deal damage to you, it deals that damage to its controller instead.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    modes: HARSH_JUDGMENT_COLORS.map((color) => ({
        id: color,
        label: HARSH_JUDGMENT_COLOR_NAMES[color],
        oracleText: `If an ${HARSH_JUDGMENT_COLOR_NAMES[color]} instant or sorcery spell would deal damage to you, it deals that damage to its controller instead.`,
    })),
    replacementEffects: [
        {
            id: "harsh-judgment-redirect",
            oracleText:
                "If an instant or sorcery spell of the chosen color would deal damage to you, it deals that damage to its controller instead.",
            eventKind: "damage",
            appliesTo: (event, self) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "player") return false;
                if (event.target.id !== self.controllerId) return false;
                const color = self.chosenModeId;
                if (color === undefined) return false;
                if (
                    !event.sourceTypes.includes("Instant") &&
                    !event.sourceTypes.includes("Sorcery")
                ) {
                    return false;
                }
                return event.sourceColors.includes(color as Color);
            },
            replace: (event) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return {
                    kind: "modified",
                    event: {
                        ...event,
                        target: {
                            type: "player",
                            id: event.sourceControllerId,
                        },
                    },
                };
            },
        },
    ],
};

const LIBERATE_ID = "96794470-31ea-478f-b11c-dc8342a508e2";

// Liberate — "Exile target creature you control. Return that card to the
// battlefield under its owner's control at the beginning of the next end
// step." Migrated to the DSL "blink" idiom (issue #1401 / #1403): `exile`
// the announced target with a `bind`, then a `delayedTrigger` captures that
// bound ref (`resolveCaptureSource` reads the snapshot's instance id — a
// serializable payload value, ADR 0048) and the delayed body's `moveZone`
// resolves it back via `resolveObjectRef`'s exile-zone fallback, returning
// the card under its OWNER's control by default (no explicit `controller` —
// matches "under its owner's control"). `from: "exile"` pins the #1469
// RETURN-A-DEPARTED-OBJECT recovery path explicitly (Mechanics Registry
// `moveZone` note).
export const liberate: CardDefinition = {
    id: LIBERATE_ID,
    rarity: "uncommon",
    name: "Liberate",
    oracleText:
        "Exile target creature you control. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    effects: [
        { op: "exile", target: { target: 0 }, bind: "$c" },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText:
                "Return that card to the battlefield under its owner's control at the beginning of the next end step.",
            capture: { $c: { ref: "$c" } },
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$c" },
                    from: "exile",
                    to: "battlefield",
                },
            ],
        },
    ],
};

// Razorfoot Griffin — vanilla flying + first strike.
export const razorfootGriffin: CardDefinition = {
    id: "819e2046-9b78-4fd0-92f8-798bfac51195",
    rarity: "common",
    name: "Razorfoot Griffin",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)\nFirst strike (This creature deals combat damage before creatures without first strike.)",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Griffin"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "first strike"],
};

// Restrain — "Prevent all combat damage that would be dealt by target
// attacking creature this turn. Draw a card." (CR 510.1c) — source-side
// "assigns no combat damage" mark + a cantrip, via the `markAssignsNoCombatDamage`
// Op (ADR 0045).
export const restrain: CardDefinition = {
    id: "f6b5c765-619c-4db9-b509-91892fb65e8f",
    rarity: "common",
    name: "Restrain",
    oracleText:
        "Prevent all combat damage that would be dealt by target attacking creature this turn.\nDraw a card.",
    manaCost: { X: 2, W: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        combatRoleFilter: "attacking",
    },
    // CR 510.1c — source-side "assigns no combat damage this turn" mark, then a
    // cantrip draw (ADR 0045).
    effects: [
        { op: "markAssignsNoCombatDamage", target: { target: 0 } },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Reviving Dose — "You gain 3 life. Draw a card."
export const revivingDose: CardDefinition = {
    id: "8d44dd88-ad20-4d89-8831-d2dfa6873428",
    rarity: "common",
    name: "Reviving Dose",
    oracleText: "You gain 3 life.\nDraw a card.",
    manaCost: { X: 2, W: 1 },
    types: ["Instant"],
    effects: [
        { op: "gainLife", player: "controller", amount: 3 },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Spell-cast triggers (CR 603.2 + 601.2i)
// ─────────────────────────────────────────────────────────────────────────

// Rewards of Diversity — "Whenever an opponent casts a multicolored spell,
// you gain 4 life." Multicolored isn't a `SpellFilter` field, so the check
// runs in the factory's `condition` closure (a plain predicate over the
// event's own `spellColors`, no board scan — same category as every other
// `spellCastTrigger.condition` usage elsewhere in the catalogue).
export const rewardsOfDiversity: CardDefinition = {
    id: "04116b38-8fb1-47c6-b68d-060d0fc4a60d",
    rarity: "uncommon",
    name: "Rewards of Diversity",
    oracleText:
        "Whenever an opponent casts a multicolored spell, you gain 4 life.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "rewards-of-diversity-lifegain",
            oracleText:
                "Whenever an opponent casts a multicolored spell, you gain 4 life.",
            scope: "opponents",
            condition: (event) => event.spellColors.length >= 2,
            effects: [{ op: "gainLife", player: "controller", amount: 4 }],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Phase (upkeep) trigger (CR 603.6a) — optional graveyard reanimation
// ─────────────────────────────────────────────────────────────────────────

// Reya Dawnbringer — "Flying. At the beginning of your upkeep, you may
// return target creature card from your graveyard to the battlefield."
//
// TARGETING (CR 603.3d, issue #1193): "target creature card from your
// graveyard" is a REAL target chosen when the upkeep trigger is put on the
// stack — declared as a `targetRequirement` on the TriggeredAbility
// (`raiseTriggerTargetSelection`, gre/rules.ts), NOT a resolution-time
// `choice`. `count: {min:0,max:1}` encodes the "you may" (up-to-one, decline
// = empty target set); `zone: "graveyard"` + `controller: "you"` scopes the
// candidates to the controller's own graveyard creature cards (Soul Exchange
// idiom, fem/black.ts). The Effect Script then reads the announced slot
// (`{ target: 0 }`) and reanimates via `moveZone` — the target-shape's
// `graveyard-card` → `battlefield` branch (issue #680), no `from` needed
// (inferred from the target kind).
export const reyaDawnbringer: CardDefinition = {
    id: "e1e0e72b-e65e-4578-b610-9f529daa32d7",
    rarity: "rare",
    name: "Reya Dawnbringer",
    oracleText:
        "Flying\nAt the beginning of your upkeep, you may return target creature card from your graveyard to the battlefield.",
    manaCost: { X: 6, W: 3 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Angel"],
    power: 4,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        phaseTrigger({
            id: "reya-dawnbringer-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may return target creature card from your graveyard to the battlefield.",
            phase: "UPKEEP",
            scope: "your",
            // CR 603.3d — "you may return TARGET creature card from your
            // graveyard": a real announced target chosen at stack placement.
            // `count: {min:0,max:1}` = the "you may" up-to-one (empty set =
            // decline); `zone: "graveyard"` + `controller: "you"` scopes to the
            // controller's own graveyard.
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 1 },
                zone: "graveyard",
                controller: "you",
            },
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "battlefield",
                },
            ],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Aura (CR 303) — does-not-untap keyword grant + return-to-hand ability
// ─────────────────────────────────────────────────────────────────────────

// Shackles — "Enchant creature. Enchanted creature doesn't untap during its
// controller's untap step. {W}: Return this Aura to its owner's hand."
export const shackles: CardDefinition = {
    id: "35b3da05-9a3e-4827-96b8-5de244128db3",
    rarity: "common",
    name: "Shackles",
    oracleText:
        "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step.\n{W}: Return this Aura to its owner's hand.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "does-not-untap",
        },
    ],
    activatedAbilities: [
        {
            id: "shackles-return",
            oracleText: "{W}: Return this Aura to its owner's hand.",
            cost: { mana: { W: 1 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Targeted pump with a color-filtered target
// ─────────────────────────────────────────────────────────────────────────

// Spirit Weaver — "{2}: Target green or blue creature gets +0/+1 until end
// of turn." `colorFilterAny` is the standard multi-color "OR" target filter
// (precedent: Circle of Protection's `makeCircleOfProtection` factory,
// Greater Realm of Preservation).
export const spiritWeaver: CardDefinition = {
    id: "90b0ef47-cb22-4146-a17e-e49a6031a7e6",
    rarity: "uncommon",
    name: "Spirit Weaver",
    oracleText:
        "{2}: Target green or blue creature gets +0/+1 until end of turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "spirit-weaver-pump",
            oracleText:
                "{2}: Target green or blue creature gets +0/+1 until end of turn.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                colorFilterAny: ["G", "U"],
            },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 0,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Sunscape Master — "{G}{G}, {T}: Creatures you control get +2/+2 until end
// of turn. {U}{U}, {T}: Return target creature to its owner's hand."
export const sunscapeMaster: CardDefinition = {
    id: "ebb7203d-529d-45d2-8e03-cd342c153f38",
    rarity: "rare",
    name: "Sunscape Master",
    oracleText:
        "{G}{G}, {T}: Creatures you control get +2/+2 until end of turn.\n{U}{U}, {T}: Return target creature to its owner's hand.",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "sunscape-master-pump-team",
            oracleText:
                "{G}{G}, {T}: Creatures you control get +2/+2 until end of turn.",
            cost: { mana: { G: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 2,
                            toughness: 2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
        {
            id: "sunscape-master-bounce",
            oracleText:
                "{U}{U}, {T}: Return target creature to its owner's hand.",
            cost: { mana: { U: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Sacrifice-a-permanent-matching-filter cost (CR 602.1, 118.5) + enchantment
// spell counter target
// ─────────────────────────────────────────────────────────────────────────

// Teferi's Care — "{W}, Sacrifice an enchantment: Destroy target
// enchantment. {3}{U}{U}: Counter target enchantment spell."
// `sacrificeFilter` is "sacrifice a permanent matching filter" as an
// activation cost (distinct from self-sacrifice) — the same primitive
// `Balance`'s equalize helper uses for lands/creatures, here exposed on the
// activated-ability cost shape directly (no new capability). The counter
// ability targets an enchantment SPELL via `spellTypeFilter` (precedent:
// `makeCircleOfProtection`'s artifact-source shape,
// `{ type: ["Artifact", "spell"], spellTypeFilter: "Artifact" }`).
export const teferisCare: CardDefinition = {
    id: "031b1cc1-4468-4bc5-85c0-c22dce131225",
    rarity: "uncommon",
    name: "Teferi's Care",
    oracleText:
        "{W}, Sacrifice an enchantment: Destroy target enchantment.\n{3}{U}{U}: Counter target enchantment spell.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "teferis-care-destroy",
            oracleText:
                "{W}, Sacrifice an enchantment: Destroy target enchantment.",
            cost: {
                mana: { W: 1 },
                sacrificeFilter: { types: "Enchantment" },
            },
            useStack: true,
            targetRequirement: { type: "Enchantment", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "teferis-care-counter",
            oracleText: "{3}{U}{U}: Counter target enchantment spell.",
            cost: { mana: { X: 3, U: 2 } },
            useStack: true,
            targetRequirement: {
                type: ["Enchantment", "spell"],
                count: 1,
                spellTypeFilter: "Enchantment",
            },
            effects: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Deferred stubs (issue #1069) — genuinely missing engine capability, NOT
// an invented Op/keyword (CLAUDE.md / .claude/rules/gre-development.md
// "stop-and-issue on an uncensused mechanic"). Tracked collectively at
// https://github.com/fil-donadoni/tolaria/issues/1086. Each comment below
// names the specific missing primitive so a follow-up slice can pick it up
// without re-auditing.
// ─────────────────────────────────────────────────────────────────────────

// Atalya, Samite Master — {3}{W}{W} Legendary Creature, 2/3. "{X}, {T}:
// Choose one — Prevent the next X damage that would be dealt to target
// creature this turn. Spend only white mana on X. / You gain X life. Spend
// only white mana on X." tracked-by: #1086 (no "spend only [color] mana on
// X" cost restriction exists on ManaCost / activation-cost validation).

// Benalish Emissary — {2}{W} Creature, 1/4. "Kicker {1}{G}. When this
// creature enters, if it was kicked, destroy target land." tracked-by:
// #1086 (a triggered ability fired after a kicked creature resolves cannot
// read the originating spell's kicker count — `kickerCount` lives only on
// the resolving StackItem, never persisted onto CardInstanceState /
// PERMANENT_ENTERED for a later trigger to read).

// Benalish Lancer — {2}{W} Creature, 2/2. "Kicker {2}{W}. If this creature
// was kicked, it enters with two +1/+1 counters on it and with first
// strike." tracked-by: #1086 (the counters half composes via two
// `entersWith.counters` entries each `count: "kicker"`, but the conditional
// PERMANENT first-strike grant has no declarative path — `grantAbility` is
// temporary-duration only, `entersWith` is counters-only).

// Prison Barricade — {1}{W} Creature — Wall, 1/3, Defender. "Kicker {1}{W}.
// If this creature was kicked, it enters with a +1/+1 counter on it and
// with 'This creature can attack as though it didn't have defender.'"
// tracked-by: #1086 (same gap as Benalish Lancer: no declarative path for a
// kicker-conditional PERMANENT ability grant).

// Blinding Light — {2}{W} Sorcery. "Tap all nonwhite creatures." tracked-by:
// #1086 (`EffectCardFilter`, the `forEach` selector's filter shape, has no
// color-EXCLUSION field — only `color?: Color | Color[]`, an OR-match with
// no NOT).

// Global Ruin — {4}{W} Sorcery. "Each player chooses from the lands they
// control a land of each basic land type, then sacrifices the rest."
// tracked-by: #1086 (the underlying "keep N, sacrifice the complement"
// primitive exists — `ctx.requestChoice({kind: "keep-permanents"})`, used by
// Balance's `resolve()` — but it isn't exposed to the DSL `EffectChoiceKind`
// union, and Global Ruin's PER-BASIC-TYPE selection needs new per-card
// resolve() logic beyond a straight reuse of Balance's helper).

// Glimmering Angel — {3}{W} Creature — Angel, 2/2. "Flying. {U}: This
// creature gains shroud until end of turn." tracked-by: #1086 (`shroud` is
// `status: "planned"` in the Mechanics Registry, `mechanicsRegistry.ts`:
// ships-decorative-only note — `grantAbility` would append the literal
// string "shroud" to `staticAbilities`, but unlike `hexproof` (bridged to the
// `cantBeTargeted` permanent-guard gate, issue #958) no engine check anywhere
// reads a dynamically-granted "shroud" string — granting it would be inert,
// the exact "shipped but dead" anti-pattern this registry census exists to
// catch. Needs the same hexproof-style `permanentGuard.ts` bridge before this
// card can ship for real.

// Pledge of Loyalty — {1}{W} Enchantment — Aura. "Enchant creature.
// Enchanted creature has protection from the colors of permanents you
// control. This effect doesn't remove this Aura." tracked-by: #1086
// (`StaticKeywordGrant.keyword` is a fixed string applied once at attach
// time, not a continuously-recomputed layer-6 read — no support for a
// protection SET that changes as the controller's board changes).

// Protective Sphere — {2}{W} Enchantment. "{1}, Pay 1 life: Prevent all
// damage that would be dealt to you this turn by a source of your choice
// that shares a color with the mana spent on this activation cost."
// tracked-by: #1086 (no mechanism tracks "colors of mana spent to pay an
// activation cost" for a later color-match gate).

// Pure Reflection — {2}{W} Enchantment. "Whenever a player casts a creature
// spell, destroy all Reflections. Then that player creates an X/X white
// Reflection creature token, where X is the mana value of that spell."
// tracked-by: #1086 (`EffectTokenSpec.power`/`toughness` are literal numbers
// only, no `EffectValue` — a token sized dynamically off the triggering
// spell's mana value isn't expressible via `createToken`).

// Rampant Elephant — {3}{W} Creature, 2/2. "{G}: Target creature blocks
// this creature this turn if able." tracked-by: #1086 (no "must be
// blocked" / Lure-style forced-block mechanism exists anywhere in the
// engine).

// Rout — {3}{W}{W} Sorcery. "You may cast this spell as though it had
// flash if you pay {2} more to cast it. Destroy all creatures. They can't
// be regenerated." tracked-by: #1086 (the regen-suppression half has
// precedent — Wrath of God's `resolve()` + `ctx.destroyAll("Creature",
// {cantBeRegenerated:true})`, lea/white.ts — but "grant flash for an
// additional payment on top of the normal mana cost" has no capability:
// `AlternativeCost` REPLACES the mana cost rather than adding to it).

// Samite Ministration — {1}{W} Instant. "Prevent all damage that would be
// dealt to you this turn by a source of your choice. Whenever damage from a
// black or red source is prevented this way this turn, you gain that much
// life." tracked-by: #1086 (the "choose a source, prevent all damage from
// it this turn" half has a resolve()-only precedent —
// `ctx.preventNextDamageFromSource`, Circle of Protection — but the LINKED
// "gain life equal to the amount actually prevented" has no hook: the
// shield primitive doesn't report back the prevented amount).

// Spirit of Resistance — {2}{W} Enchantment. "As long as you control a
// permanent of each color, prevent all damage that would be dealt to you."
// tracked-by: #1086 (needs a per-permanent COLOR DERIVATION inside a
// `replacementEffects[].appliesTo` predicate, but that context — unlike
// `StaticEffectContext.getColors`, only threaded into `staticEffects[]`
// predicates — has no color field and no ctx; Divine Presence / Harsh
// Judgment above don't hit this gap because their conditions read fields
// already present directly on the DamageReplacementEvent).

// Sunscape Apprentice — {W} Creature, 1/1. "{G}, {T}: Target creature gets
// +1/+1 until end of turn. {U}, {T}: Put target creature you control on top
// of its owner's library." tracked-by: #1086 (the `moveZone` Op's
// `target`-shape, battlefield permanent, only supports `to: "hand"` — any
// other destination including `library` from a live permanent is
// unhandled, confirmed in the interpreter's `moveZone` executor).

// Winnow — {1}{W} Instant. "Destroy target nonland permanent if another
// permanent with the same name is on the battlefield. Draw a card."
// tracked-by: #1086 (no dynamic same-name board predicate exists —
// `EffectCardFilter.name` is a fixed literal string, not "the target's own
// name").

// ─────────────────────────────────────────────────────────────────────────
// Domain cluster (parent PRD #1063, issue #1066)
// ─────────────────────────────────────────────────────────────────────────

// Wayfaring Giant — {5}{W} Creature — Giant, printed 1/3. "Domain — This
// creature gets +1/+1 for each basic land type among lands you control."
// (CR 604.3 CDA, CR 702 preamble Domain ability word, issue #1066.) A
// self-scoped `pt-cda` (`EFFECT_AFFECTS_SELF`) whose `compute` returns the
// Domain-count DELTA on top of the printed 1/3 (mirrors Crusading Knight's
// "compute returns the delta, not the total" convention above) via the
// shared `countDomain` helper — the SAME scan `SpellContext.getDomain` /
// Collective Restraint's dynamic attack tax use.
export const wayfaringGiant: CardDefinition = {
    id: "57e45de5-0e8b-41d3-979b-ec5a29cac682",
    name: "Wayfaring Giant",
    rarity: "uncommon",
    oracleText:
        "Domain — This creature gets +1/+1 for each basic land type among lands you control. (Plains, Island, Swamp, Mountain, and Forest are basic land types.)",
    manaCost: { X: 5, W: 1 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 1,
    toughness: 3,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                const domain = countDomain(state, source.controllerId);
                return { power: domain, toughness: domain };
            },
        },
    ],
};

// Strength of Unity — {3}{W} Enchantment — Aura. "Enchant creature. Domain —
// Enchanted creature gets +1/+1 for each basic land type among lands you
// control." (CR 303.4 aura, CR 604.3 CDA, CR 702 preamble Domain ability
// word, issue #1066.) The `pt-cda` reads the AURA'S OWN controller's Domain
// (`source` = the Aura permanent) — "lands you control" is the Aura
// controller's board, not the enchanted creature's controller (relevant when
// an opponent's creature is enchanted by an Aura you cast, though Strength
// of Unity is normally cast on your own creature).
export const strengthOfUnity: CardDefinition = {
    id: "1a9d4ff8-af35-413f-9aa2-f4c6e34fade2",
    name: "Strength of Unity",
    rarity: "common",
    oracleText:
        "Enchant creature\nDomain — Enchanted creature gets +1/+1 for each basic land type among lands you control.",
    manaCost: { X: 3, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (source, state) => {
                const domain = countDomain(state, source.controllerId);
                return { power: domain, toughness: domain };
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Pile-division cluster (parent PRD #1063, issue #1067, ADR 0053)
// ─────────────────────────────────────────────────────────────────────────

// Death or Glory — {4}{W} Sorcery. "Separate all creature cards in your
// graveyard into two piles. Exile the pile of an opponent's choice and
// return the other to the battlefield." (CR 406 exile, CR 400.7 reanimation,
// ADR 0053 pile division.) The object set is the caster's OWN graveyard
// (`{ set: "graveyard" }`, already public — no reveal step needed); divider =
// the caster, chooser = an opponent — the pile-division table's "Divider:
// you / Chooser: an opponent" row (Fact or Fiction's twin). `moveZone`'s
// bare-picks-`cards` shape moves each WHOLE pile in one Op (exile / reanimate
// under the owner's default control) — no `forEach` wrapper needed.
export const deathOrGlory: CardDefinition = {
    id: "81f967c9-b38d-489d-96cc-44a6b1804e10",
    name: "Death or Glory",
    rarity: "rare",
    oracleText:
        "Separate all creature cards in your graveyard into two piles. Exile the pile of an opponent's choice and return the other to the battlefield.",
    manaCost: { X: 4, W: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "divideIntoPiles",
            objects: {
                set: "graveyard",
                controller: "controller",
                filter: { type: "Creature" },
            },
            divider: "controller",
            chooser: "opponent",
            dividePrompt:
                "Death or Glory — divide the creature cards in your graveyard into two piles.",
            pickPrompt:
                "Choose a pile: it is exiled, the other returns to the battlefield.",
            chosenBind: "$deathOrGloryChosen",
            otherBind: "$deathOrGloryOther",
            chosenEffect: [
                {
                    op: "moveZone",
                    cards: { ref: "$deathOrGloryChosen" },
                    player: "controller",
                    from: "graveyard",
                    to: "exile",
                },
            ],
            otherEffect: [
                {
                    op: "moveZone",
                    cards: { ref: "$deathOrGloryOther" },
                    player: "controller",
                    from: "graveyard",
                    to: "battlefield",
                },
            ],
        },
    ],
};

// Fight or Flight — {3}{W} Enchantment. "At the beginning of combat on each
// opponent's turn, separate all creatures that player controls into two
// piles. Only creatures in the pile of their choice can attack this turn."
// (CR 603.6a combat-begin trigger via `phaseTrigger`, CR 508.1a attack
// restriction, ADR 0053 pile division.) `scope: "opponents"` means the
// scoped player is read via `{ ref: "$event.activePlayerId" }` (issue #1066
// precedent), NOT the plain `"opponent"` selector — divider stays the
// enchantment's own `"controller"` (fixed, "you" always divides regardless
// of scope) while the object set's owner AND the chooser are both the
// firing event's active player (the affected opponent). The chosen pile has
// no restriction (may attack, the default) — `chosenEffect: []`; the other
// pile can't attack this turn via the new `restrictCombat` Op.
export const fightOrFlight: CardDefinition = {
    id: "46bde162-3737-4b93-a27a-63b909a4183d",
    name: "Fight or Flight",
    rarity: "rare",
    oracleText:
        "At the beginning of combat on each opponent's turn, separate all creatures that player controls into two piles. Only creatures in the pile of their choice can attack this turn.",
    manaCost: { X: 3, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "fight-or-flight-divide",
            oracleText:
                "At the beginning of combat on each opponent's turn, separate all creatures that player controls into two piles. Only creatures in the pile of their choice can attack this turn.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "opponents",
            effects: [
                {
                    op: "divideIntoPiles",
                    objects: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: { ref: "$event.activePlayerId" },
                        filter: { type: "Creature" },
                    },
                    divider: "controller",
                    chooser: { ref: "$event.activePlayerId" },
                    dividePrompt:
                        "Fight or Flight — divide that player's creatures into two piles.",
                    pickPrompt:
                        "Choose a pile: only creatures in it can attack this turn.",
                    chosenBind: "$fightOrFlightChosen",
                    otherBind: "$fightOrFlightOther",
                    chosenEffect: [],
                    otherEffect: [
                        {
                            op: "forEach",
                            select: {
                                set: "bound",
                                ref: "$fightOrFlightOther",
                            },
                            effects: [
                                {
                                    op: "restrictCombat",
                                    restriction: "cant-attack",
                                    target: { ref: "$each" },
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────
// Out of scope — split cards (ADR 0010/0041, unmodelled `split` layout). NO
// stub emitted (per parent PRD #1063 scope manifest).
// ─────────────────────────────────────────────────────────────────────────

// Stand // Deliver — {W} // {2}{W} Instant // Instant. Out of scope (split
// card, ADR 0010).

// Wax // Wane — {W} // {1}{W} Instant // Instant. Out of scope (split card,
// ADR 0010).
