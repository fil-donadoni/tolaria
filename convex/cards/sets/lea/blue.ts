// Limited Edition Alpha (LEA), the base set of Magic, split by colour per
// ADR 0043. Every entry is a CardDefinition — LEA is the root set whose cards
// later editions (LEB, 2ED, 3ED, …) reprint via CardPrint, resolving printId →
// definitionId → the shared LEA definition (ADR 0014). Modern Scryfall oracle
// text is authoritative (ADR 0004). Generic mana is encoded as `X: n`
// (e.g. {2}{R} → { X: 2, R: 1 }). Cards are classified by the colour identity
// of their mana cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type {
    CardDefinition,
    Color,
    PermanentView,
    Rarity,
    SpellContext,
    SpellMode,
} from "../../types";
import {
    AURA_AFFECTS_HOST,
    BASIC_LAND_SUBTYPES,
    TARGET_ACL_PERMANENT,
} from "../../types";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";
import { makeLace } from "./white";
import { makeUpkeepPayOrElse } from "./white";

export const airElemental: CardDefinition = {
    id: "69c3b2a3-0daa-4d42-832d-fcdfda6555ea",
    rarity: "uncommon",
    name: "Air Elemental",
    oracleText: "Flying",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 4,
    toughness: 4,
    staticAbilities: ["flying"],
};

// Ancestral Recall — "Target player draws three cards." (CR 121.1)
export const ancestralRecall: CardDefinition = {
    id: "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b",
    rarity: "rare",
    name: "Ancestral Recall",
    oracleText: "Target player draws three cards.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    effects: [{ op: "draw", player: { target: 0 }, count: 3 }],
};

// Animate Artifact — "Enchant artifact. As long as enchanted artifact
// isn't a creature, it's an artifact creature with power and toughness
// each equal to its mana value." (CR 303.4 aura, CR 205 type-add via
// layer-4 surrogate `type-add`, CR 604.3 / 613 layer 7b CDA P/T derived
// from the host's printed mana value.) Predicate gates on the host not
// already being a Creature at apply-time (CR 205 layer-4 — close enough
// for LEA scope; full layer-1-through-7 recompute is out of scope).
export const animateArtifact: CardDefinition = {
    id: "664b46f5-0424-4f4e-9f26-6bd2cf5e0357",
    rarity: "uncommon",
    name: "Animate Artifact",
    oracleText:
        "Enchant artifact\nAs long as enchanted artifact isn't a creature, it's an artifact creature with power and toughness each equal to its mana value.",
    manaCost: { X: 3, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    staticEffects: [
        {
            kind: "type-add",
            applies: (target, source, ctx) =>
                AURA_AFFECTS_HOST(target, source, ctx) &&
                !ctx.isCreature(target),
            types: ["Creature"],
        },
        {
            kind: "pt-cda",
            applies: (target, source, ctx) =>
                AURA_AFFECTS_HOST(target, source, ctx),
            compute: (_source, _state, ctx, target) => {
                const mv = ctx.getManaValue(target);
                return { power: mv, toughness: mv };
            },
        },
    ],
};

// Helper for the {U}/{R} "elemental blast" pair (CR 700.2 modal — counter
// target X spell OR destroy target X permanent). Both modes use the
// `colorFilter` propagated from the mode's targetRequirement.
export function makeElementalBlast(args: {
    id: string;
    name: string;
    rarity: Rarity;
    oracleColor: string;
    castColor: "U" | "R";
    targetColor: "U" | "R";
}): CardDefinition {
    return {
        id: args.id,
        name: args.name,
        rarity: args.rarity,
        oracleText: `Choose one —\n• Counter target ${args.oracleColor} spell.\n• Destroy target ${args.oracleColor} permanent.`,
        manaCost: { [args.castColor]: 1 },
        types: ["Instant"],
        modes: [
            {
                id: "counter",
                label: `Counter target ${args.oracleColor} spell`,
                oracleText: `Counter target ${args.oracleColor} spell.`,
                targetRequirement: {
                    type: "spell",
                    count: 1,
                    colorFilter: args.targetColor,
                },
                resolve: (ctx) => {
                    const t = ctx.targets[0];
                    if (t?.type === "spell") ctx.counter(t);
                },
            },
            {
                id: "destroy",
                label: `Destroy target ${args.oracleColor} permanent`,
                oracleText: `Destroy target ${args.oracleColor} permanent.`,
                targetRequirement: {
                    type: "any",
                    count: 1,
                    colorFilter: args.targetColor,
                },
                resolve: (ctx) => {
                    const t = ctx.targets[0];
                    if (t?.type === "permanent") ctx.destroy(t);
                },
            },
        ],
    };
}

export const blueElementalBlast: CardDefinition = makeElementalBlast({
    id: "20d666ef-39bf-4fbf-8201-5f1056539da2",
    rarity: "common",
    name: "Blue Elemental Blast",
    oracleColor: "red",
    castColor: "U",
    targetColor: "R",
});

// Braingeyser — "Target player draws X cards." (CR 107.3 X cost, 121.1 draw,
// 601.2b X chosen on cast, 608.3 sorcery resolution).
export const braingeyser: CardDefinition = {
    id: "62b19a12-6914-430e-81ce-dcfca47884df",
    rarity: "rare",
    name: "Braingeyser",
    oracleText: "Target player draws X cards.",
    manaCost: { X: "X", U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #852): target player draws X
    // cards (CR 121.1) via the chosen-cost `{ X: true }` count. A non-player
    // target is skipped by the executor (CR 608.2b).
    effects: [{ op: "draw", player: { target: 0 }, count: { X: true } }],
};

// Clone — "You may have Clone enter the battlefield as a copy of any creature
// on the battlefield." (CR 707.2 copy effect, 614.12 as-enters replacement.)
// The copy choice runs in a resolve step while Clone is still on the stack;
// `becomeCopyOf` overwrites its copiable characteristics before it enters.
// Declining (or no creatures present) leaves it a 0/0 that dies to SBA
// (CR 704.5f).
export const clone: CardDefinition = {
    id: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3",
    rarity: "uncommon",
    name: "Clone",
    oracleText:
        "You may have Clone enter the battlefield as a copy of any creature on the battlefield.",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    // Bot-only cast prune (#938): copies a creature on ETB — a wasted cast
    // (enters a 0/0 that dies to SBA) when no creature is in play.
    copySourceFilter: { types: "Creature" },
    resolveSteps: [
        (ctx: SpellContext) => {
            let candidates = 0;
            for (const pid of ctx.allPlayerIds) {
                candidates += ctx.getBattlefieldIds(pid, {
                    types: "Creature",
                }).length;
            }
            if (candidates === 0) return; // enters as a 0/0
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "clone-may-copy",
                prompt: "Have Clone enter as a copy of a creature?",
            });
            if (accept === undefined) return; // suspended
            if (!accept) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "clone-copy-target",
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                filter: { types: "Creature" },
                count: 1,
                prompt: "Choose a creature for Clone to copy.",
            });
            if (picks === undefined) return; // suspended
            if (picks.length === 1) ctx.becomeCopyOf(picks[0]);
        },
    ],
};

// Control Magic — "Enchant creature. You control enchanted creature."
// (CR 303.4 aura attachment, 611.2 continuous static ability, 613.1b layer 2
// control-changing effect, 702.10c summoning sickness reset on control change)
export const controlMagic: CardDefinition = {
    id: "7b52f459-c703-4a0b-9114-ff69eec61287",
    rarity: "uncommon",
    name: "Control Magic",
    oracleText: "Enchant creature\nYou control enchanted creature.",
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "control-change",
            applies: AURA_AFFECTS_HOST,
        },
    ],
};

// Copy Artifact — "You may have Copy Artifact enter the battlefield as a copy
// of any artifact on the battlefield, except it's an enchantment in addition
// to its other types." (CR 707.2 copy effect with a type-adding exception,
// CR 707.9d.) The copy keeps the Enchantment type via `additionalTypes`.
// Declining (or no artifacts present) leaves it a do-nothing enchantment.
export const copyArtifact: CardDefinition = {
    id: "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063",
    rarity: "rare",
    name: "Copy Artifact",
    oracleText:
        "You may have Copy Artifact enter the battlefield as a copy of any artifact on the battlefield, except it's an enchantment in addition to its other types.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    // Bot-only cast prune (#938): copies an artifact on ETB — a wasted cast
    // (enters a blank enchantment) when no artifact is in play.
    copySourceFilter: { types: "Artifact" },
    resolveSteps: [
        (ctx: SpellContext) => {
            let candidates = 0;
            for (const pid of ctx.allPlayerIds) {
                candidates += ctx.getBattlefieldIds(pid, {
                    types: "Artifact",
                }).length;
            }
            if (candidates === 0) return;
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "copy-artifact-may-copy",
                prompt: "Have Copy Artifact enter as a copy of an artifact?",
            });
            if (accept === undefined) return;
            if (!accept) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "copy-artifact-target",
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                filter: { types: "Artifact" },
                count: 1,
                prompt: "Choose an artifact for Copy Artifact to copy.",
            });
            if (picks === undefined) return;
            if (picks.length === 1) {
                ctx.becomeCopyOf(picks[0], {
                    additionalTypes: ["Enchantment"],
                });
            }
        },
    ],
};

// Counterspell — "Counter target spell." (CR 701.5a)
export const counterspell: CardDefinition = {
    id: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    rarity: "uncommon",
    name: "Counterspell",
    oracleText: "Counter target spell.",
    manaCost: { U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [{ op: "counter", target: { target: 0 } }],
};

// Creature Bond — "Enchant creature. When enchanted creature dies, this Aura
// deals damage equal to that creature's toughness to the creature's
// controller." (CR 303.4 aura attachment, 603.2 death trigger, 603.10 last
// known information for the host's toughness). The trigger fires before SBA
// orphan-aura cleanup so `self.attachedTo` is still set when matched; the
// resolve reads the host's toughness from the event snapshot.
export const creatureBond: CardDefinition = {
    id: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c",
    rarity: "common",
    name: "Creature Bond",
    oracleText:
        "Enchant creature\nWhen enchanted creature dies, this Aura deals damage equal to that creature's toughness to the creature's controller.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        diedTrigger({
            id: "creature-bond-death",
            oracleText:
                "When enchanted creature dies, Creature Bond deals damage equal to that creature's toughness to the creature's controller.",
            scope: "any",
            condition: (event, self) =>
                event.creatureInstanceId === self.attachedTo,
            resolve: (ctx, _event, dead) => {
                ctx.dealDamage(
                    { type: "player", id: dead.controllerId },
                    dead.lastKnownToughness
                );
            },
        }),
    ],
};

// Feedback — "Enchant enchantment. At the beginning of the upkeep of enchanted
// enchantment's controller, Feedback deals 1 damage to that player." (CR 303.4
// aura attachment to a non-creature host, 603.6a phase trigger). Trigger fires
// only on the host's controller's upkeep — same lookup pattern as Farmstead.
export const feedback: CardDefinition = {
    id: "0eb8f591-d763-49bf-8ef9-86265aaa72f7",
    rarity: "uncommon",
    name: "Feedback",
    oracleText:
        "Enchant enchantment\nAt the beginning of the upkeep of enchanted enchantment's controller, this Aura deals 1 damage to that player.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Enchantment", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "feedback-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted enchantment's controller, Feedback deals 1 damage to that player.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                ctx.dealDamage({ type: "player", id: hostController }, 1);
            },
        }),
    ],
};

// Flight — "Enchant creature. Enchanted creature has flying." (CR 303.4 aura
// attachment, 702.9 flying, 611.2 keyword grant via static effect).
export const flight: CardDefinition = {
    id: "67c7784b-6b79-4268-a714-895c82809aff",
    rarity: "common",
    name: "Flight",
    oracleText: "Enchant creature\nEnchanted creature has flying.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
};

// Invisibility — "Enchant creature. Enchanted creature can't be blocked
// except by Walls." (CR 303.4 aura, 509.1b block restriction). The
// block-restriction is on the aura's staticEffects; the combat validator
// discovers it by scanning permanents attached to the attacker.
export const invisibility: CardDefinition = {
    id: "1858ac51-e6a7-48d7-8759-166070ca13d8",
    rarity: "common",
    name: "Invisibility",
    oracleText:
        "Enchant creature\nEnchanted creature can't be blocked except by Walls.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "block-restriction",
            id: "invisibility-wall-only",
            side: "attacker" as const,
            // CR 509.1b — can be blocked only by Walls
            predicate: (_self, opponent) => opponent.subtypes.includes("Wall"),
            oracleText: "Enchanted creature can't be blocked except by Walls.",
        },
    ],
};

// Jump — "Target creature gains flying until end of turn." (CR 702.9 flying,
// 611.1b temporary keyword grant with end-of-turn duration).
export const jump: CardDefinition = {
    id: "cb3f4b11-ad1b-48e2-a500-787d351b0174",
    rarity: "common",
    name: "Jump",
    oracleText: "Target creature gains flying until end of turn.",
    manaCost: { U: 1 },
    types: ["Instant"],
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
};

// Lifetap — "Whenever a Forest an opponent controls becomes tapped, you gain
// 1 life." (CR 603.2 PERMANENT_TAPPED trigger). Fires for any tap of an
// opponent-controlled Forest, not just for-mana taps — `forMana` is omitted.
export const lifetap: CardDefinition = {
    id: "11add837-7ee4-4104-b031-c161bce459ae",
    rarity: "uncommon",
    name: "Lifetap",
    oracleText:
        "Whenever a Forest an opponent controls becomes tapped, you gain 1 life.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "lifetap-gain",
            oracleText:
                "Whenever a Forest an opponent controls becomes tapped, you gain 1 life.",
            scope: "opponents",
            filter: { subtypes: "Forest" },
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Lord of Atlantis — "Other Merfolk creatures get +1/+1 and have islandwalk."
// (CR 611 layer 7c, 702.13c landwalk). Lord-style static effects: pt-buff at
// stat-read time, keyword-grant applied imperatively at battlefield
// entry/exit.
export const lordOfAtlantis: CardDefinition = {
    id: "210c4a90-fc7a-4c76-aeaa-20a005e45386",
    rarity: "rare",
    name: "Lord of Atlantis",
    oracleText:
        "Other Merfolk get +1/+1 and have islandwalk. (They can't be blocked as long as defending player controls an Island.)",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Merfolk"),
            power: 1,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                ctx.hasSubtype(target, "Merfolk"),
            keyword: "islandwalk",
        },
    ],
};

// Magical Hack — "Change the text of target spell or permanent by replacing
// all instances of one basic land type with another." (CR 612 text-changing
// effect, layer 3.) The modal picker selects the replacement ("to") basic land
// type; the replaced ("from") type is derived from — and so validated against —
// the land types the target actually references (its land subtypes plus the
// types its landwalk keywords name, via ctx.getLandTypesPresent), per CR 612
// ("replace all instances of one basic land type [that appears]"). The change
// rides the target instance, lasting indefinitely and ending on a zone change
// (CR 612.6/612.7). For Alpha targets at most one basic land type is present,
// so the from-type is unambiguous; a target referencing several is a documented
// gap (ADR 0011) — the first that differs from the chosen type is used.

function magicalHackMode(toType: string): SpellMode {
    return {
        id: toType.toLowerCase(),
        label: toType,
        oracleText: `Replace a basic land type with ${toType}.`,
        resolve: (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target) return;
            const present = ctx.getLandTypesPresent(target);
            // Prefer a from-type that actually differs from the choice; fall
            // back to the only type present (a no-op same-type pick).
            const from = present.find((t) => t !== toType) ?? present[0];
            if (!from) return; // target references no basic land type — no-op
            ctx.addTextChange(target, { kind: "land-type", from, to: toType });
        },
    };
}

export const magicalHack: CardDefinition = {
    id: "2bd4202c-0477-45aa-82fd-83c85d6d4bef",
    rarity: "rare",
    name: "Magical Hack",
    oracleText:
        'Change the text of target spell or permanent by replacing all instances of one basic land type with another. (For example, you may change "swampwalk" to "plainswalk." This effect lasts indefinitely.)',
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell-or-permanent", count: 1 },
    modes: BASIC_LAND_SUBTYPES.map(magicalHackMode),
};

export const mahamotiDjinn: CardDefinition = {
    id: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb",
    rarity: "rare",
    name: "Mahamoti Djinn",
    oracleText:
        "Flying (This creature can't be blocked except by creatures with flying or reach.)",
    manaCost: { X: 4, U: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 6,
    staticAbilities: ["flying"],
};

export const merfolkOfThePearlTrident: CardDefinition = {
    id: "2b871039-6a66-4ac3-95e7-24759c1f2f92",
    rarity: "common",
    name: "Merfolk of the Pearl Trident",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 1,
    toughness: 1,
};

// Phantasmal Forces — "Flying. At the beginning of your upkeep, sacrifice
// this creature unless you pay {U}." (CR 702.9 flying, CR 603.6a phase
// trigger, CR 117.3a may-pay with hard sacrifice on decline.)
export const phantasmalForces: CardDefinition = {
    id: "0631c7c8-9aa5-4333-8e20-20247fc47033",
    rarity: "uncommon",
    name: "Phantasmal Forces",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice this creature unless you pay {U}.",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 4,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "phantasmal-forces-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this creature unless you pay {U}.",
            cost: { U: 1 },
            prompt: "Pay {U} to keep Phantasmal Forces?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Phantasmal Terrain — "Enchant land. As this enters, choose a basic land
// type. Enchanted land is the chosen type." (CR 305.7 subtype replacement,
// CR 303.4 aura). Modal choice at cast time selects which basic land type
// the host becomes. Each mode applies a subtype-set with a single subtype.
export const phantasmalTerrain: CardDefinition = {
    id: "1c371aa1-1619-41e3-8364-7bc9b8cf5d14",
    rarity: "common",
    name: "Phantasmal Terrain",
    oracleText:
        "Enchant land\nAs Phantasmal Terrain enters, choose a basic land type.\nEnchanted land is the chosen type.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    modes: [
        {
            id: "plains",
            label: "Plains",
            oracleText: "Enchanted land is a Plains.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Plains"],
                },
            ],
        },
        {
            id: "island",
            label: "Island",
            oracleText: "Enchanted land is an Island.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Island"],
                },
            ],
        },
        {
            id: "swamp",
            label: "Swamp",
            oracleText: "Enchanted land is a Swamp.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Swamp"],
                },
            ],
        },
        {
            id: "mountain",
            label: "Mountain",
            oracleText: "Enchanted land is a Mountain.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Mountain"],
                },
            ],
        },
        {
            id: "forest",
            label: "Forest",
            oracleText: "Enchanted land is a Forest.",
            staticEffects: [
                {
                    kind: "subtype-set",
                    applies: AURA_AFFECTS_HOST,
                    subtypes: ["Forest"],
                },
            ],
        },
    ],
};

export const phantomMonster: CardDefinition = {
    id: "e46d2cf5-e8d0-4fb2-b950-252d52084b63",
    rarity: "uncommon",
    name: "Phantom Monster",
    oracleText: "Flying",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
};

// Pirate Ship — "Pirate Ship can't attack unless defender controls an Island.
// {T}: Pirate Ship deals 1 damage to any target." (CR 508.1c attack
// restriction, 605 activated ability, 120.1 damage). The attack restriction
// is data-driven via `staticEffects[attack-restriction]` (same pattern as
// Sea Serpent).
export const pirateShip: CardDefinition = {
    id: "d0a7cb23-d229-43c5-addd-dcf423984b0c",
    rarity: "rare",
    name: "Pirate Ship",
    oracleText:
        "This creature can't attack unless defending player controls an Island.\n{T}: This creature deals 1 damage to any target.\nWhen you control no Islands, sacrifice this creature.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Pirate"],
    power: 4,
    toughness: 3,
    staticAbilities: [],
    staticEffects: [
        {
            // CR 508.1c — can't attack unless defending player controls an Island
            kind: "attack-restriction" as const,
            id: "pirate-ship-island-restriction",
            predicate: (
                _self: PermanentView,
                defenderBattlefield: readonly PermanentView[]
            ) => defenderBattlefield.some((c) => c.subtypes.includes("Island")),
            oracleText:
                "Pirate Ship can't attack unless defending player controls an Island.",
        },
    ],
    activatedAbilities: [
        {
            id: "pirate-ship-zap",
            oracleText: "{T}: Pirate Ship deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Power Leak — "Enchant enchantment\nAt the beginning of the upkeep of
// enchanted enchantment's controller, that player may pay any amount of mana.
// This Aura deals 2 damage to that player. Prevent X of that damage, where X
// is the amount of mana that player paid this way." (modern Scryfall Oracle;
// CR 303.4 aura, 603.6a phase trigger, 117.3a optional cost, 615 prevention).
// The pre-Oracle Alpha printing was "lose 1 life unless pay {U}" — a wholly
// different effect; issue #960 corrected it to the modern damage/prevention.
//
// "Pay any amount of mana … prevent X of that [2] damage" is decomposed into
// two sequential {1} optional payments (CR 117.3a), each preventing one of the
// two points of damage: paying more than {2} prevents nothing further, so the
// game-observable outcome (take 0, 1, or 2 damage) is faithful across the whole
// legal range without needing a variable-amount payment primitive. This is a
// primitive-reuse decomposition, NOT the {2}-lump cap-hack that conflates the
// two points into one all-or-nothing may-pay (rejected for Errant Minion, ICE
// #628) — each point is offered independently, so partial (pay {1}) prevention
// is expressible. The final `dealDamage` runs only after BOTH choices are
// collected, so a single `resolve` re-run on resume never double-applies it.
export const powerLeak: CardDefinition = {
    id: "ccc982b6-35b2-4e33-ace2-86cb79123e4f",
    rarity: "common",
    name: "Power Leak",
    oracleText:
        "Enchant enchantment\nAt the beginning of the upkeep of enchanted enchantment's controller, that player may pay any amount of mana. This Aura deals 2 damage to that player. Prevent X of that damage, where X is the amount of mana that player paid this way.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Enchantment", count: 1 },
    triggeredAbilities: [
        phaseTrigger({
            id: "power-leak-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted enchantment's controller, that player may pay any amount of mana. This Aura deals 2 damage to that player. Prevent X of that damage, where X is the amount of mana that player paid this way.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx, _event, hostController) => {
                let prevented = 0;
                const first = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: "power-leak-prevent-1",
                    cost: { X: 1 },
                    prompt: "Pay {1} to prevent 1 damage from Power Leak?",
                });
                if (first === undefined) return; // suspended
                if (first) prevented++;
                const second = ctx.requestMayPay({
                    playerId: hostController,
                    choiceId: "power-leak-prevent-2",
                    cost: { X: 1 },
                    prompt: "Pay {1} to prevent 1 more damage from Power Leak?",
                });
                if (second === undefined) return; // suspended
                if (second) prevented++;
                const damage = 2 - prevented;
                if (damage > 0) {
                    ctx.dealDamage(
                        { type: "player", id: hostController },
                        damage
                    );
                }
            },
        }),
    ],
};

// Power Sink — "Counter target spell unless its controller pays {X}. If that
// player doesn't, they tap all lands with mana abilities they control and
// lose all unspent mana." (CR 701.5a counter-unless-pay, CR 117.3a may-pay).
export const powerSink: CardDefinition = {
    id: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9",
    rarity: "common",
    name: "Power Sink",
    oracleText:
        "Counter target spell unless its controller pays {X}. If that player doesn't, they tap all lands with mana abilities they control and lose all unspent mana.",
    manaCost: { X: "X", U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target || target.type !== "spell") return;
        const spellController = ctx.getController(target);
        const x = ctx.getX();
        const accept = ctx.requestMayPay({
            playerId: spellController,
            choiceId: "power-sink-pay",
            cost: x > 0 ? { X: x } : undefined,
            prompt: `Pay {${x}} to prevent your spell from being countered?`,
        });
        if (accept === undefined) return;
        if (!accept) {
            ctx.tapAllLands(spellController);
            ctx.drainManaPool(spellController);
            ctx.counter(target);
        }
    },
};

// Prodigal Sorcerer — "{T}: Prodigal Sorcerer deals 1 damage to any target."
// (CR 605 activated ability, 120.1 damage). The original "Tim".
export const prodigalSorcerer: CardDefinition = {
    id: "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a",
    rarity: "common",
    name: "Prodigal Sorcerer",
    oracleText: "{T}: This creature deals 1 damage to any target.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard", "Sorcerer"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "prodigal-sorcerer-zap",
            oracleText: "{T}: Prodigal Sorcerer deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Psionic Blast — deals 4 damage to any target and 2 damage to you.
// CR 115.4: "any target" = creature/player/planeswalker. CR 120.3: damage
// to self is a normal damage event (can be prevented/redirected), not life
// loss — resolved via dealDamage on a player target pointing at the caster.
export const psionicBlast: CardDefinition = {
    id: "a6a86e6e-bfff-46af-9d36-c912901fea92",
    rarity: "uncommon",
    name: "Psionic Blast",
    oracleText:
        "Psionic Blast deals 4 damage to any target and 2 damage to you.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    effects: [
        { op: "dealDamage", amount: 4, to: { target: 0 } },
        { op: "dealDamage", amount: 2, to: { player: "controller" } },
    ],
};

// Psychic Venom — "Enchant land. Whenever enchanted land becomes tapped,
// Psychic Venom deals 2 damage to that land's controller." (CR 303.4 aura,
// 603.2 PERMANENT_TAPPED trigger, 120.1 damage). Fires on every tap of the
// host land — `forMana` is ignored, mana taps and Twiddle taps both count.
export const psychicVenom: CardDefinition = {
    id: "f3f5b68a-6b0e-431e-89f0-ff60f17687a5",
    rarity: "common",
    name: "Psychic Venom",
    oracleText:
        "Enchant land\nWhenever enchanted land becomes tapped, this Aura deals 2 damage to that land's controller.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        // No `host` scope in the shared vocabulary (see ADR 0002) — the aura
        // identifies its host via `self.attachedTo`, so `scope: "any"` with a
        // host-check `condition` is the idiomatic expression.
        tappedTrigger({
            id: "psychic-venom-damage",
            oracleText:
                "Whenever enchanted land becomes tapped, Psychic Venom deals 2 damage to that land's controller.",
            scope: "any",
            condition: (event, self) =>
                !!self.attachedTo && event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.dealDamage({ type: "player", id: tapped.controllerId }, 2);
            },
        }),
    ],
};

// CR 508.1c — "can't attack unless defending player controls an Island" is
// encoded as a data-driven `staticEffects[attack-restriction]` so the same
// pattern is reusable for other cards (Reef Pirates, Phantom Monster
// variants).
// CR 603.8 — "When you control no Islands, sacrifice this creature" is a
// state-triggered ability: the trigger fires as soon as the condition becomes
// true, then doesn't trigger again until it has resolved or otherwise left
// the stack. The engine scans for state triggers as part of every stable
// checkpoint after SBA evaluation (CR 117.5).
export const seaSerpent: CardDefinition = {
    id: "d0b333b7-db4d-4439-b0de-60414cbf8d7b",
    rarity: "common",
    name: "Sea Serpent",
    oracleText:
        "This creature can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice this creature.",
    manaCost: { X: 5, U: 1 },
    types: ["Creature"],
    subtypes: ["Serpent"],
    power: 5,
    toughness: 5,
    staticAbilities: [],
    staticEffects: [
        {
            // CR 508.1c — can't attack unless defending player controls an Island
            kind: "attack-restriction" as const,
            id: "sea-serpent-island-restriction",
            predicate: (
                _self: PermanentView,
                defenderBattlefield: readonly PermanentView[]
            ) => defenderBattlefield.some((c) => c.subtypes.includes("Island")),
            oracleText:
                "Sea Serpent can't attack unless defending player controls an Island.",
        },
    ],
    triggeredAbilities: [
        // CR 603.8 — state-triggered ability. `stateTrigger` wires `STATE_CHECK`
        // narrowing and the resolve-time re-check (intervening-if) so the
        // sacrifice fizzles automatically if controller has gained an Island
        // between trigger time and resolution.
        stateTrigger({
            id: "sea-serpent-no-islands-sacrifice",
            oracleText: "When you control no Islands, sacrifice Sea Serpent.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                if (!controller) return false;
                return !controller.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
            resolve: (ctx) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

// Siren's Call — "Cast only during an opponent's turn, before attackers are
// declared. Creatures the active player controls attack this turn if able.
// At the beginning of the next end step, destroy all non-Wall creatures that
// player controls that didn't attack this turn." (CR 508.1d mass forced
// attack + delayed end-step destroy).
export const sirensCall: CardDefinition = {
    id: "d992b336-3b6e-43e1-8662-d85664349b44",
    rarity: "uncommon",
    name: "Siren's Call",
    oracleText:
        "Cast this spell only during an opponent's turn, before attackers are declared.\nCreatures the active player controls attack this turn if able.\nAt the beginning of the next end step, destroy all non-Wall creatures that player controls that didn't attack this turn.",
    manaCost: { U: 1 },
    types: ["Instant"],
    castTurnRestriction: "opponent",
    castPhaseRestriction: ["UNTAP", "UPKEEP", "DRAW", "PRECOMBAT_MAIN"],
    resolve: (ctx: SpellContext) => {
        const activePlayerId = ctx.allPlayerIds.find(
            (id) => id !== ctx.controller
        );
        if (!activePlayerId) return;
        ctx.setAllCreaturesMustAttack(activePlayerId);
        ctx.scheduleDelayedTrigger(
            sirensCall.id,
            "sirens-call-destroy",
            "next-end-step",
            { targetPlayerId: activePlayerId }
        );
    },
    delayedTriggers: [
        {
            id: "sirens-call-destroy",
            oracleText:
                "Destroy all non-Wall creatures that didn't attack this turn.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const pid = payload.targetPlayerId;
                if (!pid) return;
                const ids = ctx.getBattlefieldIds(pid, { types: "Creature" });
                for (const id of ids) {
                    const t = { type: "permanent" as const, id };
                    if (ctx.hasSubtype(t, "Wall")) continue;
                    if (ctx.hasAttackedThisTurn(t)) continue;
                    ctx.destroy(t);
                }
            },
        },
    ],
};

// Sleight of Mind — "Change the text of target spell or permanent by replacing
// all instances of one color word with another." (CR 612 text-changing effect,
// layer 3.) The color-word sibling of Magical Hack: the modal picker selects
// the replacement ("to") color word; the replaced ("from") word is derived from
// — and validated against — the color words the target actually references (its
// "protection from <color>" strings plus the colors its color-targeted
// requirements filter on, via ctx.getColorWordsPresent), per CR 612 ("replace
// all instances of one color word [that appears]"). The change rides the target
// instance, lasting indefinitely and ending on a zone change (CR 612.6/612.7).
// It changes color *words in the text*, never the object's own color (CR 612.1).
const COLOR_WORD_LIST = ["white", "blue", "black", "red", "green"] as const;

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function sleightOfMindMode(toWord: string): SpellMode {
    return {
        id: toWord,
        label: capitalize(toWord),
        oracleText: `Replace a color word with ${toWord}.`,
        resolve: (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target) return;
            const present = ctx.getColorWordsPresent(target);
            // Prefer a from-word that actually differs from the choice; fall
            // back to the only word present (a no-op same-word pick).
            const from = present.find((w) => w !== toWord) ?? present[0];
            if (!from) return; // target references no color word — no-op
            ctx.addTextChange(target, { kind: "color-word", from, to: toWord });
        },
    };
}

export const sleightOfMind: CardDefinition = {
    id: "d427790c-e322-446e-8d7d-a6b48ad41a42",
    rarity: "rare",
    name: "Sleight of Mind",
    oracleText:
        'Change the text of target spell or permanent by replacing all instances of one color word with another. (For example, you may change "target black spell" to "target blue spell." This effect lasts indefinitely.)',
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell-or-permanent", count: 1 },
    modes: COLOR_WORD_LIST.map(sleightOfMindMode),
};

// Spell Blast — "Counter target spell with mana value X." (CR 107.3 X cost,
// CR 202.3 mana value, CR 701.5a counter.) Target selection uses the new
// `mvFilter: { equals: "X" }` which resolves X at announcement against the
// chosen value and filters the stack to spells whose mana value equals X.
export const spellBlast: CardDefinition = {
    id: "845734da-ab03-4dbc-bb5f-96481d3b8e88",
    rarity: "common",
    name: "Spell Blast",
    oracleText:
        "Counter target spell with mana value X. (For example, if that spell's mana cost is {3}{U}{U}, X is 5.)",
    manaCost: { X: "X", U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        mvFilter: { equals: "X" },
    },
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (t?.type === "spell") ctx.counter(t);
    },
};

// Stasis — "Players skip their untap steps. At the beginning of your upkeep,
// sacrifice this enchantment unless you pay {U}." (CR 502.1 skip, 603.6a
// upkeep trigger, 117.3a optional cost, 701.16 sacrifice). The skip is encoded
// as a data-driven `untapRestriction` (ADR 0005) with `maxUntap: 0` and an
// any-permanent filter — the dispatcher in `untapStep` recognises a hard skip
// and clears cleanup flags without enqueueing a prompt. The upkeep trigger
// fires only on the controller's upkeep — same pattern as Pestilence.
export const stasis: CardDefinition = {
    id: "b6cef408-5b4b-49f6-9531-be544815b93f",
    rarity: "rare",
    name: "Stasis",
    oracleText:
        "Players skip their untap steps.\nAt the beginning of your upkeep, sacrifice this enchantment unless you pay {U}.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "stasis-skip-untap",
            oracleText: "Players skip their untap steps (Stasis).",
            filter: {
                types: [
                    "Artifact",
                    "Creature",
                    "Enchantment",
                    "Land",
                    "Planeswalker",
                    "Battle",
                ],
            },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        makeUpkeepPayOrElse({
            id: "stasis-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you pay {U}.",
            cost: { U: 1 },
            prompt: "Pay {U} to keep Stasis?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// Steal Artifact — "Enchant artifact. You control enchanted artifact."
// (CR 303.4 aura attachment, 611.2 continuous static ability, 613.1b layer 2
// control-changing effect). Mirrors Control Magic but targets an artifact
// instead of a creature — artifacts don't get summoning sickness on a
// control flip, so 702.10c doesn't fire.
export const stealArtifact: CardDefinition = {
    id: "83316930-d6ad-46ce-9b40-48eea856d95b",
    rarity: "uncommon",
    name: "Steal Artifact",
    oracleText: "Enchant artifact\nYou control enchanted artifact.",
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    staticEffects: [
        {
            kind: "control-change",
            applies: AURA_AFFECTS_HOST,
        },
    ],
};

export const thoughtlace: CardDefinition = makeLace({
    id: "23749375-1416-47a4-9251-52f41fe2fae9",
    rarity: "rare",
    name: "Thoughtlace",
    oracleText:
        "Target spell or permanent becomes blue. (Mana symbols on that permanent remain unchanged.)",
    manaCost: { U: 1 },
    color: "U",
});

export const timeWalk: CardDefinition = {
    id: "e0139f60-d48e-46fb-9f5a-1e3d7558c834",
    rarity: "rare",
    name: "Time Walk",
    oracleText: "Take an extra turn after this one.",
    manaCost: { X: 1, U: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.takeExtraTurn(ctx.controller);
    },
};

// Timetwister — "Each player shuffles their hand and graveyard into their
// library, then draws seven cards." (CR 121.1, 701.20)
// Timetwister itself is on the stack during resolution, so it's unaffected
// by the shuffle; after resolve() it goes to its owner's graveyard normally.
export const timetwister: CardDefinition = {
    id: "9a49dc44-616e-4bdd-8220-0bb71eccc512",
    rarity: "rare",
    name: "Timetwister",
    oracleText:
        "Each player shuffles their hand and graveyard into their library, then draws seven cards. (Then put Timetwister into its owner's graveyard.)",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.forEachPlayer((pid) => {
            ctx.moveZone(pid, "hand", "library");
            ctx.moveZone(pid, "graveyard", "library");
            ctx.shuffleLibrary(pid);
            ctx.drawCards(pid, 7);
        });
    },
};

// CR 701.20: oracle reads "you may tap or untap target ~". Modal-spell
// infrastructure (CR 700.2) is not implemented yet, so the resolve toggles
// the target's tap state — the only mode-with-effect for any board state.
// Replace with explicit mode selection once modal cast UI lands.
export const twiddle: CardDefinition = {
    id: "576e811f-26a3-4a7c-bd13-3b1cc3e184eb",
    rarity: "common",
    name: "Twiddle",
    oracleText: "You may tap or untap target artifact, creature, or land.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: TARGET_ACL_PERMANENT,
    // NOT DSL-migratable (ADR 0045): toggles tap state by reading the target's
    // current tapped status (the modal "tap OR untap" collapsed to a toggle
    // until modal cast lands). The `if` predicate grammar has no tap-state
    // test, so the branch on `getIsTapped` cannot be expressed.
    // Blocked on: an isTapped EffectPredicate (value/predicate grammar gap).
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (!target) return;
        if (ctx.getIsTapped(target)) {
            ctx.untap(target);
        } else {
            ctx.tap(target);
        }
    },
};

export const unsummon: CardDefinition = {
    id: "8512f2c1-6361-4b79-843f-80b6bceeeb99",
    rarity: "common",
    name: "Unsummon",
    oracleText: "Return target creature to its owner's hand.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #839): return the announced
    // creature to its owner's hand (CR 701.10 / 400.7).
    effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
};

// Vesuvan Doppelganger — enters as a copy of any creature, "except it doesn't
// copy that creature's color and it has [an upkeep re-copy ability]" (CR
// 707.2, 707.9d). The colour exception keeps it blue via a layer-5 colour
// override; the retained ability is flagged `retainedThroughCopy` so the
// trigger keeps functioning after the copy overwrites the presented
// characteristics (see `gre/copy.ts`). The upkeep ability re-applies the copy
// with the same two exceptions.
const VESUVAN_OWN_COLORS: Color[] = ["U"];

export const vesuvanDoppelganger: CardDefinition = {
    id: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f",
    rarity: "rare",
    name: "Vesuvan Doppelganger",
    oracleText:
        "You may have Vesuvan Doppelganger enter the battlefield as a copy of any creature on the battlefield, except it doesn't copy that creature's color and it has \"At the beginning of your upkeep, you may have this creature become a copy of target creature, except it doesn't copy that creature's color and it has this ability.\"",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    // Bot-only cast prune (#938): copies a creature on ETB — a wasted cast
    // (enters a 0/0 that dies to SBA) when no creature is in play.
    copySourceFilter: { types: "Creature" },
    resolveSteps: [
        (ctx: SpellContext) => {
            let candidates = 0;
            for (const pid of ctx.allPlayerIds) {
                candidates += ctx.getBattlefieldIds(pid, {
                    types: "Creature",
                }).length;
            }
            if (candidates === 0) return;
            const accept = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "vesuvan-may-copy",
                prompt: "Have Vesuvan Doppelganger enter as a copy of a creature?",
            });
            if (accept === undefined) return;
            if (!accept) return;
            const picks = ctx.requestChoice({
                playerId: ctx.controller,
                choiceId: "vesuvan-copy-target",
                kind: "choose-permanents",
                zone: "battlefield",
                allControllers: true,
                filter: { types: "Creature" },
                count: 1,
                prompt: "Choose a creature for Vesuvan Doppelganger to copy.",
            });
            if (picks === undefined) return;
            if (picks.length === 1) {
                ctx.becomeCopyOf(picks[0], {
                    copyColor: false,
                    ownColors: VESUVAN_OWN_COLORS,
                });
            }
        },
    ],
    triggeredAbilities: [
        {
            ...phaseTrigger({
                id: "vesuvan-doppelganger-recopy",
                oracleText:
                    "At the beginning of your upkeep, you may have Vesuvan Doppelganger become a copy of target creature, except it doesn't copy that creature's color and it has this ability.",
                phase: "UPKEEP",
                scope: "your",
                resolve: (ctx) => {
                    let candidates = 0;
                    for (const pid of ctx.allPlayerIds) {
                        candidates += ctx.getBattlefieldIds(pid, {
                            types: "Creature",
                        }).length;
                    }
                    if (candidates === 0) return;
                    const accept = ctx.requestMayPay({
                        playerId: ctx.controller,
                        choiceId: `vesuvan-recopy-may-${ctx.sourceInstanceId}`,
                        prompt: "Have Vesuvan Doppelganger become a copy of another creature?",
                    });
                    if (accept === undefined) return;
                    if (!accept) return;
                    const picks = ctx.requestChoice({
                        playerId: ctx.controller,
                        choiceId: `vesuvan-recopy-${ctx.sourceInstanceId}`,
                        kind: "choose-permanents",
                        zone: "battlefield",
                        allControllers: true,
                        filter: { types: "Creature" },
                        count: 1,
                        prompt: "Choose a creature for Vesuvan Doppelganger to copy.",
                    });
                    if (picks === undefined) return;
                    if (picks.length === 1) {
                        ctx.becomeCopyOf(picks[0], {
                            copyColor: false,
                            ownColors: VESUVAN_OWN_COLORS,
                        });
                    }
                },
            }),
            retainedThroughCopy: true,
        },
    ],
};

// Volcanic Eruption — "Destroy X target Mountains. Volcanic Eruption deals
// damage to each creature and each player equal to the number of Mountains
// put into a graveyard this way." (CR 107.3 — X chosen on cast / 601.2c —
// X-bound target count / 205.3 — subtype filter "Mountain" matches basic
// Mountain plus duals like Plateau / Taiga / Badlands / 614.5 — destroy
// returns false if a regen shield saves the land, so the damage count only
// reflects lands actually moved to graveyards / 120.3 — second-clause damage
// to each creature and each player.)
export const volcanicEruption: CardDefinition = {
    id: "a80582b1-09db-45f8-b362-0e5207a5a8e6",
    rarity: "rare",
    name: "Volcanic Eruption",
    oracleText:
        "Destroy X target Mountains. Volcanic Eruption deals damage to each creature and each player equal to the number of Mountains put into a graveyard this way.",
    manaCost: { X: "X", U: 3 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Land",
        subtypeFilter: "Mountain",
        count: "X",
    },
    resolve: (ctx: SpellContext) => {
        // CR 608.2b: re-validate each target on resolution. A target that's
        // no longer a Mountain on the battlefield is silently skipped.
        const mountainIds = new Set<string>();
        ctx.forEachPlayer((playerId) => {
            for (const id of ctx.getBattlefieldIds(playerId, {
                subtypes: "Mountain",
            })) {
                mountainIds.add(id);
            }
        });
        let destroyed = 0;
        for (const target of ctx.targets) {
            if (target.type !== "permanent") continue;
            if (!mountainIds.has(target.id)) continue;
            // CR 614.5 — destroy reports actual graveyard movement.
            if (ctx.destroy(target)) destroyed++;
        }
        if (destroyed === 0) return;
        ctx.dealDamageToEach(destroyed, {
            creatures: true,
            players: true,
        });
    },
};

export const wallOfAir: CardDefinition = {
    id: "da56fdf3-6a8f-4833-a5c3-197650cc4889",
    rarity: "uncommon",
    name: "Wall of Air",
    oracleText:
        "Defender, flying (This creature can't attack, and it can block creatures with flying.)",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 5,
    staticAbilities: ["defender", "flying"],
};

// Wall of Water — defender + "{U}: This creature gets +1/+0 until end of turn."
// (CR 702.3 defender, 611.1 temp P/T mod).
export const wallOfWater: CardDefinition = {
    id: "41faed1a-ded8-49ee-8e2a-c60d377775d7",
    rarity: "uncommon",
    name: "Wall of Water",
    oracleText:
        "Defender (This creature can't attack.)\n{U}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 5,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-water-pump",
            oracleText: "{U}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
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

export const waterElemental: CardDefinition = {
    id: "8de940d6-98c0-46a9-b5fd-e2b0899ea19e",
    rarity: "uncommon",
    name: "Water Elemental",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 5,
    toughness: 4,
};

// Camouflage — pile combat (CR 509 variant, the RANDOM twin of Raging River,
// ADR 0012). Cast only during the controller's declare-attackers step (the
// attackers are already declared). On resolve it REPLACES the defending
// player's declare-blockers step for this combat: the defender divides any
// number of their creatures into N piles (N = number of attackers; piles can
// be empty), the engine assigns each pile to a DIFFERENT attacker at random
// (seeded PRNG — deterministic for replay), and each creature in a pile that
// can legally block its assigned attacker is forced to do so.
//
// The N-pile division reuses the existing `partition` choice kind (ADR 0012)
// rather than a Camouflage-specific kind: it is collected as up to N sequential
// subset picks, each from the still-unassigned creatures (the per-pile
// `candidateIds` allow-list shrinks as creatures are placed). The random
// assignment + forced legal blocks are applied by
// `ctx.applyCamouflagePileBlocks` once every pile has been chosen. Single
// defending player, matching the rest of combat.
export const camouflage: CardDefinition = {
    id: "3838c2a3-7fab-4976-9c1b-2891aee24e52",
    rarity: "uncommon",
    name: "Camouflage",
    oracleText:
        "Cast this spell only during your declare attackers step.\nThis turn, instead of declaring blockers, each defending player chooses any number of creatures they control and divides them into a number of piles equal to the number of attacking creatures for whom that player is the defending player. Creatures those players control that can block additional creatures may likewise be put into additional piles. Assign each pile to a different one of those attacking creatures at random. Each creature in a pile that can block the creature that pile is assigned to does so. (Piles can be empty.)",
    manaCost: { G: 1 },
    types: ["Instant"],
    // CR 117.1b — castable only during the controller's declare-attackers step.
    castPhaseRestriction: ["DECLARE_ATTACKERS"],
    castTurnRestriction: "self",
    resolve: (ctx: SpellContext) => {
        const attackerIds = ctx.getBattlefieldIds(ctx.controller, {
            types: "Creature",
            isAttacking: true,
        });
        const pileCount = attackerIds.length;
        if (pileCount === 0) return; // no attackers ⇒ nothing to replace.

        const defenderId = ctx.allPlayerIds.find((p) => p !== ctx.controller);
        if (!defenderId) return;

        // Collect the defender's division into up to N piles. Each pile is a
        // subset pick (the `partition` kind) from the creatures not yet placed
        // in an earlier pile; leftover (unpicked) creatures simply don't block.
        const piles: string[][] = [];
        const assigned = new Set<string>();
        for (let pileIndex = 0; pileIndex < pileCount; pileIndex++) {
            const remaining = ctx
                .getBattlefieldIds(defenderId, { types: "Creature" })
                .filter((id) => !assigned.has(id));
            // No creatures left to place ⇒ the rest of the piles are empty.
            if (remaining.length === 0) {
                piles.push([]);
                continue;
            }
            const pick = ctx.requestChoice({
                playerId: defenderId,
                choiceId: `camouflage-pile-${pileIndex}`,
                kind: "partition",
                zone: "battlefield",
                zoneOwnerId: defenderId,
                filter: { types: "Creature" },
                candidateIds: remaining,
                count: { min: 0, max: remaining.length },
                prompt: `Camouflage — choose the creatures for pile ${pileIndex + 1} of ${pileCount} (the rest stay back or go in a later pile).`,
            });
            if (pick === undefined) return; // suspended — resumes on submit.
            for (const id of pick) assigned.add(id);
            piles.push(pick);
        }

        // Random pile→attacker assignment + forced legal blocks (CR 509.1).
        ctx.applyCamouflagePileBlocks(defenderId, piles);
    },
};

// Mana Short — {2}{U} Instant. "Tap all lands target player controls. That
// player loses all unspent mana." (CR 106.4)
export const manaShort: CardDefinition = {
    id: "73e3e0b3-5284-464f-8c62-0f7801c966f5",
    rarity: "rare",
    name: "Mana Short",
    oracleText:
        "Tap all lands target player controls. That player loses all unspent mana.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const targetPlayerId = ctx.targets[0].id;
        ctx.tapAllLands(targetPlayerId);
        ctx.drainManaPool(targetPlayerId);
    },
};

// Drain Power — {U}{U} Sorcery. "Target player activates a mana ability of
// each land they control. Then that player loses all unspent mana and you add
// the mana lost this way." Simplified model: tap all target's lands, drain
// their pool, add drained mana to caster. (CR 106.4)
export const drainPower: CardDefinition = {
    id: "ea3830c5-cc66-453e-9e53-0636e00ee0ee",
    rarity: "rare",
    name: "Drain Power",
    oracleText:
        "Target player activates a mana ability of each land they control. Then that player loses all unspent mana and you add the mana lost this way.",
    manaCost: { U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const targetPlayerId = ctx.targets[0].id;
        ctx.tapAllLands(targetPlayerId);
        const drained = ctx.drainManaPool(targetPlayerId);
        ctx.addManaTo(ctx.controller, drained);
    },
};
