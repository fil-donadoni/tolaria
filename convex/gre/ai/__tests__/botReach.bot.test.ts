// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — one fixture per outcome on
// the generated position, each run twice to pin determinism. The sweep itself
// runs over the whole `ready` set in `oracle:compile`; this file is the
// evidence that its three verdicts mean what the lockfile says they mean.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition, EffectSignedValue } from "../../../cards/types";
import { decidingPlayer } from "../../search";
import { enumerateMoves } from "../../moves";
import {
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

/** CR 701.21a / 608.2b — an edict: the TARGET player owes a mandatory
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

/** CR 603.3 / 701.21a — a creature whose enters-the-battlefield trigger asks
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
});
