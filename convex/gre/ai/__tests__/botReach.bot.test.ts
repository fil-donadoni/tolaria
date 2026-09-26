// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — one fixture per outcome on
// the generated position, each run twice to pin determinism. The sweep itself
// runs over the whole `ready` set in `oracle:compile`; this file is the
// evidence that its three verdicts mean what the lockfile says they mean.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import type {
    CardDefinition,
    CardType,
    EffectSignedValue,
} from "../../../cards/types";
import { decidingPlayer } from "../../search";
import { enumerateMoves } from "../../moves";
import { flashAmbushPosition } from "../botReachTarget";
import {
    OPPONENT_END_STEP_WINDOW,
    REACH_WINDOWS,
    botReachSpec,
    buildBotReachState,
    castShape,
    classifyNoMove,
    playBotReach,
    playBotReachSeats,
    type BotReachVerdict,
} from "../botReach";

/** Twice, and the two verdicts must agree — the blade determinism contract. */
function playTwice(def: CardDefinition): BotReachVerdict {
    const first = playBotReach(def);
    expect(playBotReach(def)).toEqual(first);
    return first;
}

/** CR 601.2 — a spell whose resolution changes nothing: legal, affordable,
 *  and never worth the mana. */
const NO_OP_SORCERY: CardDefinition = {
    id: "bot-reach-test:no-op",
    name: "Bot Reach No-Op",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [],
};

/** CR 115.1 / 601.2c — a targeted spell with no legal target in the
 *  generated position (it seeds no planeswalker), so no cast move exists. */
const UNTARGETABLE_INSTANT: CardDefinition = {
    id: "bot-reach-test:untargetable",
    name: "Bot Reach Untargetable",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Planeswalker", count: 1 },
    effects: [],
};

/** CR 115.1 — targets a SPELL, so its position needs one on the stack. */
const COUNTER_INSTANT: CardDefinition = {
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
const FLASH_ETB_COUNTER: CardDefinition = {
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
const HASTE_CREATURE: CardDefinition = {
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
const SELF_GRANTED_HASTE_CREATURE: CardDefinition = {
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
function flashAura(
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

const FLASH_AURA_DOUBLE_STRIKE = flashAura("double-strike", [
    { kind: "keyword-grant", appliesTo: "host", keyword: "double strike" },
]);
const FLASH_AURA_SHROUD = flashAura("shroud", [
    { kind: "keyword-grant", appliesTo: "host", keyword: "shroud" },
]);
/** CR 701.21a — an edict: the TARGET player owes a mandatory
 *  `sacrifice-permanents` choice mid-resolution, so the follow-through must
 *  answer it and see the spell leave the stack (issue #4189). */
const EDICT_INSTANT: CardDefinition = {
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
const RAISE_DEAD_CREATURE: CardDefinition = {
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
const DRAW_SORCERY: CardDefinition = {
    id: "bot-reach-test:draw",
    name: "Bot Reach Draw",
    rarity: "common",
    manaCost: { generic: 2, U: 2 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 3 }],
};

/** CR 121.1 / 601.2b — the same draw, paid for with a sacrificed creature. */
const SACRIFICE_DRAW_SORCERY: CardDefinition = {
    ...DRAW_SORCERY,
    id: "bot-reach-test:sacrifice-draw",
    name: "Bot Reach Sacrifice Draw",
    manaCost: { generic: 1, B: 1 },
    additionalCosts: { sacrificeFilter: { types: ["Creature"] } },
    effects: [{ op: "draw", player: "controller", count: 2 }],
};

/** CR 700.2 — the draw lives in a mode, not in `effects`. */
const MODAL_DRAW_SORCERY: CardDefinition = {
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
const OPPONENT_DRAW_SORCERY: CardDefinition = {
    ...DRAW_SORCERY,
    id: "bot-reach-test:opponent-draw",
    name: "Bot Reach Opponent Draw",
    effects: [{ op: "draw", player: "opponent", count: 3 }],
};

/** CR 702.33a (Kicker) / 603.6a — a mono-red creature whose enters trigger
 *  destroys the holder's OWN other creatures, and every player's other creatures instead
 *  when kicked with WHITE mana its printed cost never names. Unkicked it is
 *  strictly a loss in the generated position (two bodies for one), so it is
 *  cast only if the kicked branch is payable. */
const KICKED_SWEEP_CREATURE: CardDefinition = {
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
                "When this creature enters, destroy all other creatures you control. If it was kicked, destroy all other creatures instead.",
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
                                filter: { type: "Creature" },
                                excludeSource: true,
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

describe("Bot-play sweep (ADR 0105 § 7.2)", () => {
    it("played — the Bot casts an affordable creature at both seats", () => {
        expect(playTwice(getCardByName("Grizzly Bears"))).toEqual({
            outcome: "played",
        });
    });

    it("played — the follow-through answers a targeted spell's inputs", () => {
        expect(playTwice(getCardByName("Lightning Bolt")).outcome).toBe(
            "played"
        );
    });

    // Issue #4189: the follow-through applied each answer with the greedy 1-ply
    // sandbox, which leaves a `resolution-choice` as a no-op, so the answered
    // choice stayed pending and the sweep read the harness's own stall as a
    // Bot Gap (`no-progress › follow-through`) on 24 cards.
    it("played — an edict's mandatory sacrifice choice is answered and settles", () => {
        withTemporaryDefinition(EDICT_INSTANT, () => {
            expect(playTwice(EDICT_INSTANT)).toEqual({ outcome: "played" });
        });
    });

    it("played — an enters-trigger 'you may return' settles through its choices", () => {
        withTemporaryDefinition(RAISE_DEAD_CREATURE, () => {
            expect(playTwice(RAISE_DEAD_CREATURE)).toEqual({
                outcome: "played",
            });
        });
    });

    // Issue #4260: the Bot holds a Flash permanent it could cast at sorcery
    // speed (`hold-trick`, issue #2248) and casts it at instant speed, a window
    // the sweep never posed — 13 Flash Auras read as `never-chosen`. Each of
    // the two grants below is chosen in the opponent's end step and in
    // neither main phase, so the verdict rides on that window alone.
    for (const aura of [FLASH_AURA_DOUBLE_STRIKE, FLASH_AURA_SHROUD]) {
        it(`played — ${aura.name} cast in the opponent's end step`, () => {
            withTemporaryDefinition(aura, () => {
                expect(playTwice(aura)).toEqual({ outcome: "played" });
            });
        });
    }

    it("the opponent's end-step window: opponent active, holder holds priority", () => {
        withTemporaryDefinition(FLASH_AURA_SHROUD, () => {
            const posed = buildBotReachState(
                FLASH_AURA_SHROUD,
                0,
                OPPONENT_END_STEP_WINDOW
            );
            expect(posed.state.phase).toBe("END_STEP");
            expect(posed.state.activePlayerId).not.toBe(posed.holderId);
            expect(decidingPlayer(posed.state)).toBe(posed.holderId);
        });
        expect(botReachSpec(HASTE_CREATURE).activePlayer).toBe("me");
    });

    it("ignored — a legal, affordable no-op is never chosen, and ships", () => {
        withTemporaryDefinition(NO_OP_SORCERY, () => {
            expect(playTwice(NO_OP_SORCERY)).toEqual({
                outcome: "ignored",
                cause: "never-chosen",
                form: "Sorcery",
            });
        });
    });

    // Issue #4069 (and its twin Bot Gap `Creature [haste]`): into an untapped
    // blocker the first main phase's `pass` beats the cast on every seed, and
    // the Bot casts the creature in the second. A sweep that posed only the
    // first window read that hold as a refusal.
    it("played — a printed-haste creature the Bot holds past combat", () => {
        withTemporaryDefinition(HASTE_CREATURE, () => {
            expect(playTwice(HASTE_CREATURE)).toEqual({ outcome: "played" });
        });
    });

    it("played — a creature granted haste by a static effect, held past combat", () => {
        withTemporaryDefinition(SELF_GRANTED_HASTE_CREATURE, () => {
            expect(playTwice(SELF_GRANTED_HASTE_CREATURE)).toEqual({
                outcome: "played",
            });
        });
    });

    it("the second window is the same turn's post-combat main phase", () => {
        withTemporaryDefinition(HASTE_CREATURE, () => {
            for (const window of REACH_WINDOWS) {
                expect(botReachSpec(HASTE_CREATURE, window).phase).toBe(window);
                for (const seat of [0, 1] as const) {
                    const { state, holderId } = buildBotReachState(
                        HASTE_CREATURE,
                        seat,
                        window
                    );
                    expect(state.phase).toBe(window);
                    expect(decidingPlayer(state)).toBe(holderId);
                }
            }
        });
    });

    it("position-unmodelled — the position cannot pose the card, so it ships", () => {
        withTemporaryDefinition(UNTARGETABLE_INSTANT, () => {
            expect(playTwice(UNTARGETABLE_INSTANT)).toEqual({
                outcome: "ignored",
                cause: "position-unmodelled",
                form: "Instant target:Planeswalker",
            });
        });
    });

    it("played — a destroying sweep of every battlefield is posed with the opponent ahead", () => {
        // Issue #4157. A symmetric wipe on a symmetric board is CORRECT to
        // pass on (it costs the card and destroys as much of the holder's as
        // of the opponent's), so the generated position gives the opponent a
        // surplus of whatever the card destroys: creatures, enchantments,
        // lands.
        for (const name of [
            "Day of Judgment",
            "Tranquility",
            "Armageddon",
        ] as const) {
            expect(playTwice(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
        }
    });

    type Kind = "Creature" | "Artifact" | "Enchantment" | "Land";
    /** Opponent's count of `kind` minus the holder's, in the generated
     *  position of `def` at `seat`. */
    const ahead = (def: CardDefinition, seat: 0 | 1, kind: Kind): number => {
        const { state, holderId } = buildBotReachState(def, seat);
        const count = (own: boolean) =>
            state.players
                .find((p) => (p.id === holderId) === own)!
                .battlefield.filter((c) => c.types.includes(kind)).length;
        return count(false) - count(true);
    };
    const forEachDestroy = (
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

    const forEachPump = (
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
    const castleCount = (def: CardDefinition, seat: 0 | 1): number =>
        buildBotReachState(def, seat).state.players.reduce(
            (n, p) =>
                n +
                p.battlefield.filter(
                    (c) => c.card.id === getCardByName("Castle").id
                ).length,
            0
        );

    it("a toughness shrink's position puts the opponent ahead in bodies that die to it, with no Castle to prop them up", () => {
        for (const def of [
            getCardByName("Infest"),
            getCardByName("Languish"),
            forEachPump("shrink-neg", {}, 0, {
                negate: { domain: { of: "controller" } },
            }),
        ])
            withTemporaryDefinition(def, () => {
                for (const seat of [0, 1] as const) {
                    expect(
                        ahead(def, seat, "Creature"),
                        def.name
                    ).toBeGreaterThan(0);
                    expect(castleCount(def, seat), def.name).toBe(0);
                }
            });
    });

    it("a pump of the holder's own creatures puts the holder ahead in bodies", () => {
        const charge = getCardByName("Desperate Charge");
        for (const seat of [0, 1] as const) {
            expect(ahead(charge, seat, "Creature")).toBeLessThan(0);
            // Not a shrink: the Castle stays where it was.
            expect(castleCount(charge, seat)).toBe(2);
        }
    });

    it("played — a mass shrink and a mass pump are cast where they win", () => {
        for (const name of [
            "Infest",
            "Nausea",
            "Shrivel",
            "Planar Despair",
            "Rollick of Abandon",
            "Final Revels",
            "Desperate Charge",
        ] as const)
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
    }, 300_000);

    /** CR 701.21 — an "each player sacrifices" edict of `filter`. */
    const eachPlayerSacrifices = (
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
    const ownersOf = (
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

    it("a symmetric edict's position leaves the holder nothing of the edicted type and the opponent bodies to lose", () => {
        for (const [name, kind] of [
            ["Barter in Blood", "Creature"],
            ["Simplify", "Enchantment"],
        ] as const)
            for (const seat of [0, 1] as const) {
                const { holder, opponent } = ownersOf(
                    getCardByName(name),
                    seat,
                    kind
                );
                expect(holder, name).toBe(0);
                expect(opponent, name).toBeGreaterThan(0);
            }
    });

    it("no claim is made where the edict is not a plain type filter", () => {
        // A subtype-filtered edict is not read: the level pose stays.
        const def = eachPlayerSacrifices("edict-subtype", {
            type: "Creature",
            subtype: "Goblin",
        });
        expect(ownersOf(def, 0, "Creature").holder).toBe(2);
    });

    it("played — a symmetric edict is cast where the opponent loses more", () => {
        for (const name of [
            "Barter in Blood",
            "Crack the Earth",
            "Simplify",
        ] as const)
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
    }, 300_000);

    it("a destroying sweep's position puts the opponent ahead in the swept type, the holder ahead in bodies", () => {
        for (const seat of [0, 1] as const) {
            const wrath = getCardByName("Day of Judgment");
            expect(ahead(wrath, seat, "Creature")).toBeGreaterThan(0);
            expect(ahead(wrath, seat, "Enchantment")).toBe(0);
            const tranquility = getCardByName("Tranquility");
            expect(ahead(tranquility, seat, "Enchantment")).toBeGreaterThan(0);
            // What the sweep leaves standing is the holder's.
            expect(ahead(tranquility, seat, "Creature")).toBeLessThan(0);
            const armageddon = getCardByName("Armageddon");
            expect(ahead(armageddon, seat, "Land")).toBeGreaterThan(0);
            expect(ahead(armageddon, seat, "Creature")).toBeLessThan(0);
        }
    });

    it("no claim is made where the sweep does not destroy what the pose would hand over", () => {
        // Each of these selects every player's battlefield or looks like a
        // sweep, and each must keep the SYMMETRIC pose: a buff or a shrink is
        // not a loss for the opponent, a filter on anything but `type` is not
        // read, and `controller` scopes the sweep to one side.
        const symmetric: CardDefinition[] = [
            getCardByName("Grizzly Bears"),
            forEachPump("buff-all", {}, 2, 0), // +2/+0 to every creature
            forEachPump("shrink-power", {}, -2, 0), // -2/-0 kills nothing
            forEachPump("shrink-own", { controller: "controller" }, 0, -2),
            forEachPump(
                "shrink-subtype",
                { filter: { subtype: "Goblin" } },
                0,
                -2
            ),
            forEachDestroy("subtype-only", {
                filter: { subtype: "Goblin" },
            }),
            forEachDestroy("excludes-land", {
                filter: { excludeType: "Land" },
            }),
            forEachDestroy("own-only", {
                controller: "controller",
                filter: { type: "Creature" },
            }),
        ];
        for (const def of symmetric)
            withTemporaryDefinition(def, () => {
                for (const seat of [0, 1] as const) {
                    for (const kind of [
                        "Creature",
                        "Artifact",
                        "Enchantment",
                    ] as const)
                        expect(ahead(def, seat, kind), def.name).toBe(0);
                    // The holder's lands are the card's cost, so it always has
                    // more of them; the pose only ever ADDS to the opponent's.
                    expect(ahead(def, seat, "Land"), def.name).toBeLessThan(0);
                }
            });
    });

    it("a sweep with no filter destroys every type, so every type is posed", () => {
        const all = forEachDestroy("unfiltered", {});
        withTemporaryDefinition(all, () => {
            for (const seat of [0, 1] as const) {
                expect(ahead(all, seat, "Creature")).toBeGreaterThan(0);
                expect(ahead(all, seat, "Enchantment")).toBeGreaterThan(0);
                expect(ahead(all, seat, "Land")).toBeGreaterThan(0);
            }
        });
    });

    // Issue #4266: the generated library was basic lands, so what a draw
    // spell found was worth nothing and `pass` beat the cast on every seed.
    it("played — a draw spell the Bot casts once its library holds spells", () => {
        for (const def of [DRAW_SORCERY, SACRIFICE_DRAW_SORCERY]) {
            withTemporaryDefinition(def, () => {
                expect(playTwice(def)).toEqual({ outcome: "played" });
            });
        }
    }, 300_000);

    // Issue #4267: a pump aimed at a creature that also draws is worth the
    // trick AND the cards it finds; each half was posed by its own slice
    // (issue #4264, issue #4266) and the composition is what the sweep plays.
    it("played — an instant that pumps a target creature and draws", () => {
        for (const name of [
            "Aggressive Urge",
            "Defiant Strike",
            "Rebellious Strike",
            "Sudden Strength",
            "Sugar Rush",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4268: a modal instant whose modes name a colour-filtered
    // permanent and a subtype-filtered land is posed against an opponent
    // permanent of that colour / a land of that subtype.
    it("played — a modal instant destroying a coloured permanent or bouncing a subtype land", () => {
        for (const name of ["Active Volcano", "Flash Flood"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4269: an instant that draws and grants an ability to a target
    // creature; both halves are posed by their own slices, the sweep plays the
    // composition.
    it("played — an instant that grants an ability to a target creature and draws", () => {
        for (const name of [
            "Accelerate",
            "Bladebrand",
            "Charge Through",
            "Expedite",
            "Lace with Moonglove",
            "Poison the Blade",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4270: a sorcery pump pays only in the attack the same main phase
    // goes on to make, so the sweep poses the race it decides (`sorceryPumpRace`).
    it("played — a sorcery that pumps a target creature", () => {
        for (const name of [
            "Feral Roar",
            "Howling Fury",
            "Monstrous Growth",
            "Phytoburst",
            "Wielding the Green Dragon",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4271: a creature whose only ability sacrifices a body to grow
    // ITSELF is played — the sacrifice children below its own cast edge are
    // pruned (`isSourceConfinedSacrificeConversion`), so they no longer outweigh `pass`.
    it("played — a creature that sacrifices a creature to grow itself", () => {
        for (const name of [
            "Bloodflow Connoisseur",
            "Defiant Salvager",
            "Phyrexian Broodlings",
            "Scarland Thrinax",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4272: a creature whose only ability sacrifices a permanent to
    // remove an announced target is played — the exchange children below its
    // own cast edge are pruned (`isRemovalExchangeSacrifice`).
    it("played — a creature that sacrifices a permanent to remove a target", () => {
        for (const name of [
            "Arms Dealer",
            "Bloodpyre Elemental",
            "Frostling",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4273: an instant whose only effect grants an ability to a target
    // creature; the race it decides is posed by the sweep's positions.
    it("played — an instant that grants an ability to a target creature", () => {
        for (const name of [
            "Defy Gravity",
            "Double Cleave",
            "Unnatural Speed",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // The gain-life sorcery pays only when life is scarce, so the sweep poses
    // the holder one point from dead against an attacker (`sorceryLifeGainRace`).
    it("played — a sorcery that only gains its controller life", () => {
        for (const name of [
            "Bountiful Harvest",
            "Gerrard's Wisdom",
            "Presence of the Wise",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4275: a flier whose only ability sacrifices a creature for a
    // transient pump of ITSELF is played. Its sacrifice variants are kept out
    // of the rollout's random draw (`isTransientSacrificeConversion`) and out
    // of the tree below the cast (`isDeferrableTransientSacrifice`, issue
    // #4261), so they no longer drag the cast edge under `pass`.
    it("played — a flier that sacrifices a creature to pump itself", () => {
        for (const name of ["Devouring Swarm", "Fallen Angel"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4276: a creature whose only ability sacrifices a creature to make
    // a target player discard is played — the exchange children below its own
    // cast edge are pruned (`isDiscardExchangeSacrifice`).
    it("played — a creature that sacrifices a creature to make a player discard", () => {
        for (const name of ["Nezumi Bone-Reader", "Sadistic Hypnotist"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4277: a creature whose only ability sacrifices a permanent to
    // drain a target player is played — the exchange children below its own
    // cast edge are pruned (`isDrainExchangeSacrifice`).
    it("played — a creature that sacrifices a permanent to drain a player", () => {
        for (const name of ["Cabal Archon", "Death Cultist"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4279: a creature whose only ability sacrifices it to make a
    // player draw is played — the exchange children below its own cast edge
    // are pruned (`isDrawExchangeSacrifice`).
    it("played — a creature that sacrifices itself to draw a card", () => {
        expect(playBotReachSeats(getCardByName("Limestone Golem"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4288: "untap target permanent" has nothing to do on a board of
    // untapped permanents, so passing was right and the verdict read
    // `never-chosen`. The position gives the holder a tapped body to untap
    // (CR 701.26b), and the Bot then casts it.
    it("played — an untap spell aimed at a tapped permanent of its own", () => {
        expect(playBotReachSeats(getCardByName("Burst of Energy"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4287: the same exchange behind a creature that also carries a
    // dies trigger (a pump on a target) — the trigger does not turn the
    // sacrifice-for-draw outlet into a scored sacrifice below the cast edge.
    it("played — a sacrifice-for-draw creature with a dies-pump trigger", () => {
        expect(playBotReachSeats(getCardByName("Marker Beetles"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4280: a creature with flash is posed once more, against an
    // attacker only it can block (`flashAmbushPosition`) — in a main phase
    // holding it and casting it are one play a turn apart.
    it("played — a flash creature, posed against an attacker", () => {
        expect(playBotReachSeats(getCardByName("Benalish Knight"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4281: haste rides the same window — a flash creature with haste is
    // still cast to block, so the ambush position covers it unchanged.
    it("played — a flash creature with haste, posed against an attacker", () => {
        const kavu = getCardByName("Raging Kavu");
        expect(flashAmbushPosition(kavu)).not.toBeNull();
        expect(playBotReachSeats(kavu)).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    it("only a targetless creature with flash is posed against an attacker", () => {
        expect(flashAmbushPosition(getCardByName("Benalish Knight"))).toEqual(
            expect.objectContaining({
                phase: "DECLARE_ATTACKERS",
                activePlayer: "opp",
                priority: "me",
            })
        );
        // No flash, no ambush; a flash spell is not a creature.
        expect(flashAmbushPosition(getCardByName("Serra Angel"))).toBeNull();
        expect(flashAmbushPosition(COUNTER_INSTANT)).toBeNull();
        // Its enters-trigger's target is a targetRequirement of the trigger,
        // not the card, so the flash snake is posed too.
        expect(flashAmbushPosition(FLASH_ETB_COUNTER)).not.toBeNull();
    });

    // Issue #4283: the same sacrifice-to-draw creature, with flying — the
    // evasion body must not change the verdict.
    it("played — a flying creature that sacrifices itself to draw a card", () => {
        expect(playBotReachSeats(getCardByName("Slinking Skirge"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4278: a spell that makes the opponent discard is posed against a
    // hand worth taking (`discardsFromTarget`) — an empty or opaque one takes
    // nothing, so the Bot rightly passed. Tendrils of Despair pays a creature
    // for the two cards, so it is the hard case.
    it("played — a spell that makes the opponent discard", () => {
        for (const name of ["Deception", "Tendrils of Despair"]) {
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
        }
    }, 600_000);

    it("a discard is sweetened only when it is aimed at a target player", () => {
        const opponentCards = (name: string) => {
            const spec = botReachSpec(getCardByName(name));
            return {
                hand: spec.hiddenHand?.opp,
                library: (spec.cards ?? []).filter(
                    (c) => c.owner === "opp" && c.zone === "library"
                ).length,
            };
        };
        expect(opponentCards("Deception")).toEqual({ hand: 3, library: 1 });
        for (const name of ["Faithless Looting", "Wheel of Fortune"])
            expect(opponentCards(name), name).toEqual({
                hand: undefined,
                library: 0,
            });
    });

    it("a draw spell's holder finds spells on top of the library, and only that holder", () => {
        const topOfLibrary = (def: CardDefinition, seat: 0 | 1): unknown => {
            const { state, holderId } = buildBotReachState(def, seat);
            const holder = state.players.find((p) => p.id === holderId)!;
            return holder.library[0]!.card.id;
        };
        const spell = getCardByName("Serra Angel").id;
        const land = getCardByName("Plains").id;
        for (const seat of [0, 1] as const) {
            withTemporaryDefinition(DRAW_SORCERY, () => {
                expect(topOfLibrary(DRAW_SORCERY, seat)).toBe(spell);
            });
            withTemporaryDefinition(MODAL_DRAW_SORCERY, () => {
                expect(topOfLibrary(MODAL_DRAW_SORCERY, seat)).toBe(spell);
            });
            withTemporaryDefinition(OPPONENT_DRAW_SORCERY, () => {
                expect(topOfLibrary(OPPONENT_DRAW_SORCERY, seat)).toBe(land);
            });
            expect(topOfLibrary(getCardByName("Grizzly Bears"), seat)).toBe(
                land
            );
        }
    });

    it("frozen — the engine offers the action and no Move uses the card", () => {
        // The discriminator, on two REAL positions. No shipped card exhibits
        // the frozen arm today (`legalActions` and the enumerator agree on
        // every card of the first full pass), which is why it is asserted
        // here rather than through a card that cannot be written.
        const bears = getCardByName("Grizzly Bears");
        const castable = buildBotReachState(bears, 0);
        expect(
            classifyNoMove(
                castable.state,
                castable.holderId,
                castable.instanceId,
                bears
            )
        ).toEqual({
            outcome: "frozen",
            cause: "no-legal-move",
            form: "Creature",
        });

        withTemporaryDefinition(UNTARGETABLE_INSTANT, () => {
            const blocked = buildBotReachState(UNTARGETABLE_INSTANT, 0);
            expect(
                classifyNoMove(
                    blocked.state,
                    blocked.holderId,
                    blocked.instanceId,
                    UNTARGETABLE_INSTANT
                ).outcome
            ).toBe("ignored");
        });
    });

    it("both seats — the holder owns the decision whichever seat it is", () => {
        const def = getCardByName("Grizzly Bears");
        for (const seat of [0, 1] as const) {
            const { state, holderId, instanceId } = buildBotReachState(
                def,
                seat
            );
            expect(holderId).toBe(state.players[seat]!.id);
            expect(decidingPlayer(state)).toBe(holderId);
            const holder = state.players[seat]!;
            expect(holder.hand.some((c) => c.id === instanceId)).toBe(true);
        }
    });

    it("both seats — the card is actually played from each seat", () => {
        const seats = playBotReachSeats(getCardByName("Grizzly Bears"));
        const base = buildBotReachState(
            getCardByName("Grizzly Bears"),
            0
        ).state.players.map((p) => p.id);
        expect(seats.map((s) => s.holderId)).toEqual(base);
        // Neither seat freezes. Not "both played": at the sweep's budget the
        // second-built seat's search is noisier on this very position (see
        // docs/findings/3830-bot-reach-seat-asymmetric-search-noise.md), and
        // `played` means SOME seat chose the card — `ignored` is "never".
        expect(seats[0]!.verdict.outcome).toBe("played");
        expect(seats[1]!.verdict.outcome).not.toBe("frozen");
    });

    it("a spell-targeting card gets a spell on the stack to target", () => {
        // CR 115.1 — the one branch that VARIES the generated position. No
        // `ready` card declares a spell target today, so without this fixture
        // the branch decides nothing anywhere (review of PR #4057,
        // finding 11).
        withTemporaryDefinition(COUNTER_INSTANT, () => {
            const { state, holderId, instanceId } = buildBotReachState(
                COUNTER_INSTANT,
                0
            );
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0]!.castById).not.toBe(holderId);
            const moves = enumerateMoves(state, holderId).filter(
                (m) => "cardInstanceId" in m && m.cardInstanceId === instanceId
            );
            expect(moves.length).toBeGreaterThan(0);
            expect(playBotReach(COUNTER_INSTANT).outcome).not.toBe("frozen");
        });
    });

    it("a flash permanent whose enters trigger targets a spell gets one to target", () => {
        // CR 603.6a — the target lives on the TRIGGER, not the card (Mystic
        // Snake, issue #4282): without a spell on the stack the trigger has
        // no target and the creature is only a vanilla 2/2 for four.
        withTemporaryDefinition(FLASH_ETB_COUNTER, () => {
            const { state, holderId, instanceId } = buildBotReachState(
                FLASH_ETB_COUNTER,
                0
            );
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0]!.castById).not.toBe(holderId);
            const moves = enumerateMoves(state, holderId).filter(
                (m) => "cardInstanceId" in m && m.cardInstanceId === instanceId
            );
            expect(moves.length).toBeGreaterThan(0);
            // The verdict itself (issue #4282): with the spell to counter on
            // the stack the search picks the creature at some seat.
            expect(playBotReach(FLASH_ETB_COUNTER).outcome).toBe("played");
        });
    });

    it("a sorcery-speed permanent with a spell-targeting trigger is not posed a stack", () => {
        // CR 117.1a — a noninstant is castable only on an empty stack, so a
        // spell on the stack would make the card unplayable, not pose it.
        const sorcerySpeed: CardDefinition = {
            ...FLASH_ETB_COUNTER,
            id: "bot-reach-test:sorcery-speed-etb-counter",
            name: "Bot Reach Slow Snake",
            staticAbilities: [],
        };
        withTemporaryDefinition(sorcerySpeed, () => {
            const { state } = buildBotReachState(sorcerySpeed, 0);
            expect(state.stack).toHaveLength(0);
        });
    });

    it("a verdict does not depend on the order cards are swept in", () => {
        // The sweep registers 3,400 definitions into one long-running
        // process; a verdict that moved with registration order would make
        // the lockfile non-reproducible.
        // A PAIR THAT DISAGREES — one `played`, one `ignored`. Two cards with
        // the same verdict cannot see an order dependency at all: whatever
        // leaked between them would carry the answer they already share.
        withTemporaryDefinition(NO_OP_SORCERY, () => {
            const bears = getCardByName("Grizzly Bears");
            const forward = [playBotReach(bears), playBotReach(NO_OP_SORCERY)];
            const backward = [playBotReach(NO_OP_SORCERY), playBotReach(bears)];
            expect(forward[0]!.outcome).toBe("played");
            expect(forward[1]!.outcome).toBe("ignored");
            expect(forward).toEqual([backward[1], backward[0]]);
        });
    });

    it("the form is the cast shape, never the card", () => {
        expect(castShape(UNTARGETABLE_INSTANT)).toBe(
            "Instant target:Planeswalker"
        );
        expect(castShape(getCardByName("Fireball"))).toBe(
            "Sorcery target:any X"
        );
    });

    // Issue #4284: the pose seeded lands in the colours of the printed cost
    // only, so a kicker paid in another colour was never payable and the card
    // was measured on its unkicked half alone (`never-chosen › Creature ›
    // destroy+forEach+if`).
    it("the pose's lands cover a kicker leg's colours as well as the cost's", () => {
        const lands = botReachSpec(KICKED_SWEEP_CREATURE)
            .cards.filter((c) => c.zone === "battlefield")
            .map((c) => c.name);
        expect(lands).toContain("Mountain");
        expect(lands).toContain("Plains");
    });

    it("a kicker leg's lands are added, never dealt out of the printed cost's", () => {
        const heavy: CardDefinition = {
            ...KICKED_SWEEP_CREATURE,
            manaCost: { R: 3 },
        };
        const lands = botReachSpec(heavy)
            .cards.filter((c) => c.zone === "battlefield")
            .map((c) => c.name);
        expect(
            lands.filter((n) => n === "Mountain").length
        ).toBeGreaterThanOrEqual(3);
        expect(lands.filter((n) => n === "Plains")).toHaveLength(2);
    });

    it("played — a card whose value lies in its kicked branch is cast kicked", () => {
        withTemporaryDefinition(KICKED_SWEEP_CREATURE, () => {
            expect(playTwice(KICKED_SWEEP_CREATURE)).toEqual({
                outcome: "played",
            });
        });
    });
});
