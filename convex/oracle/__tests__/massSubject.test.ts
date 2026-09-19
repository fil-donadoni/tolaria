// Mass subjects: "all enchantments", "all lands you control", "all other
// creatures you control", "each artifact, creature, and enchantment with mana
// value X or less", and the kicked "… instead" that replaces one sweep with a
// wider one (CR 110.1, CR 701.8a, CR 701.26, CR 702.33e, issue #4128).
//
// Four layers, each watching a different way a sweep can go wrong:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: destroy / tap / untap,
//     `all` / `all other` / `each`, "you control", an and-list, a bare subtype
//     noun, the announced-X bound, and the kicked replacement.
//  2. REFUSALS — the neighbours the corpus prints that a `forEach` selector
//     cannot express (a colour, a keyword, a combat role, another controller,
//     a numeric mana-value bound). Each stays `unparsed` and names the
//     sub-grammar that refused it: a sweep that silently ignored "white" would
//     destroy every creature.
//  3. LOWERING invariants — what only the whole card decides: the X bound is an
//     `if` INSIDE the sweep and never a selector field (`PermanentFilter` has
//     no mana-value field, so it would be dropped), and the `destroysAllLands`
//     hint is derived for exactly the unscoped land sweep.
//  4. BEHAVIOUR — the compiled definitions run through the real interpreter:
//     the X bound is inclusive and spares the types the list does not name, and
//     the kicked branch reaches the opponent while the base branch does not.

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
import { resolveTopOfStack, type GameState } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

function sorcery(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectDefinition(
    card: ReturnType<typeof oracleCard>,
    expected: Record<string, unknown>
) {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

/** The sweep the compiler emits for `select`, destroying each member. */
function destroyEach(select: Record<string, unknown>) {
    return {
        op: "forEach",
        select: { set: "permanents", zone: "battlefield", ...select },
        effects: [{ op: "destroy", target: { ref: "$each" } }],
    };
}

/** Where a refused line was refused: the slot, the sub-grammar path and span. */
function refusal(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} compiled: expected a refusal`);
    return outcome.gaps[0]!.attribution;
}

describe("Mass subject — golden fixtures (CR 110.1, CR 701.8a)", () => {
    it("all <plural type>, then a second sentence: Tranquil Path", () => {
        expectDefinition(
            oracleCard({
                name: "Tranquil Path",
                manaCost: "{4}{G}",
                typeLine: "Sorcery",
                oracleText: "Destroy all enchantments.\nDraw a card.",
                power: undefined,
                toughness: undefined,
            }),
            {
                name: "Tranquil Path",
                types: ["Sorcery"],
                manaCost: { X: 4, G: 1 },
                oracleText: "Destroy all enchantments.\nDraw a card.",
                effects: [
                    destroyEach({ filter: { type: "Enchantment" } }),
                    { op: "draw", player: "controller", count: 1 },
                ],
            }
        );
    });

    it("all <plural type> is unscoped and carries the land hint: Armageddon", () => {
        expectDefinition(
            sorcery("Armageddon", "{3}{W}", "Destroy all lands."),
            {
                name: "Armageddon",
                types: ["Sorcery"],
                manaCost: { X: 3, W: 1 },
                oracleText: "Destroy all lands.",
                effects: [destroyEach({ filter: { type: "Land" } })],
                destroysAllLands: true,
            }
        );
    });

    it("a bare subtype noun is the subtype alone (CR 205.3m): Tivadar's Crusade", () => {
        // The hand-written card wrote `type: "Creature"` beside the subtype and
        // Tsunami's "Islands" does not; a creature type also sits on a Kindred
        // permanent, so the subtype IS the whole filter.
        expectDefinition(
            sorcery("Tivadar's Crusade", "{1}{W}{W}", "Destroy all Goblins."),
            {
                name: "Tivadar's Crusade",
                types: ["Sorcery"],
                manaCost: { X: 1, W: 2 },
                oracleText: "Destroy all Goblins.",
                effects: [destroyEach({ filter: { subtype: "Goblin" } })],
            }
        );
    });

    it("an and-list under `all` is ONE sweep over the union: Nevinyrral's Disk", () => {
        // One destroy per permanent. The earlier hand-written encoding was one
        // sweep per type, which destroyed an artifact creature twice — spending
        // a regeneration shield on the first pass and killing it on the second.
        const definition = compiled(
            oracleCard({
                name: "Nevinyrral's Disk",
                manaCost: "{4}",
                typeLine: "Artifact",
                oracleText:
                    "This artifact enters tapped.\n{1}, {T}: Destroy all artifacts, creatures, and enchantments.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(definition.activatedAbilities?.[0]?.effects).toEqual([
            destroyEach({
                filter: { type: ["Artifact", "Creature", "Enchantment"] },
            }),
        ]);
    });

    it("tap all <type> you control, at a trigger: Silt Crawler", () => {
        expectDefinition(
            oracleCard({
                name: "Silt Crawler",
                manaCost: "{2}{G}",
                typeLine: "Creature — Beast",
                oracleText:
                    "When this creature enters, tap all lands you control.",
                power: "3",
                toughness: "3",
            }),
            {
                name: "Silt Crawler",
                types: ["Creature"],
                subtypes: ["Beast"],
                manaCost: { X: 2, G: 1 },
                power: 3,
                toughness: 3,
                oracleText:
                    "When this creature enters, tap all lands you control.",
                compiledTriggeredAbilities: [
                    {
                        id: "silt-crawler-trigger",
                        oracleText:
                            "When this creature enters, tap all lands you control.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
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
                                        op: "tapUntap",
                                        action: "tap",
                                        target: { ref: "$each" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            }
        );
    });

    it("untap all <type> you control, at a phase trigger: Wilderness Reclamation", () => {
        const definition = compiled(
            oracleCard({
                name: "Wilderness Reclamation",
                manaCost: "{3}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "At the beginning of your end step, untap all lands you control.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(definition.compiledTriggeredAbilities?.[0]?.effects).toEqual([
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
                        op: "tapUntap",
                        action: "untap",
                        target: { ref: "$each" },
                    },
                ],
            },
        ]);
    });

    it("each <list> with mana value X or less: Pernicious Deed", () => {
        const definition = compiled(
            oracleCard({
                name: "Pernicious Deed",
                manaCost: "{1}{B}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(definition.activatedAbilities?.[0]?.cost).toEqual({
            mana: { X: "X" },
            sacrifice: true,
        });
        expect(definition.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: ["Artifact", "Creature", "Enchantment"] },
                },
                effects: [
                    {
                        op: "if",
                        predicate: {
                            left: { manaValue: { of: { ref: "$each" } } },
                            op: "le",
                            right: { X: true },
                        },
                        then: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
            },
        ]);
    });

    it("kicked replaces the base sweep, `all <type> you control`: Desolation Angel", () => {
        const definition = compiled(desolationAngel());
        expect(definition.compiledTriggeredAbilities?.[0]).toEqual({
            id: "desolation-angel-trigger",
            oracleText:
                "When this creature enters, destroy all lands you control. If it was kicked, destroy all lands instead.",
            head: { kind: "entered", scope: "self" },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [destroyEach({ filter: { type: "Land" } })],
                    else: [
                        destroyEach({
                            controller: "controller",
                            filter: { type: "Land" },
                        }),
                    ],
                },
            ],
        });
    });

    it("kicked replaces the base sweep, `all other <type> you control`: Desolation Giant", () => {
        const definition = compiled(desolationGiant());
        expect(definition.compiledTriggeredAbilities?.[0]?.effects).toEqual([
            {
                op: "if",
                predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
                then: [
                    destroyEach({
                        filter: { type: "Creature" },
                        excludeSource: true,
                    }),
                ],
                else: [
                    destroyEach({
                        controller: "controller",
                        filter: { type: "Creature" },
                        excludeSource: true,
                    }),
                ],
            },
        ]);
    });
});

function desolationAngel() {
    return oracleCard({
        name: "Desolation Angel",
        manaCost: "{3}{B}{B}",
        typeLine: "Creature — Angel",
        oracleText:
            "Kicker {W}{W} (You may pay an additional {W}{W} as you cast this spell.)\nFlying\nWhen this creature enters, destroy all lands you control. If it was kicked, destroy all lands instead.",
        power: "5",
        toughness: "4",
    });
}

function desolationGiant() {
    return oracleCard({
        name: "Desolation Giant",
        manaCost: "{2}{R}{R}",
        typeLine: "Creature — Giant",
        oracleText:
            "Kicker {W}{W} (You may pay an additional {W}{W} as you cast this spell.)\nWhen this creature enters, destroy all other creatures you control. If it was kicked, destroy all other creatures instead.",
        power: "3",
        toughness: "3",
    });
}

describe("Mass subject — refusals (fail closed)", () => {
    it("refuses a colour: the sweep would otherwise destroy every creature", () => {
        expect(
            refusal(sorcery("Test", "{2}{W}", "Destroy all white creatures."))
        ).toEqual({
            slot: "spell",
            path: ["effect clause", "mass subject"],
            span: "colors",
        });
    });

    it("refuses a keyword, a combat role and another controller", () => {
        expect(
            refusal(
                sorcery("Test", "{2}{W}", "Destroy all creatures with flying.")
            )?.path
        ).toContain("mass subject");
        expect(
            refusal(sorcery("Test", "{2}{W}", "Untap all attacking creatures."))
        ).toMatchObject({
            path: ["effect clause", "mass subject"],
            span: "combatRole",
        });
        expect(
            refusal(
                sorcery(
                    "Test",
                    "{2}{W}",
                    "Destroy all creatures an opponent controls."
                )
            )?.path
        ).toContain("mass subject");
    });

    it("refuses a numeric mana-value bound and a lower bound: only `X or less` is read", () => {
        expect(
            refusal(
                sorcery(
                    "Test",
                    "{2}{B}",
                    "Destroy each creature with mana value 3 or less."
                )
            )
        ).toMatchObject({
            path: ["effect clause", "mass subject"],
            span: "mvFilter",
        });
        expect(
            refusal(
                sorcery(
                    "Test",
                    "{X}{B}",
                    "Destroy each creature with mana value X or greater."
                )
            )
        ).toMatchObject({
            slot: "spell",
            path: ["effect clause", "mass subject", "object descriptor"],
        });
    });

    it("refuses a list mixing card types and subtypes: it would lower to an intersection", () => {
        // `{ type, subtype }` is AND across fields — only Forest artifacts —
        // where the sentence names every artifact and every Forest.
        for (const line of [
            "Destroy all artifacts and Forests.",
            "Destroy all Goblins and artifacts.",
            "Destroy all lands and Goblins you control.",
            "Untap all Forests and creatures you control.",
            "Destroy all artifacts or Forests.",
        ])
            expect(
                refusal(sorcery("Test", "{2}{W}", line)),
                line
            ).toMatchObject({
                path: ["effect clause", "mass subject"],
                span: "subtypes",
            });
    });

    it("refuses stacked subtypes: an OR of both would destroy more than the sentence names", () => {
        for (const line of [
            "Destroy all Elf Warriors.",
            "Destroy all Eldrazi Spawn creatures.",
        ])
            expect(
                refusal(sorcery("Test", "{2}{W}", line)),
                line
            ).toMatchObject({
                path: ["effect clause", "mass subject"],
                span: "subtypes",
            });
    });

    it("still reads a list of subtypes, and one subtype beside its card type", () => {
        const selectOf = (line: string) =>
            (
                compiled(sorcery("Test", "{2}{W}", line))
                    .effects![0] as unknown as {
                    select: { filter: Record<string, unknown> };
                }
            ).select.filter;
        expect(selectOf("Destroy all Forests and Islands.")).toEqual({
            subtype: ["Forest", "Island"],
        });
        expect(selectOf("Destroy all Elf creatures.")).toEqual({
            type: "Creature",
            subtype: "Elf",
        });
    });

    it("refuses a noun whose number disagrees with the determiner", () => {
        expect(
            refusal(sorcery("Test", "{2}{W}", "Destroy all enchantment."))
        ).toMatchObject({
            path: ["effect clause", "mass subject"],
            span: "all enchantment",
        });
        expect(
            refusal(sorcery("Test", "{2}{W}", "Destroy each enchantments."))
        ).toMatchObject({
            path: ["effect clause", "mass subject"],
            span: "each enchantments",
        });
    });

    it("refuses an and-list whose member carries an adjective: the scope of `nonland` is a question", () => {
        expect(
            refusal(
                sorcery(
                    "Test",
                    "{2}{W}",
                    "Destroy all nonland artifacts and creatures."
                )
            )?.path
        ).toEqual(["effect clause", "mass subject", "object descriptor"]);
    });

    it('refuses "It can\'t be regenerated." behind a sweep: "It" names one object', () => {
        expect(
            refusal(
                sorcery(
                    "Test",
                    "{2}{W}",
                    "Destroy all creatures. It can't be regenerated."
                )
            )?.path
        ).toEqual(["sentence assembly"]);
    });

    it("refuses an X bound on a source that announces no {X} (CR 107.3)", () => {
        const outcome = compileCard(
            sorcery(
                "Test",
                "{2}{B}",
                "Destroy each creature with mana value X or less."
            )
        );
        expect(outcome.state).toBe("unparsed");
        expect(JSON.stringify(outcome)).toContain(
            "a sweep reads X but its source announces no {X}"
        );
    });

    it("refuses a kicked replacement that is not a sweep of the same verb", () => {
        for (const line of [
            // A single target replaced by a sweep: the lowering also refuses a
            // target announced in one branch only (CR 702.33g).
            "When this creature enters, destroy target creature. If it was kicked, destroy all creatures instead.",
            // A non-target, non-sweep base: only the pairing rule refuses it —
            // it would lower cleanly, and the pair is not a form the corpus
            // prints.
            "When this creature enters, destroy this creature. If it was kicked, destroy all lands instead.",
            // A different verb.
            "When this creature enters, destroy all lands you control. If it was kicked, tap all lands instead.",
        ]) {
            const outcome = compileCard(
                oracleCard({
                    ...desolationAngel(),
                    oracleText: `Kicker {W}{W}\n${line}`,
                })
            );
            expect(outcome.state, line).toBe("unparsed");
        }
    });

    it('refuses "If it was kicked" behind a head that is not this permanent entering', () => {
        const outcome = compileCard(
            oracleCard({
                ...desolationAngel(),
                oracleText:
                    "Kicker {W}{W}\nWhen this creature dies, destroy all lands you control. If it was kicked, destroy all lands instead.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a kicked replacement on a card that prints no kicker (CR 702.33e)", () => {
        const outcome = compileCard(
            oracleCard({
                ...desolationAngel(),
                oracleText:
                    "When this creature enters, destroy all lands you control. If it was kicked, destroy all lands instead.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Mass subject — lowering invariants", () => {
    it("the X bound is an `if` inside the sweep, never a selector field", () => {
        // `PermanentFilter` has no mana-value field: a bound folded into the
        // selector would be dropped and the sweep would destroy everything.
        const definition = compiled(
            oracleCard({
                name: "Pernicious Deed",
                manaCost: "{1}{B}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.",
                power: undefined,
                toughness: undefined,
            })
        );
        const sweep = definition.activatedAbilities![0]!
            .effects![0]! as unknown as {
            select: { filter: Record<string, unknown> };
            effects: { op: string }[];
        };
        expect(Object.keys(sweep.select.filter)).toEqual(["type"]);
        expect(sweep.effects.map((op) => op.op)).toEqual(["if"]);
    });

    it("`destroysAllLands` marks the unscoped land sweep and nothing else", () => {
        for (const [text, marked] of [
            ["Destroy all lands.", true],
            ["Destroy all lands you control.", false],
            ["Destroy all creatures.", false],
            ["Destroy all Forests.", false],
            ["Destroy all artifacts, creatures, and enchantments.", false],
        ] as const) {
            expect(
                compiled(sorcery("Test", "{3}{W}", text)).destroysAllLands,
                text
            ).toBe(marked ? true : undefined);
        }
    });

    it("the replacement rides `then` and the base rides `else`", () => {
        // Kicked = the WIDER sweep. Swapping the branches would make the
        // unkicked Desolation Angel destroy the opponent's lands.
        const trigger =
            compiled(desolationAngel()).compiledTriggeredAbilities![0]!;
        const gate = trigger.effects[0] as {
            then: { select: Record<string, unknown> }[];
            else: { select: Record<string, unknown> }[];
        };
        expect(gate.then[0]!.select.controller).toBeUndefined();
        expect(gate.else[0]!.select.controller).toBe("controller");
    });
});

// ── Behaviour: the compiled definitions, through the real interpreter ──────

/** Register `card`'s compiled definition under a test id for `fn`'s extent. */
function withCompiled<T>(
    card: ReturnType<typeof oracleCard>,
    fn: (id: string) => T
): T {
    const id = `test-mass-subject-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
    const definition = {
        ...compiled(card),
        id,
        rarity: "common",
    } as unknown as CardDefinition;
    return withTemporaryDefinition(definition, () => fn(id));
}

function ids(state: GameState, player: number) {
    return state.players[player]!.battlefield.map((c) => c.id).sort();
}

describe("Mass subject — behaviour through the interpreter", () => {
    const bears = () => getCardByName("Grizzly Bears").id; // MV 2
    const angel = () => getCardByName("Serra Angel").id; // MV 5
    const ring = () => getCardByName("Sol Ring").id; // MV 1
    const ankh = () => getCardByName("Ankh of Mishra").id; // MV 2
    const icy = () => getCardByName("Icy Manipulator").id; // MV 4
    const fervor = () => getCardByName("Fervor").id; // MV 3
    const island = () => getCardByName("Island").id; // Land
    const pacifism = () => getCardByName("Pacifism").id; // Enchantment, MV 2

    it("Pernicious Deed with X = 2 destroys MV <= 2 of the three types on BOTH sides and spares the rest", () => {
        withCompiled(
            oracleCard({
                name: "Pernicious Deed",
                manaCost: "{1}{B}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.",
                power: undefined,
                toughness: undefined,
            }),
            (deedId) => {
                const deed = makeInstance(deedId, { id: "deed" });
                const mine = [
                    makeInstance(bears(), { id: "p1-bears" }), // 2: dies
                    makeInstance(ring(), { id: "p1-ring" }), // 1: dies
                    makeInstance(icy(), { id: "p1-icy" }), // 4: stays
                    makeInstance(island(), { id: "p1-island" }), // Land: stays
                ];
                const theirs = [
                    makeInstance(ankh(), {
                        id: "p2-ankh",
                        controllerId: "p2",
                        ownerId: "p2",
                    }), // 2: dies
                    makeInstance(pacifism(), {
                        id: "p2-pacifism",
                        controllerId: "p2",
                        ownerId: "p2",
                    }), // 2: dies (the Enchantment leg of the union)
                    makeInstance(fervor(), {
                        id: "p2-fervor",
                        controllerId: "p2",
                        ownerId: "p2",
                    }), // 3: stays
                    makeInstance(angel(), {
                        id: "p2-angel",
                        controllerId: "p2",
                        ownerId: "p2",
                    }), // 5: stays
                ];
                const state = makeState({
                    players: [
                        makePlayer("p1", { battlefield: mine }),
                        makePlayer("p2", { battlefield: theirs }),
                    ],
                });
                // The Deed was sacrificed as a cost: it is on the stack, not on
                // the battlefield, when its ability resolves.
                state.stack.push({
                    ...deed,
                    zone: "stack",
                    castById: "p1",
                    abilityId: "pernicious-deed-ability",
                    chosenX: 2,
                    targets: [],
                });
                resolveTopOfStack(state);
                expect(ids(state, 0)).toEqual(["p1-icy", "p1-island"]);
                expect(ids(state, 1)).toEqual(["p2-angel", "p2-fervor"]);
            }
        );
    });

    it("Pernicious Deed with X = 0 destroys nothing that has a mana cost, and never a land", () => {
        withCompiled(
            oracleCard({
                name: "Pernicious Deed",
                manaCost: "{1}{B}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.",
                power: undefined,
                toughness: undefined,
            }),
            (deedId) => {
                const deed = makeInstance(deedId, { id: "deed" });
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                makeInstance(bears(), { id: "p1-bears" }),
                                makeInstance(island(), { id: "p1-island" }),
                            ],
                        }),
                        makePlayer("p2"),
                    ],
                });
                state.stack.push({
                    ...deed,
                    zone: "stack",
                    castById: "p1",
                    abilityId: "pernicious-deed-ability",
                    chosenX: 0,
                    targets: [],
                });
                resolveTopOfStack(state);
                expect(ids(state, 0)).toEqual(["p1-bears", "p1-island"]);
            }
        );
    });

    /** Cast the kicker creature, kicked or not, and resolve its ETB trigger. */
    function castAndResolveEntry(
        card: ReturnType<typeof oracleCard>,
        kicked: boolean,
        setup: (id: string) => {
            mine: GameState["players"][0]["battlefield"];
            theirs: GameState["players"][0]["battlefield"];
        }
    ) {
        return withCompiled(card, (id) => {
            const { mine, theirs } = setup(id);
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: mine }),
                    makePlayer("p2", { battlefield: theirs }),
                ],
            });
            const item = pushSpell(state, id, "p1");
            if (kicked) item.kickerPayments = { kicker: 1 };
            resolveTopOfStack(state); // the creature enters; its trigger lands
            expect(state.stack).toHaveLength(1);
            resolveTopOfStack(state); // the trigger resolves
            return state;
        });
    }

    it("Desolation Angel unkicked destroys only ITS CONTROLLER's lands", () => {
        const state = castAndResolveEntry(desolationAngel(), false, () => ({
            mine: [makeInstance(island(), { id: "p1-island" })],
            theirs: [
                makeInstance(island(), {
                    id: "p2-island",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
            ],
        }));
        expect(ids(state, 0).filter((i) => i === "p1-island")).toEqual([]);
        expect(ids(state, 1)).toEqual(["p2-island"]);
    });

    it("Desolation Angel kicked destroys EVERY land", () => {
        const state = castAndResolveEntry(desolationAngel(), true, () => ({
            mine: [makeInstance(island(), { id: "p1-island" })],
            theirs: [
                makeInstance(island(), {
                    id: "p2-island",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
            ],
        }));
        expect(ids(state, 0).filter((i) => i === "p1-island")).toEqual([]);
        expect(ids(state, 1)).toEqual([]);
    });

    it("Desolation Giant unkicked destroys its controller's OTHER creatures and never itself", () => {
        const state = castAndResolveEntry(desolationGiant(), false, () => ({
            mine: [makeInstance(bears(), { id: "p1-bears" })],
            theirs: [
                makeInstance(bears(), {
                    id: "p2-bears",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
            ],
        }));
        expect(ids(state, 0)).toHaveLength(1); // only the Giant itself
        expect(ids(state, 0)).not.toContain("p1-bears");
        expect(ids(state, 1)).toEqual(["p2-bears"]);
    });

    it("Desolation Giant kicked destroys every OTHER creature and still not itself", () => {
        const state = castAndResolveEntry(desolationGiant(), true, () => ({
            mine: [makeInstance(bears(), { id: "p1-bears" })],
            theirs: [
                makeInstance(bears(), {
                    id: "p2-bears",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
            ],
        }));
        expect(ids(state, 0)).toHaveLength(1);
        expect(ids(state, 0)).not.toContain("p1-bears");
        expect(ids(state, 1)).toEqual([]);
    });
});
