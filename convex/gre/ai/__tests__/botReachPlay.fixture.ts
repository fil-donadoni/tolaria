// Fixtures shared by the Bot-play sweep's evidence files (ADR 0105 § 7.2,
// issue #6148): the posed card definitions and position helpers, hoisted out
// of the one file that held them so each `botReach*Play*` part imports only
// what it uses. Pure data and pure functions — no module state.

import { getCardByName } from "../../../cards";
import type {
    CardDefinition,
    CardType,
    EffectSignedValue,
} from "../../../cards/types";
import { buildBotReachState } from "../botReach";

/** CR 601.2 — a spell whose resolution changes nothing: legal, affordable,
 *  and never worth the mana. */
export const NO_OP_SORCERY: CardDefinition = {
    id: "bot-reach-test:no-op",
    name: "Bot Reach No-Op",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [],
};

/** CR 119.3 — a spell whose only effect is that its caster loses life: it
 *  changes the position (so dominance cannot prune it) and never for the
 *  better, so the search weighs it and passes it over (issue #4179). */
export const SELF_DRAIN_SORCERY: CardDefinition = {
    id: "bot-reach-test:self-drain",
    name: "Bot Reach Self Drain",
    rarity: "common",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    effects: [{ op: "loseLife", player: "controller", amount: 5 }],
};

/** CR 115.1 / 601.2c — a targeted spell with no legal target in the
 *  generated position (it seeds no planeswalker), so no cast move exists. */
export const UNTARGETABLE_INSTANT: CardDefinition = {
    id: "bot-reach-test:untargetable",
    name: "Bot Reach Untargetable",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Planeswalker", count: 1 },
    effects: [],
};

/** CR 115.1 — targets a SPELL, so its position needs one on the stack. */
export const COUNTER_INSTANT: CardDefinition = {
    id: "bot-reach-test:counter",
    name: "Bot Reach Counter",
    rarity: "common",
    manaCost: { U: 1, generic: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [{ op: "counter", target: { target: 0 } }],
};

/** CR 603.6a / 702.8a — a flash creature whose ENTERS trigger targets a spell:
 *  cast in response to one, so its position needs a spell on the stack. */
export const FLASH_ETB_COUNTER: CardDefinition = {
    id: "bot-reach-test:flash-etb-counter",
    name: "Bot Reach Flash Snake",
    rarity: "common",
    manaCost: { generic: 1, G: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Snake"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flash"],
    compiledTriggeredAbilities: [
        {
            id: "bot-reach-test:flash-etb-counter:trigger",
            oracleText: "When this creature enters, counter target spell.",
            head: { kind: "entered", scope: "self" },
            targetRequirement: { type: "spell", count: 1 },
            effects: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};

/** CR 702.10 — a 2/2 for three with printed haste. Into the generated
 *  position's untapped 2/2 the Bot passes it precombat and casts it postcombat. */
export const HASTE_CREATURE: CardDefinition = {
    id: "bot-reach-test:haste",
    name: "Bot Reach Hasty Bear",
    rarity: "common",
    manaCost: { generic: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    staticAbilities: ["haste"],
};

/** CR 613.1f / 702.10 — the same creature with its haste granted to ITSELF by
 *  a static keyword grant (the shape of Blur Sliver, Reflex Sliver, Goblin
 *  Warchief, Madrush Cyclops), not printed as a keyword. */
export const SELF_GRANTED_HASTE_CREATURE: CardDefinition = {
    id: "bot-reach-test:haste-grant",
    name: "Bot Reach Haste Granter",
    rarity: "common",
    manaCost: { generic: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    compiledStaticEffects: [
        {
            kind: "keyword-grant",
            filter: {
                types: ["Creature"],
                subtypes: ["Bear"],
                controllerRelation: "you",
            },
            keyword: "haste",
        },
    ],
};

/** CR 303.4 / 702.8a — a Flash Aura whose whole effect is a static grant to the
 *  creature it enchants, the shape the compiler emits (`appliesTo: "host"`, no
 *  Op). A body-less permanent the Bot holds at sorcery speed (`hold-trick`) and
 *  casts in the opponent's end step (issue #4260). */
export function flashAura(
    slug: string,
    grant: NonNullable<CardDefinition["compiledStaticEffects"]>
): CardDefinition {
    return {
        id: `bot-reach-test:flash-aura-${slug}`,
        name: `Bot Reach Flash Aura ${slug}`,
        rarity: "common",
        manaCost: { generic: 1, G: 1 },
        types: ["Enchantment"],
        subtypes: ["Aura"],
        staticAbilities: ["flash"],
        targetRequirement: { type: "Creature", count: 1 },
        compiledStaticEffects: grant,
    };
}

export const FLASH_AURA_DOUBLE_STRIKE = flashAura("double-strike", [
    { kind: "keyword-grant", appliesTo: "host", keyword: "double strike" },
]);
export const FLASH_AURA_SHROUD = flashAura("shroud", [
    { kind: "keyword-grant", appliesTo: "host", keyword: "shroud" },
]);
/** CR 701.21a — an edict: the TARGET player owes a mandatory
 *  `sacrifice-permanents` choice mid-resolution, so the follow-through must
 *  answer it and see the spell leave the stack (issue #4189). */
export const EDICT_INSTANT: CardDefinition = {
    id: "bot-reach-test:edict",
    name: "Bot Reach Edict",
    rarity: "common",
    manaCost: { B: 1, generic: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "choice",
            kind: "sacrifice-permanents",
            player: { target: 0 },
            zone: "battlefield",
            filter: { type: "Creature" },
            count: 1,
            prompt: "Sacrifice a creature.",
            bind: "$sacrifice1",
        },
        { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
    ],
};

/** CR 603.5 — a creature whose enters-the-battlefield trigger asks
 *  "you may return target creature card from your graveyard to your hand".
 *  Every step of its follow-through is a choice answer (issue #4189). */
export const RAISE_DEAD_CREATURE: CardDefinition = {
    id: "bot-reach-test:raise-dead",
    name: "Bot Reach Raise Dead",
    rarity: "common",
    manaCost: { B: 1, generic: 3 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
    compiledTriggeredAbilities: [
        {
            id: "bot-reach-raise-dead-trigger",
            oracleText:
                "When this creature enters, you may return target creature card from your graveyard to your hand.",
            head: { kind: "entered", scope: "self" },
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Return target creature card from your graveyard to your hand?",
                    bind: "$may1",
                },
                {
                    op: "if",
                    predicate: { binding: "$may1" },
                    then: [
                        {
                            op: "moveZone",
                            target: { target: 0 },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    ],
};

/** CR 121.1 — a plain draw spell: what it finds decides whether it is cast. */
export const DRAW_SORCERY: CardDefinition = {
    id: "bot-reach-test:draw",
    name: "Bot Reach Draw",
    rarity: "common",
    manaCost: { generic: 2, U: 2 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 3 }],
};

/** CR 121.1 / 601.2b — the same draw, paid for with a sacrificed creature. */
export const SACRIFICE_DRAW_SORCERY: CardDefinition = {
    ...DRAW_SORCERY,
    id: "bot-reach-test:sacrifice-draw",
    name: "Bot Reach Sacrifice Draw",
    manaCost: { generic: 1, B: 1 },
    additionalCosts: { sacrificeFilter: { types: ["Creature"] } },
    effects: [{ op: "draw", player: "controller", count: 2 }],
};

/** CR 700.2 — the draw lives in a mode, not in `effects`. */
export const MODAL_DRAW_SORCERY: CardDefinition = {
    ...DRAW_SORCERY,
    id: "bot-reach-test:modal-draw",
    name: "Bot Reach Modal Draw",
    effects: undefined,
    modes: [
        {
            id: "draw",
            label: "Draw three cards",
            oracleText: "Draw three cards.",
            effects: [{ op: "draw", player: "controller", count: 3 }],
        },
    ],
};

/** CR 121.1 — a draw aimed at the opponent: not the holder's to sweeten. */
export const OPPONENT_DRAW_SORCERY: CardDefinition = {
    ...DRAW_SORCERY,
    id: "bot-reach-test:opponent-draw",
    name: "Bot Reach Opponent Draw",
    effects: [{ op: "draw", player: "opponent", count: 3 }],
};

/** CR 702.33a (Kicker) / 603.6a — a mono-red creature whose enters trigger
 *  destroys the holder's OWN other creatures, and the OPPONENT's creatures
 *  instead when kicked with WHITE mana its printed cost never names. Unkicked
 *  it is strictly a loss in the generated position (two bodies for one), so
 *  it is cast only if the kicked branch is payable.
 *
 *  The kicked branch is one-sided since issue #4758. It used to destroy
 *  every other creature, which in the generated position (the same creatures
 *  on both sides) trades evenly — and once an ETB Ability counts only as
 *  potential in hand, an even trade is rightly worth less than holding the
 *  card. The claim here is reachability of the kicked branch, so its payoff
 *  has to be real. */
export const KICKED_SWEEP_CREATURE: CardDefinition = {
    id: "bot-reach-test:kicked-sweep",
    name: "Bot Reach Kicked Sweeper",
    rarity: "rare",
    manaCost: { generic: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 3,
    toughness: 3,
    kickers: [{ id: "kicker", description: "Kicker {W}{W}", mana: { W: 2 } }],
    compiledTriggeredAbilities: [
        {
            id: "bot-reach-test:kicked-sweep:trigger",
            oracleText:
                "When this creature enters, destroy all other creatures you control. If it was kicked, destroy all creatures your opponents control instead.",
            head: { kind: "entered", scope: "self" },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "opponent",
                                filter: { type: "Creature" },
                            },
                            effects: [
                                { op: "destroy", target: { ref: "$each" } },
                            ],
                        },
                    ],
                    else: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Creature" },
                                excludeSource: true,
                            },
                            effects: [
                                { op: "destroy", target: { ref: "$each" } },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

/** CR 603.6a / 603.3d (issue #4758) — a creature whose ETB Ability destroys
 *  target Wall (Ogre Gatecrasher's shape). The generated position seeds no
 *  Wall, so the ETB has nothing it may target and the Bot rightly holds the
 *  card: a limit of the position, never a Bot Gap. */
export const ETB_WALL_REMOVER: CardDefinition = {
    id: "bot-reach-test:etb-wall-remover",
    name: "Bot Reach ETB Wall Remover",
    rarity: "common",
    manaCost: { generic: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Monk"],
    power: 1,
    toughness: 1,
    compiledTriggeredAbilities: [
        {
            id: "bot-reach-test:etb-wall-remover:trigger",
            oracleText: "When this creature enters, destroy target Wall.",
            head: { kind: "entered", scope: "self" },
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Wall",
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

/** A creature whose ENTERS trigger destroys target creature with power 99 or
 *  more: no creature in the catalogue is one, so the position cannot pose a
 *  target and the ETB finds none, the way a card whose requirement nothing
 *  satisfies does (issue #4758). */
export const ETB_UNPOSABLE_REMOVER: CardDefinition = {
    ...ETB_WALL_REMOVER,
    id: "bot-reach-test:etb-unposable-remover",
    name: "Bot Reach ETB Unposable Remover",
    compiledTriggeredAbilities: [
        {
            id: "bot-reach-test:etb-unposable-remover:trigger",
            oracleText:
                "When this creature enters, destroy target creature with power 99 or greater.",
            head: { kind: "entered", scope: "self" },
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { min: 99 },
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

/** A creature whose ENTERS trigger reveals the top four cards of its
 *  controller's library and puts every Goblin among them into hand (Goblin
 *  Ringleader's shape). A library of basic lands holds nothing to find, so
 *  the trigger is worth nothing and the Bot rightly holds the card: a limit
 *  of the position, never a Bot Gap (issue #4904). */
export const ETB_GOBLIN_LOOKER: CardDefinition = {
    ...ETB_WALL_REMOVER,
    id: "bot-reach-test:etb-goblin-looker",
    name: "Bot Reach ETB Goblin Looker",
    subtypes: ["Goblin"],
    compiledTriggeredAbilities: [
        {
            id: "bot-reach-test:etb-goblin-looker:trigger",
            oracleText:
                "When this creature enters, reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.",
            head: { kind: "entered", scope: "self" },
            effects: [
                {
                    op: "lookDistribute",
                    player: "controller",
                    look: 4,
                    take: 4,
                    keepTo: "hand",
                    filter: { subtype: "Goblin" },
                    optional: false,
                    reveal: "window",
                },
            ],
        },
    ],
};

/** A creature whose ENTERS trigger makes a target player discard at random
 *  (Sanity Gnawers' shape). An opponent holding lands gives the discard
 *  nothing to take, so the Bot holds the card: a limit of the position, never
 *  a Bot Gap (issue #4904). */
export const ETB_DISCARDER: CardDefinition = {
    ...ETB_WALL_REMOVER,
    id: "bot-reach-test:etb-discarder",
    name: "Bot Reach ETB Discarder",
    manaCost: { generic: 1, B: 1, R: 1 },
    subtypes: ["Rat"],
    power: 1,
    toughness: 1,
    compiledTriggeredAbilities: [
        {
            id: "bot-reach-test:etb-discarder:trigger",
            oracleText:
                "When this creature enters, target player discards a card at random.",
            head: { kind: "entered", scope: "self" },
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    op: "discardAtRandom",
                    player: { target: 0 },
                    count: 1,
                },
            ],
        },
    ],
};

export type Kind = "Creature" | "Artifact" | "Enchantment" | "Land";
/** Opponent's count of `kind` minus the holder's, in the generated
 *  position of `def` at `seat`. */
export const ahead = (def: CardDefinition, seat: 0 | 1, kind: Kind): number => {
    const { state, holderId } = buildBotReachState(def, seat);
    const count = (own: boolean) =>
        state.players
            .find((p) => (p.id === holderId) === own)!
            .battlefield.filter((c) => c.types.includes(kind)).length;
    return count(false) - count(true);
};
export const forEachDestroy = (
    id: string,
    select: Record<string, unknown>
): CardDefinition => ({
    id: `bot-reach-test:${id}`,
    name: `Bot Reach ${id}`,
    rarity: "common",
    manaCost: { W: 1, generic: 3 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "permanents", zone: "battlefield", ...select },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
});

export const forEachPump = (
    id: string,
    select: Record<string, unknown>,
    power: EffectSignedValue,
    toughness: EffectSignedValue
): CardDefinition => ({
    id: `bot-reach-test:${id}`,
    name: `Bot Reach ${id}`,
    rarity: "common",
    manaCost: { B: 1, generic: 3 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
                ...select,
            },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$each" },
                    power,
                    toughness,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
});
export const castleCount = (def: CardDefinition, seat: 0 | 1): number =>
    buildBotReachState(def, seat).state.players.reduce(
        (n, p) =>
            n +
            p.battlefield.filter(
                (c) => c.card.id === getCardByName("Castle").id
            ).length,
        0
    );

/** CR 120.3e — a sorcery dealing 1 damage to each creature `select` names. */
export const forEachDamage = (
    id: string,
    select: Record<string, unknown>
): CardDefinition => ({
    id: `bot-reach-test:${id}`,
    name: `Bot Reach ${id}`,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                ...select,
            },
            effects: [{ op: "dealDamage", amount: 1, to: { ref: "$each" } }],
        },
    ],
});

/** CR 602.2 / 120.3e — a creature whose activated ability deals 1 damage
 *  to each creature, behind `cost`. */
export const creatureWithSweep = (
    id: string,
    cost: Record<string, unknown>
): CardDefinition => ({
    id: `bot-reach-test:${id}`,
    name: `Bot Reach ${id}`,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: `${id}-ability`,
            oracleText: "Sweep.",
            cost: { mana: { R: 1 }, ...cost },
            useStack: true,
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
                            op: "dealDamage",
                            amount: 1,
                            to: { ref: "$each" },
                        },
                    ],
                },
            ],
        },
    ],
});

/** CR 701.21 — an "each player sacrifices" edict of `filter`. */
export const eachPlayerSacrifices = (
    id: string,
    filter: Record<string, unknown>
): CardDefinition => ({
    id: `bot-reach-test:${id}`,
    name: `Bot Reach ${id}`,
    rarity: "common",
    manaCost: { B: 1, generic: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            simultaneous: true,
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$each" },
                    zone: "battlefield",
                    filter,
                    count: 1,
                    prompt: "Sacrifice one.",
                    bind: "$sacrifice1",
                },
                { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
            ],
        },
    ],
});
export const ownersOf = (
    def: CardDefinition,
    seat: 0 | 1,
    kind: CardType
): { holder: number; opponent: number } => {
    const { state, holderId } = buildBotReachState(def, seat);
    const count = (own: boolean): number =>
        state.players
            .find((p) => (p.id === holderId) === own)!
            .battlefield.filter((c) => c.types.includes(kind)).length;
    return { holder: count(true), opponent: count(false) };
};
