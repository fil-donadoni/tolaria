// Mass P/T — a group pump with a controller qualifier, a Domain-scaled step,
// and a sweep that animates lands (issue #4132, CR 613.4c / 109.5 / 115.1 /
// 207.2c / 205.1b).
//
//  1. GOLDENS — every accepted form is a real corpus card. The six whose
//     scripts the canned smoke scenario cannot stage are `GOLDEN_FIXTURES`
//     rows (compared whole by `goldenFixtures.test.ts`); here they must reach
//     `ready`, and the neighbours that print the same form must follow them.
//     Natural Affinity is the fixture for the animation; Life // Death's own
//     line (its Death half is issue #4136) is compared as a sentence.
//  2. REFUSALS — the neighbours the rules must NOT read: a verb that disagrees
//     with its subject, a plural with no controller, a qualifier a sweep
//     selector cannot express, a Domain step that is not the printed ±1, and
//     an animation that never says the permanents keep their types.
//  3. LOWERING — the target slot a "target player controls" sweep allocates,
//     and the one-target ceiling it shares with every other announced target.
//  4. ENGINE — each compiled card resolved on the real stack: the sweep hits
//     the right player's creatures and nobody else's, the kicker gate opens
//     only when paid, Domain counts the CONTROLLER's lands, and an animated
//     land is still a land.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { resolveTopOfStack, type GameState } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

const NAMES = [
    "Strength of Night",
    "Arms of Hadar",
    "Planar Despair",
    "Gaea's Might",
    "Drag Down",
    "Natural Affinity",
];

function spell(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{2}{G}",
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function refused(card: OracleCard): boolean {
    return compileCard(card).state === "unparsed";
}

function effectsOf(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition.effects;
}

const SWEEP = (
    controller: unknown,
    filter: Record<string, unknown>,
    inner: Record<string, unknown>
) => ({
    op: "forEach",
    select: {
        set: "permanents",
        zone: "battlefield",
        ...(controller === undefined ? {} : { controller }),
        filter,
    },
    effects: [inner],
});

const PUMP_EACH = (power: unknown, toughness: unknown) => ({
    op: "pump",
    target: { ref: "$each" },
    power,
    toughness,
    duration: { phase: "end-of-turn" },
});

describe("mass P/T — goldens (issue #4132)", () => {
    it.each(
        GOLDEN_FIXTURES.filter((f) => NAMES.includes(f.card.name)).map(
            (f) => [f.card.name, f] as const
        )
    )("%s reaches ready — its fixture clears its smoke form", (_n, f) => {
        expect(compileCard(f.card).state).toBe("ready");
    });

    it("Charge: 'Creatures you control get' is a sweep of the CONTROLLER's creatures, not a target", () => {
        expect(
            sortKeys(
                effectsOf(
                    spell(
                        "Charge",
                        "Creatures you control get +1/+1 until end of turn."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                SWEEP("controller", { type: "Creature" }, PUMP_EACH(1, 1)),
            ])
        );
    });

    it("Night // Day: the Day half sweeps the ANNOUNCED player's creatures and declares the player target", () => {
        const outcome = compileCard({
            oracleId: "cb32ab3e-ef76-4afb-959f-f8cc2d18416e",
            name: "Night // Day",
            manaCost: "{B} // {2}{W}",
            typeLine: "Instant // Instant",
            oracleText: "",
            layout: "split",
            faces: [
                {
                    name: "Night",
                    manaCost: "{B}",
                    typeLine: "Instant",
                    oracleText: "Target creature gets -1/-1 until end of turn.",
                },
                {
                    name: "Day",
                    manaCost: "{2}{W}",
                    typeLine: "Instant",
                    oracleText:
                        "Creatures target player controls get +1/+1 until end of turn.",
                },
            ],
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        const day = outcome.definition.splitHalves![1]!;
        expect(sortKeys(day.effects)).toEqual(
            sortKeys([
                SWEEP({ target: 0 }, { type: "Creature" }, PUMP_EACH(1, 1)),
            ])
        );
        expect(day.targetRequirement).toEqual({ type: "player", count: 1 });
    });

    it("Might of Alara: Domain on ONE announced creature shares Gaea's Might's form and reaches ready", () => {
        const outcome = compileCard(
            spell(
                "Might of Alara",
                "Domain — Target creature gets +1/+1 until end of turn for each basic land type among lands you control."
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition.effects)).toEqual(
            sortKeys([
                {
                    op: "pump",
                    target: { target: 0 },
                    power: { domain: { of: "controller" } },
                    toughness: { domain: { of: "controller" } },
                    duration: { phase: "end-of-turn" },
                },
            ])
        );
    });

    it("Drag Down: a shrink per basic land type is the NEGATED Domain, on each stat", () => {
        expect(
            sortKeys(
                effectsOf(
                    spell(
                        "Drag Down",
                        "Domain — Target creature gets -1/-1 until end of turn for each basic land type among lands you control."
                    )
                )
            )
        ).toEqual(
            sortKeys([
                {
                    op: "pump",
                    target: { target: 0 },
                    power: { negate: { domain: { of: "controller" } } },
                    toughness: { negate: { domain: { of: "controller" } } },
                    duration: { phase: "end-of-turn" },
                },
            ])
        );
    });

    it("Life: 'All lands you control become 1/1 creatures … They're still lands' is Life // Death's own animation, byte for byte", () => {
        expect(
            sortKeys(
                effectsOf(
                    oracleCard({
                        name: "Life",
                        manaCost: "{G}",
                        typeLine: "Sorcery",
                        oracleText:
                            "All lands you control become 1/1 creatures until end of turn. They're still lands.",
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys([
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Land" },
                    },
                    effects: [
                        {
                            op: "animate",
                            target: { ref: "$each" },
                            power: 1,
                            toughness: 1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ])
        );
    });

    it("refuses Strength of Night's kicked clause on a spell that has no kicker to be kicked with", () => {
        expect(
            refused(
                spell(
                    "Test",
                    "Creatures you control get +1/+1 until end of turn. If this spell was kicked, Zombie creatures you control get an additional +2/+2 until end of turn."
                )
            )
        ).toBe(true);
    });
});

describe("mass P/T — refusals (fail-closed, ADR 0105)", () => {
    it.each([
        [
            "a singular subject behind the group verb",
            "Target creature get +1/+1 until end of turn.",
        ],
        [
            "a group subject behind the singular verb",
            "Creatures you control gets +1/+1 until end of turn.",
        ],
        [
            "a plural with no controller and no determiner",
            "Creatures get +1/+1 until end of turn.",
        ],
        [
            "the opponent's creatures",
            "Creatures an opponent controls get -1/-1 until end of turn.",
        ],
        [
            "a target OPPONENT's creatures",
            "Creatures target opponent controls get -1/-1 until end of turn.",
        ],
        [
            "a colour qualifier",
            "White creatures you control get +1/+1 until end of turn.",
        ],
        [
            "a combat-role qualifier",
            "Attacking creatures you control get +1/+0 until end of turn.",
        ],
        [
            "a supertype qualifier",
            "Legendary creatures you control get +2/+2 until end of turn.",
        ],
        [
            "'an additional' behind the singular verb",
            "Target creature gets an additional +1/+1 until end of turn.",
        ],
        [
            "a Domain step of two",
            "Creatures you control get +2/+2 until end of turn for each basic land type among lands you control.",
        ],
        [
            "a Domain step with mixed signs",
            "Target creature gets +1/-1 until end of turn for each basic land type among lands you control.",
        ],
        [
            "'each' behind the group verb",
            "Each creature you control get +1/+1 until end of turn.",
        ],
        [
            "a Domain step on one stat only",
            "Target creature gets +1/+0 until end of turn for each basic land type among lands you control.",
        ],
        [
            "a Domain tally other than the controller's",
            "Target creature gets +1/+1 until end of turn for each basic land type among lands target player controls.",
        ],
    ])("refuses %s", (_what, text) => {
        expect(refused(spell("Test", text))).toBe(true);
    });

    it.each([
        [
            "the sentence alone",
            "All lands you control become 1/1 creatures until end of turn.",
        ],
        [
            "a rider naming a type the sweep is not",
            "All lands you control become 1/1 creatures until end of turn. They're still creatures.",
        ],
        ["a rider with no animation before it", "They're still lands."],
        [
            "a sweep named by subtype",
            "All Forests you control become 1/1 creatures until end of turn. They're still lands.",
        ],
    ])("refuses an animation with %s", (_what, text) => {
        expect(refused(spell("Test", text))).toBe(true);
    });
});

describe("mass P/T — upgrades (CR 608.2c)", () => {
    it("refuses a flat '+5/+5 instead' over a per-basic-land-type base — the flag would eat the magnitude", () => {
        expect(
            refused(
                oracleCard({
                    name: "Test Upgrade",
                    manaCost: "{1}{U}",
                    typeLine: "Enchantment",
                    oracleText:
                        "At the beginning of your upkeep, if you control a blue or black permanent, target creature gets +1/+1 until end of turn for each basic land type among lands you control. If you control a blue permanent and a black permanent, that creature gets +5/+5 until end of turn instead.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(true);
    });
});

describe("mass P/T — lowering (CR 115.1, CR 601.2c)", () => {
    it("refuses two announced targets in one spell — a player sweep shares the one-target ceiling", () => {
        expect(
            refused(
                spell(
                    "Test",
                    "Target creature gets -1/-1 until end of turn. Creatures target player controls get +1/+1 until end of turn."
                )
            )
        ).toBe(true);
    });

    it("allocates the player slot in sentence order, beside an untargeted sweep", () => {
        const effects = effectsOf(
            spell(
                "Test",
                "Creatures target player controls get +1/+1 until end of turn."
            )
        );
        expect(JSON.stringify(effects)).toContain('"controller":{"target":0}');
        const outcome = compileCard(
            spell(
                "Test",
                "Creatures target player controls get +1/+1 until end of turn."
            )
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(outcome.definition.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });
});

// ── Engine ─────────────────────────────────────────────────────────────────

const card = (name: string) => getCardByName(name).id;

function compiled(
    name: string,
    id: string,
    text: string,
    typeLine = "Instant"
) {
    const outcome = compileCard(
        oracleCard({
            name,
            manaCost: "{2}{G}",
            typeLine,
            oracleText: text,
            power: undefined,
            toughness: undefined,
        })
    );
    if (outcome.state === "unparsed")
        throw new Error(`${name} unparsed: ${JSON.stringify(outcome.gaps)}`);
    return {
        ...outcome.definition,
        id,
        rarity: "common" as const,
    } as CardDefinition;
}

function stat(state: GameState, id: string) {
    const permanent = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === id)!;
    return [
        getEffectivePower(state, permanent),
        getEffectiveToughness(state, permanent),
    ];
}

describe("Strength of Night on the real stack (CR 702.33d, CR 611.2c)", () => {
    const text =
        "Kicker {B} (You may pay an additional {B} as you cast this spell.)\nCreatures you control get +1/+1 until end of turn. If this spell was kicked, Zombie creatures you control get an additional +2/+2 until end of turn.";
    const strength = compiled(
        "Strength of Night",
        "compiled-strength-4132",
        text
    );

    function resolve(kicked: boolean) {
        return withTemporaryDefinition(strength, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(card("Grizzly Bears"), { id: "bear" }),
                            makeInstance(card("Scathe Zombies"), {
                                id: "zombie",
                            }),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [
                            makeInstance(card("Grizzly Bears"), {
                                id: "theirs",
                                controllerId: "p2",
                                ownerId: "p2",
                            }),
                        ],
                    }),
                ],
            });
            const before = ["bear", "zombie", "theirs"].map((id) =>
                stat(state, id)
            );
            const item = pushSpell(state, strength.id, "p1");
            if (kicked) item.kickerPayments = { kicker: 1 };
            resolveTopOfStack(state);
            return ["bear", "zombie", "theirs"].map((id, i) => {
                const [p, t] = stat(state, id);
                return [p - before[i]![0]!, t - before[i]![1]!];
            });
        });
    }

    it("unkicked: every creature I control is +1/+1, the opponent's is untouched", () => {
        expect(resolve(false)).toEqual([
            [1, 1],
            [1, 1],
            [0, 0],
        ]);
    });

    it("kicked: only the Zombie takes the additional +2/+2", () => {
        expect(resolve(true)).toEqual([
            [1, 1],
            [3, 3],
            [0, 0],
        ]);
    });
});

describe("Arms of Hadar on the real stack (CR 115.1, CR 109.5)", () => {
    const arms = compiled(
        "Arms of Hadar",
        "compiled-arms-4132",
        "Creatures target player controls get -2/-2 until end of turn.",
        "Sorcery"
    );

    function shrink(target: "p1" | "p2") {
        return withTemporaryDefinition(arms, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(card("Grizzly Bears"), { id: "mine" }),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [
                            makeInstance(card("Grizzly Bears"), {
                                id: "theirs",
                                controllerId: "p2",
                                ownerId: "p2",
                            }),
                        ],
                    }),
                ],
            });
            pushSpell(state, arms.id, "p1", [{ type: "player", id: target }]);
            resolveTopOfStack(state);
            return [stat(state, "mine"), stat(state, "theirs")];
        });
    }

    it("shrinks the ANNOUNCED player's creatures and no one else's", () => {
        expect(shrink("p2")).toEqual([
            [2, 2],
            [0, 0],
        ]);
        expect(shrink("p1")).toEqual([
            [0, 0],
            [2, 2],
        ]);
    });
});

describe("Planar Despair on the real stack (CR 207.2c)", () => {
    const despair = compiled(
        "Planar Despair",
        "compiled-despair-4132",
        "Domain — All creatures get -1/-1 until end of turn for each basic land type among lands you control.",
        "Sorcery"
    );

    function shrunkBy(mine: string[], theirs: string[]) {
        return withTemporaryDefinition(despair, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(card("Grizzly Bears"), { id: "bear" }),
                            ...mine.map((n, i) =>
                                makeInstance(card(n), { id: `m${i}` })
                            ),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [
                            makeInstance(card("Grizzly Bears"), {
                                id: "theirs",
                                controllerId: "p2",
                                ownerId: "p2",
                            }),
                            ...theirs.map((n, i) =>
                                makeInstance(card(n), {
                                    id: `t${i}`,
                                    controllerId: "p2",
                                    ownerId: "p2",
                                })
                            ),
                        ],
                    }),
                ],
            });
            const before = [stat(state, "bear"), stat(state, "theirs")];
            pushSpell(state, despair.id, "p1");
            resolveTopOfStack(state);
            return [stat(state, "bear"), stat(state, "theirs")].map(
                ([p, t], i) => [before[i]![0]! - p!, before[i]![1]! - t!]
            );
        });
    }

    it("counts the CONTROLLER's basic land types and shrinks EVERY creature by that many", () => {
        expect(shrunkBy(["Plains", "Island", "Forest"], [])).toEqual([
            [3, 3],
            [3, 3],
        ]);
    });

    it("ignores the opponent's lands", () => {
        expect(
            shrunkBy(["Plains"], ["Island", "Swamp", "Mountain", "Forest"])
        ).toEqual([
            [1, 1],
            [1, 1],
        ]);
    });
});

describe("Life's animation on the real stack (CR 205.1b, CR 611.2c)", () => {
    const life = compiled(
        "Life",
        "compiled-life-4132",
        "All lands you control become 1/1 creatures until end of turn. They're still lands.",
        "Sorcery"
    );

    it("animates every land I control — and only mine — and they are still lands", () => {
        withTemporaryDefinition(life, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(card("Forest"), { id: "f" }),
                            makeInstance(card("Island"), { id: "i" }),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [
                            makeInstance(card("Swamp"), {
                                id: "s",
                                controllerId: "p2",
                                ownerId: "p2",
                            }),
                        ],
                    }),
                ],
            });
            pushSpell(state, life.id, "p1");
            resolveTopOfStack(state);
            const all = state.players.flatMap((p) => p.battlefield);
            const byId = (id: string) => all.find((c) => c.id === id)!;
            for (const id of ["f", "i"]) {
                expect(byId(id).types, id).toEqual(
                    expect.arrayContaining(["Land", "Creature"])
                );
                expect(stat(state, id), id).toEqual([1, 1]);
            }
            expect(byId("s").types).not.toContain("Creature");
        });
    });
});
