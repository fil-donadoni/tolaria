// APC — white cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
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
// hand-tail: Enchanted creature is a Flagbearer. (#4365)
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
// hand-tail: "Prevent all damage that would be dealt this turn to creatures you control." (#4321)
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

// False Dawn — {1}{W} Sorcery (issue #3811). "Until end of turn, spells and
// abilities you control that would add colored mana instead add that much
// white mana. Until end of turn, you may spend white mana as though it were
// mana of any color. / Draw a card."
//
// Two until-end-of-turn effects, both cleared at CLEANUP (CR 514.2):
//
//  - CR 614.1a — a replacement on PRODUCTION, keyed on the controller of the
//    spell or ability that makes the mana (`replaceManaProductionColor`):
//    every land, mana ability, ritual or triggered mana ability of this
//    player's adds white instead of its colour; colourless stays colourless.
//  - CR 609.4b — a permission on SPENDING (`grantManaSubstitution`): white
//    may pay any coloured pip of any cost this player pays, which is what
//    keeps the first effect from locking its own caster out of their colours.
//    The cost and the mana spent are unchanged by it.
export const falseDawn: CardDefinition = {
    id: "1695e0ba-005a-4652-aea7-e1d1f9ff5d66", // APC 10
    rarity: "rare",
    name: "False Dawn",
    oracleText:
        "Until end of turn, spells and abilities you control that would add colored mana instead add that much white mana. Until end of turn, you may spend white mana as though it were mana of any color.\nDraw a card.",
    manaCost: { X: 1, W: 1 },
    types: ["Sorcery"],
    effects: [
        { op: "replaceManaProductionColor", player: "controller", color: "W" },
        {
            op: "grantManaSubstitution",
            player: "controller",
            from: "W",
            breadth: "any-color",
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Gerrard Capashen — {3}{W}{W} 3/4 Legendary Human Soldier.
//  • Upkeep: gain 1 life per card in TARGET opponent's hand — a real announced
//    player target (CR 603.3d); the amount is the `count` of that player's
//    hand, and `gainLife` no-ops on 0.
//  • "{3}{W}: Tap target creature. Activate only if {self} is attacking." — the
//    activation restriction (CR 602.5) is a `canActivate` predicate reading
//    the source's own `isAttacking` flag (CR 508.1k: set at declare-attackers,
//    cleared when it leaves combat), the Clockwork Beast shape. The Bot gates
//    on it via `activationPreconditionViolation`; the client affordability
//    sweep skips `canActivate` abilities by design.
// hand-tail: {3}{W}: Tap target creature. Activate only if {self} is attacking. (#4331)
export const gerrardCapashen: CardDefinition = {
    id: "ccca800f-e850-4bec-95d0-70280b51b7a7", // APC 11
    rarity: "rare",
    name: "Gerrard Capashen",
    oracleText:
        "At the beginning of your upkeep, you gain 1 life for each card in target opponent's hand.\n{3}{W}: Tap target creature. Activate only if Gerrard Capashen is attacking.",
    manaCost: { X: 3, W: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Soldier"],
    power: 3,
    toughness: 4,
    triggeredAbilities: [
        phaseTrigger({
            id: "gerrard-capashen-upkeep-life",
            oracleText:
                "At the beginning of your upkeep, you gain 1 life for each card in target opponent's hand.",
            phase: "UPKEEP",
            scope: "your",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: { zone: "hand", controller: { target: 0 } },
                    },
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "gerrard-capashen-tap",
            oracleText:
                "{3}{W}: Tap target creature. Activate only if Gerrard Capashen is attacking.",
            cost: { mana: { X: 3, W: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            canActivate: (source) => source.isAttacking === true,
            effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
        },
    ],
};

// Haunted Angel — {2}{W} 3/3 Creature — Angel, flying. "When this creature dies,
// exile it and each other player creates a 3/3 black Angel creature token with
// flying." One Oracle line = ONE dies trigger (CR 603.2, CR 700.4).
//  • "exile it" moves the card now in the graveyard (CR 406, CR 603.10a — a
//    leaves-the-battlefield trigger looks back); the token comes second.
//  • "each other player" is every player but the controller (CR 102.2 — in a
//    two-player game the opponent); the engine has no third seat, so the
//    tokens go to every id in `allPlayerIds` other than the dead creature's
//    controller. Tokens are created under that player's control (CR 111.2).
// protocol card: the exiled object is the dies event's LKI payload — a card
// already in the graveyard, which no Effect Script selector can name
// (`$source` only finds a battlefield permanent; same reason as Cyclopean
// Mummy / Rooting Kavu), so the whole trigger stays resolve().
// hand-tail: When this creature dies, exile it and each other player creates a 3/3 black Angel creature token with flying. (#4334)
export const hauntedAngel: CardDefinition = {
    id: "78d2d11b-12e4-4810-a32d-8f1cdda3ec49", // APC 12
    rarity: "uncommon",
    name: "Haunted Angel",
    oracleText:
        "Flying\nWhen this creature dies, exile it and each other player creates a 3/3 black Angel creature token with flying.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        diedTrigger({
            id: "haunted-angel-exile-tokens",
            oracleText:
                "When this creature dies, exile it and each other player creates a 3/3 black Angel creature token with flying.",
            scope: "self",
            resolve: (ctx, _event, deadCreature) => {
                ctx.moveCardById(
                    deadCreature.controllerId,
                    deadCreature.id,
                    "graveyard",
                    "exile"
                );
                ctx.forEachPlayer((playerId) => {
                    if (playerId === deadCreature.controllerId) return;
                    ctx.createToken(
                        {
                            name: "Angel",
                            types: ["Creature"],
                            subtypes: ["Angel"],
                            power: 3,
                            toughness: 3,
                            colors: ["B"],
                            staticAbilities: ["flying"],
                        },
                        playerId,
                        1,
                        ctx.sourceInstanceId
                    );
                });
            },
            // aiEffects — shadow script for the bot's value model: the card
            // leaves, and the opponent gains a 3/3 flier.
            aiEffects: [
                { op: "exileSelf" },
                {
                    op: "createToken",
                    controller: "opponent",
                    token: {
                        name: "Angel",
                        types: ["Creature"],
                        subtypes: ["Angel"],
                        power: 3,
                        toughness: 3,
                        colors: ["B"],
                        staticAbilities: ["flying"],
                    },
                },
            ],
        }),
    ],
};

// Manacles of Decay — {1}{W} Aura (issue #4356). "Enchant creature / Enchanted
// creature can't attack. / {B}: Enchanted creature gets -1/-1 until end of
// turn. / {R}: Enchanted creature can't block this turn."
//
// CR 303.4 Aura: the two activated abilities name the enchanted creature, they
// never target it (CR 115.10), so both read the implicit `$host` binding
// (issue #1341). "can't attack" is the same AURA-GRANTED attack-restriction
// Hobble uses (CR 508.1c); "can't block this turn" is a turn-scoped
// `restrictCombat` grant (CR 509.1a), not a static.
// hand-tail: {R}: Enchanted creature can't block this turn. (#4356)
export const manaclesOfDecay: CardDefinition = {
    id: "f3da5010-78b6-426f-aeb4-73c21d2af581", // APC 14
    rarity: "common",
    name: "Manacles of Decay",
    oracleText:
        "Enchant creature\nEnchanted creature can't attack.\n{B}: Enchanted creature gets -1/-1 until end of turn.\n{R}: Enchanted creature can't block this turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "manacles-of-decay-cant-attack",
            predicate: () => false,
            oracleText: "Enchanted creature can't attack.",
        },
    ],
    activatedAbilities: [
        {
            id: "manacles-of-decay-shrink",
            oracleText: "{B}: Enchanted creature gets -1/-1 until end of turn.",
            cost: { mana: { B: 1 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$host" },
                    power: -1,
                    toughness: -1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "manacles-of-decay-cant-block",
            oracleText: "{R}: Enchanted creature can't block this turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            effects: [
                {
                    op: "restrictCombat",
                    restriction: "cant-block",
                    target: { ref: "$host" },
                },
            ],
        },
    ],
};
