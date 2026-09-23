// APC — white cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { AURA_AFFECTS_HOST, type CardDefinition } from "../../types";

// The Flagbearer cycle (issue #3805). All three cards print the SAME
// rules-modifying clause, so all three declare the same `target-choice-requirement`
// static effect (CR 601.2c, `gre/targetChoiceRequirements.ts`) — the mechanic is
// named after the rule, never after a card (issue #1917), and the objects that
// satisfy it are named by a `PermanentFilter` rather than by the source, because
// the clause says "at least one Flagbearer", not "at least one of me": any
// Flagbearer on the battlefield answers any of them.
//
// "Flagbearer" itself is a creature TYPE (CR 205.3m), not a keyword ability, so
// nothing goes in `staticAbilities[]` and Guard A has nothing to resolve.
const FLAGBEARER_TARGET_REQUIREMENT_TEXT =
    "While an opponent is choosing targets as part of casting a spell they control or activating an ability they control, that player must choose at least one Flagbearer on the battlefield if able.";

// Standard Bearer — {1}{W} 1/1 Human Flagbearer.
export const standardBearer: CardDefinition = {
    id: "e0f8e16a-55f0-4147-a01a-dba7938f31c4", // APC 18
    rarity: "common",
    name: "Standard Bearer",
    oracleText: FLAGBEARER_TARGET_REQUIREMENT_TEXT,
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Flagbearer"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "target-choice-requirement",
            id: "standard-bearer-flagbearer-requirement",
            oracleText: FLAGBEARER_TARGET_REQUIREMENT_TEXT,
            binds: "opponents",
            filter: { subtypes: "Flagbearer" },
        },
    ],
};

// Coalition Honor Guard — {3}{W} 2/4 Human Flagbearer, the same clause on a
// tougher body.
export const coalitionHonorGuard: CardDefinition = {
    id: "c5b7be3e-b4af-46d4-bcc6-b44c651f2012", // APC 3
    rarity: "common",
    name: "Coalition Honor Guard",
    oracleText: FLAGBEARER_TARGET_REQUIREMENT_TEXT,
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Flagbearer"],
    power: 2,
    toughness: 4,
    staticEffects: [
        {
            kind: "target-choice-requirement",
            id: "coalition-honor-guard-flagbearer-requirement",
            oracleText: FLAGBEARER_TARGET_REQUIREMENT_TEXT,
            binds: "opponents",
            filter: { subtypes: "Flagbearer" },
        },
    ],
};

// Coalition Flag — {W} Aura. "Enchant creature you control / Enchanted creature
// is a Flagbearer / <the cycle's clause>."
//
// Two statics, in CR order. The layer-4 `subtype-add` (CR 205.3 / 613.1d) is
// ADDITIVE — the enchanted creature keeps its printed subtypes and becomes a
// Flagbearer in addition (the Tainted Well / Urborg shape) — and it is what
// makes the host answer the requirement: `satisfiesTargetChoiceRequirement`
// matches the LIVE, layer-materialized subtypes, so an enchanted vanilla
// creature is as good a Flagbearer as a printed one.
// compiler-gap: "Enchanted creature is a Flagbearer." (#3795)
export const coalitionFlag: CardDefinition = {
    id: "0e417461-a230-4548-bcc1-71377487f21b", // APC 2
    rarity: "uncommon",
    name: "Coalition Flag",
    oracleText: `Enchant creature you control\nEnchanted creature is a Flagbearer.\n${FLAGBEARER_TARGET_REQUIREMENT_TEXT}`,
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    // CR 303.4a — "Enchant creature you control": the Aura spell targets, and
    // the `controller` filter is what makes it the caster's own creature.
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    staticEffects: [
        {
            kind: "subtype-add",
            subtypes: ["Flagbearer"],
            applies: AURA_AFFECTS_HOST,
        },
        {
            kind: "target-choice-requirement",
            id: "coalition-flag-flagbearer-requirement",
            oracleText: FLAGBEARER_TARGET_REQUIREMENT_TEXT,
            binds: "opponents",
            filter: { subtypes: "Flagbearer" },
        },
    ],
};

// Divine Light — {W} Sorcery. "Prevent all damage that would be dealt this
// turn to creatures you control." (CR 615.1a.)
//
// The RECIPIENT side of prevention, and the reason it needed a new shield
// shape: every recipient-keyed list the engine already had binds one id at
// resolution, and this clause has no id to bind — "creatures you control" is a
// membership, re-read whenever damage would be dealt, so a creature that comes
// under this player's control later in the turn is shielded too (CR 615.6).
// That is the `preventDamage` mode "all-to-matching" (issue #3810): the mirror
// of "all-from-matching", with `controller` resolved ONCE here (CR 608.2 —
// "you" is the resolving controller) and only its membership left live.
//
// `cardType: "Creature"` is what keeps the controller themself unshielded: a
// player has no card type, so a typed shield never covers one.
//
// The Oracle line is a Grammar Gap worth two corpus cards, below the hand-tail
// floor, so the card is written by hand rather than paid for with a rule.
// hand-tail: "Prevent all damage that would be dealt this turn to creatures you control." (#3810)
export const divineLight: CardDefinition = {
    id: "8f596ce1-b754-4e34-98e3-e1ddda2fd9b0", // APC 8
    rarity: "common",
    name: "Divine Light",
    oracleText:
        "Prevent all damage that would be dealt this turn to creatures you control.",
    manaCost: { W: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "preventDamage",
            mode: "all-to-matching",
            match: { controller: "controller", cardType: "Creature" },
        },
    ],
};
