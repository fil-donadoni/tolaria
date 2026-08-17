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
// duplicate `CardDefinition`/lockfile row for the same oracleId. Benalish
// Emissary, Benalish Lancer and Prison Barricade shipped later, off the
// resolved kicker-ETB/keyword-grant capability slice (issue #1328,
// decomposed from #1086) — `CardInstanceState.wasKicked` closed the
// kicker-count-doesn't-survive-to-a-later-trigger gap they were originally
// blocked on. The remaining 13 candidates still need engine capabilities
// that do not exist yet (confirmed by direct code audit, not "didn't look
// hard enough") and are left as commented-out stubs at the bottom of this
// file, each tagged `// tracked-by: #1086`. Domain-cluster and
// pile-division-cluster cards are tracked to their own cluster issues
// (#1066, #1067); the 2 split cards (Stand // Deliver, Wax // Wane) are
// out-of-scope (ADR 0010/0041, unmodelled `split` layout) and carry no stub.

import type { CardDefinition, Color, CardPrint } from "../../types";
import {
    AURA_AFFECTS_HOST,
    countDomain,
    EFFECT_AFFECTS_SELF,
    PERMANENT_TYPES,
} from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { kickerPaidCondition } from "../../abilities/triggers/shared";

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

// angelOfMercy — INV reprint of the Portal Second Age definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `p02/white.ts`.
export const angelOfMercyInv: CardPrint = {
    printId: "5b6de688-685f-4389-be35-a472ada988e1", // INV 3
    definitionId: "dac5c913-4eb5-4cfb-9c24-223f14f07064", // angelOfMercy (Portal Second Age)
    setCode: "inv",
    rarity: "uncommon",
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
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}",
            mana: { X: 2 },
        },
    ],
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
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}{U}",
            mana: { X: 2, U: 1 },
        },
    ],
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
    kickers: [
        {
            id: "kicker",
            description: "Kicker {1}",
            mana: { X: 1 },
        },
    ],
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

// shackles — INV reprint of the Exodus definition (CardPrint).
// The card was first implemented here, against this printing; its home set is
// its earliest paper printing (ADR 0041), so the mechanics live in
// `exo/white.ts`.
export const shacklesInv: CardPrint = {
    printId: "35b3da05-9a3e-4827-96b8-5de244128db3", // INV 27
    definitionId: "c5315668-b8ef-49ab-a8f5-144adc7bcd84", // shackles (Exodus)
    setCode: "inv",
    rarity: "common",
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
// Kicker-conditional ETB / keyword-grant cluster (issue #1328, capability
// slice decomposed from #1086) — closed by `CardInstanceState.wasKicked`
// (issue #1753, ADR 0079) and the sibling `keyword-grant`/`keyword-remove`
// static-effect pair (`cards/types.ts`), both already exercised catalogue-
// wide (Pouncing Kavu, Duskwalker, Waterspout Elemental). No new Op or
// construct — see each card's own comment for its exact template.
// ─────────────────────────────────────────────────────────────────────────

// Benalish Emissary — {2}{W} Creature — Human Wizard, 1/4. "Kicker {1}{G}.
// When this creature enters, if it was kicked, destroy target land." (CR
// 702.33 Kicker, CR 603.6a ETB trigger with a CR 603.3d target announcement.)
//
// Closed by issue #1328 (capability slice, decomposed from #1086): the
// `kickerCount`-not-surviving-to-a-later-trigger gap this card was
// originally blocked on is closed by `CardInstanceState.wasKicked` (issue
// #1753, ADR 0079) — a typed, serialized snapshot the permanent carries the
// instant it enters, read by the ETB trigger below.
//
// Gate shape: a SINGLE Kicker (not the Battlemage cycle's "and/or" pair), so
// this uses the Waterspout Elemental template (`pls/blue.ts`) rather than
// Jacked Rabbit's `condition`/`interveningIf` pair — `conditionOnSelf:
// kickerPaidCondition("kicker")` at CR 603.4 check time, and the matching
// `if { kickerPaid: "kicker" }` branch inside `effects[]` at resolution
// time, reading the resolving TRIGGER stack item's own `kickerPayments`
// record (CR 608.2h last known information) rather than an `interveningIf`
// re-evaluated against the LIVE permanent. This sidesteps the blink
// divergence documented on Jacked Rabbit and tracked-by: #2042 — a CR 400.7
// zone change (Ephemerate) clears the LIVE permanent's `kickerPayments`
// before an `interveningIf` would re-check it, but the resolving stack
// item's own copy is unaffected, so this trigger does not misfire on blink
// the way an `interveningIf`-based gate would.
export const benalishEmissary: CardDefinition = {
    id: "6b82d56e-80d7-4be9-ac22-de3257efc458", // INV 5
    rarity: "uncommon",
    name: "Benalish Emissary",
    oracleText:
        "Kicker {1}{G} (You may pay an additional {1}{G} as you cast this spell.)\nWhen this creature enters, if it was kicked, destroy target land.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 4,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {1}{G}",
            mana: { X: 1, G: 1 },
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "benalish-emissary-kicked",
            oracleText:
                "When this creature enters, if it was kicked, destroy target land.",
            scope: "self",
            // CR 603.4 check-time gate — see the card-level comment.
            conditionOnSelf: kickerPaidCondition("kicker"),
            targetRequirement: { type: "Land", count: 1 },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerPaid: "kicker" },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        }),
    ],
};

// Benalish Lancer — {2}{W} Creature — Human Knight, 2/2. "Kicker {2}{W}. If
// this creature was kicked, it enters with two +1/+1 counters on it and
// with first strike." (CR 702.33 Kicker, CR 702.7 first strike, CR
// 122.1/614.1c ETB counters — the exact Pouncing Kavu / Duskwalker template,
// `inv/red.ts` / `inv/black.ts`: two `entersWith` counter entries each
// `count: "kicker"`, plus a `keyword-grant` gated on the permanent's own
// `wasKicked` flag (`CardInstanceState.wasKicked`, gre/state.ts) — a
// one-shot fact snapshotted from the resolving stack item's `kickerCount` at
// ETB, issue #1716/#1753. Closed by issue #1328; swap `haste`/`fear` for
// `first strike` from the shared template.
export const benalishLancer: CardDefinition = {
    id: "3a38d40a-e745-4fee-b179-f8c27e9b2fbd", // INV 7
    rarity: "common",
    name: "Benalish Lancer",
    oracleText:
        "Kicker {2}{W} (You may pay an additional {2}{W} as you cast this spell.)\nIf this creature was kicked, it enters with two +1/+1 counters on it and with first strike.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}{W}",
            mana: { X: 2, W: 1 },
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
            // `wasKicked` is a one-shot fact fixed at CR 614.1c ETB
            // replacement time (CR 702.33) and not mutated by anything else
            // while this permanent stays on the battlefield — see the
            // Pouncing Kavu / Duskwalker precedent comments for the full
            // counter-count-as-proxy anti-pattern (issue #1716) this
            // replaced. Cleared on a CR 400.7 zone change
            // (`resetBattlefieldTransientState`, issue #1753), so a
            // bounced-then-recast-unkicked or reanimated Lancer reads
            // `undefined`, not a stale `true`.
            applies: (target, source) =>
                target.id === source.id && target.wasKicked === true,
            keyword: "first strike",
        },
    ],
};

// Prison Barricade — {1}{W} Creature — Wall, 1/3, Defender. "Kicker {1}{W}.
// If this creature was kicked, it enters with a +1/+1 counter on it and
// with 'This creature can attack as though it didn't have defender.'" (CR
// 702.33 Kicker, CR 122.1/614.1c ETB counter, CR 702.3b defender.)
//
// Closed by issue #1328. "Can attack as though it didn't have defender" is
// expressed as a `keyword-remove` of `"defender"` gated on `wasKicked` — the
// sibling of the `keyword-grant` shape above (Pouncing Kavu / Duskwalker /
// Benalish Lancer), using the OTHER half of the same layer-6 static-effect
// pair (`StaticKeywordRemove`, `cards/types.ts`). This is the exact
// rules-equivalent of the printed clause: CR 702.3a's ENTIRE effect of
// defender is "a creature with defender can't attack" — stripping the
// keyword from the permanent's live `staticAbilities` (layer 6) removes that
// restriction outright, since `evaluateAttackerKeywords`
// (`gre/combatRegistry.ts`) only ever consults the DEFENDER_RULE when
// `card.staticAbilities.includes("defender")` is true. No printed defender
// left to check against once removed → no restriction to override.
export const prisonBarricade: CardDefinition = {
    id: "449c4800-8718-4593-a61e-03ad7f348c6d", // INV 25
    rarity: "common",
    name: "Prison Barricade",
    // Scryfall prints "Defender" before "Kicker" (verified via
    // `cards/named?exact=Prison+Barricade&set=inv`) — this is the catalogue's
    // first card where a keyword line leads Kicker in Oracle order. Reproduced
    // verbatim in Scryfall's own line order; the catalogue-wide Kicker
    // declaration guard's Oracle anchor (`cards/__tests__/kickerDeclarations.test.ts`)
    // accepts a kicker description matching any line of the Oracle text, not
    // only the first, so this real print order does not need to be bent.
    oracleText:
        "Defender (This creature can't attack.)\nKicker {1}{W} (You may pay an additional {1}{W} as you cast this spell.)\nIf this creature was kicked, it enters with a +1/+1 counter on it and with \"This creature can attack as though it didn't have defender.\"",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 3,
    staticAbilities: ["defender"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {1}{W}",
            mana: { X: 1, W: 1 },
        },
    ],
    entersWith: {
        counters: [{ type: "+1/+1", count: "kicker" }],
    },
    staticEffects: [
        {
            kind: "keyword-remove",
            // Same `wasKicked` one-shot-fact reasoning as Benalish Lancer
            // above — see that card's comment for the full precedent chain.
            applies: (target, source) =>
                target.id === source.id && target.wasKicked === true,
            keyword: "defender",
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
// creature gains shroud until end of turn." Unblocked by PR #2040 (issue
// #959): `shroud` is `status: "implemented"` in the Mechanics Registry and
// `gre/permanentGuard.ts`'s `isGuardedAgainst` bridges a dynamically-granted
// "shroud" string the same way it bridges `hexproof` — `grantAbility`
// appending the literal string to `staticAbilities` is enforced live.
// Straight `grantAbility` DSL body over `$source`, precedent Homarid Warrior
// (fem/blue.ts) minus its tap/skipNextUntap legs.
export const glimmeringAngel: CardDefinition = {
    id: "f14f55e4-eded-4a86-87f4-b8fa6f30bc0f",
    name: "Glimmering Angel",
    rarity: "common",
    oracleText: "Flying\n{U}: This creature gains shroud until end of turn.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "glimmering-angel-shroud",
            oracleText: "{U}: This creature gains shroud until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            effects: [
                {
                    op: "grantAbility",
                    ability: "shroud",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

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

// Rout — the CR 601.3c conditional-flash rider (issue #2146), shipped as the
// declarative `flashSurcharge` field: the card is legal to ANNOUNCE whenever
// its controller has priority ("that player may begin to cast that spell as
// though it had flash"), and the {2} is charged — mandatorily — only when the
// cast actually lands outside their own sorcery-speed window. Inside it the
// spell costs exactly {3}{W}{W}; the surcharge is never payable for nothing.
// The mass-destruction half is the Wrath of God shape (`lea/white.ts`): a
// `forEach` over battlefield creatures feeding `destroy` with
// `cantBeRegenerated` (CR 701.19 — Regenerate is what the clause suppresses).
export const rout: CardDefinition = {
    id: "94bc55ed-b89b-4e22-b3f1-4ce0f8d180d7",
    name: "Rout",
    rarity: "rare",
    oracleText:
        "You may cast this spell as though it had flash if you pay {2} more to cast it. Destroy all creatures. They can't be regenerated.",
    manaCost: { X: 3, W: 2 },
    types: ["Sorcery"],
    flashSurcharge: { X: 2 },
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [
                {
                    op: "destroy",
                    target: { ref: "$each" },
                    cantBeRegenerated: true,
                },
            ],
        },
    ],
};

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

// Winnow — "Destroy target nonland permanent if another permanent with the
// same name is on the battlefield. Draw a card." (issue #2065, unblocking the
// stub this card used to be.)
//
// CR 608.2 — the same-name condition is checked as the spell RESOLVES, never
// at announcement. So the `targetRequirement` stays a plain nonland permanent
// (CR 115.1c): Winnow may target anything legal, and if the same-named
// permanent leaves in response it resolves, destroys nothing, and still draws.
// Folding the condition into targeting would be a rules bug (it would also
// make the spell fizzle instead of drawing).
//
// CR 201.2 — "another permanent with the same name" is exactly "at least TWO
// permanents share that name": the target itself is always one of them, so a
// `>= 2` count needs no exclusion mechanism. The count spans BOTH battlefields
// (`acrossAllPlayers`) and is unrestricted by type — the Oracle says "another
// permanent", not "another nonland permanent"; `nonland` is a targeting
// restriction only. `{ ref: "$target0.name" }` is the reserved
// announced-target ref (issue #2065, `gre/effects/targetRef.ts`), read as the
// target's LIVE name, so a Clone that has become the target counts.
export const winnow: CardDefinition = {
    id: "d61748dd-4010-47da-8717-ca0147877057",
    name: "Winnow",
    rarity: "rare",
    oracleText:
        "Destroy target nonland permanent if another permanent with the same name is on the battlefield.\nDraw a card.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        excludeTypes: "Land",
        count: 1,
    },
    effects: [
        {
            op: "if",
            predicate: {
                left: {
                    count: {
                        zone: "battlefield",
                        acrossAllPlayers: true,
                        filter: { name: { ref: "$target0.name" } },
                    },
                },
                op: "ge",
                right: 2,
            },
            then: [{ op: "destroy", target: { target: 0 } }],
        },
        // Unconditional — a separate Oracle sentence, so it happens whether or
        // not the destroy leg fired.
        { op: "draw", player: "controller", count: 1 },
    ],
};

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
