// Life quantities — a drain ("Target player loses 2 life and you gain 2
// life"), a life change per counted set ("You gain 2 life for each Plains you
// control", "… for each card in target opponent's hand"), and a loss equal to
// the acted-on object's mana value ("You lose life equal to its mana value")
// (issue #4136, CR 119.3 / 107.1 / 402.3 / 202.3 / 608.2h).
//
//  1. GOLDENS — real corpus cards compiled whole and compared with `sortKeys`
//     equality. Where NO whole real card compiles yet (the trigger's target
//     opponent's hand: Gerrard Capashen also prints "Activate only if … is
//     attacking"; "its mana value": every printer also returns a card to the
//     BATTLEFIELD, a destination the lowering refuses), the form is pinned by
//     the real Oracle LINE inside a wrapper card, named as such.
//  2. REFUSALS — the neighbours the corpus prints that this grammar must NOT
//     read: another controller, a combat role, "on the battlefield", a zone
//     the count does not name, "each opponent", and "its mana value" with
//     nothing acted on before it.
//  3. BEHAVIOUR — the compiled scripts run through the real interpreter, so a
//     multiplier, a target hand, or a snapshot dropped anywhere between the
//     grammar and the resolution is a wrong life total here.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getPlayer, resolveTopOfStack } from "../../gre/state";
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

function effectsOf(card: ReturnType<typeof oracleCard>) {
    return sortKeys(compiled(card).effects);
}

function triggersOf(
    card: ReturnType<typeof oracleCard>
): readonly CompiledTriggeredAbility[] {
    return compiled(card).compiledTriggeredAbilities ?? [];
}

const refused = (card: ReturnType<typeof oracleCard>) =>
    compileCard(card).state === "unparsed";

describe("life quantities — goldens (issue #4136)", () => {
    it("Last Caress: a drain is the target's loss, then the controller's gain (CR 608.2c)", () => {
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        name: "Last Caress",
                        manaCost: "{2}{B}",
                        typeLine: "Sorcery",
                        oracleText:
                            "Target player loses 1 life and you gain 1 life.\nDraw a card.",
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Last Caress",
                types: ["Sorcery"],
                manaCost: { X: 2, B: 1 },
                oracleText:
                    "Target player loses 1 life and you gain 1 life.\nDraw a card.",
                effects: [
                    { op: "loseLife", player: { target: 0 }, amount: 1 },
                    { op: "gainLife", player: "controller", amount: 1 },
                    { op: "draw", player: "controller", count: 1 },
                ],
                targetRequirement: { type: "player", count: 1 },
            })
        );
    });

    it("Folk Medicine: one life per permanent of a type — no multiplier key at 1", () => {
        expect(
            effectsOf(
                oracleCard({
                    name: "Folk Medicine",
                    manaCost: "{2}{G}",
                    typeLine: "Instant",
                    oracleText:
                        "You gain 1 life for each creature you control.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual(
            sortKeys([
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: ["Creature"] },
                        },
                    },
                },
            ])
        );
    });

    it("Landbind Ritual: the multiplier over one subtype's permanents", () => {
        expect(
            effectsOf(
                sorcery(
                    "Landbind Ritual",
                    "{3}{W}{W}",
                    "You gain 2 life for each Plains you control."
                )
            )
        ).toEqual(
            sortKeys([
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { subtype: "Plains" },
                            times: 2,
                        },
                    },
                },
            ])
        );
    });

    it("Gerrard's Wisdom: a hand's size, times the multiplier (CR 402.3)", () => {
        expect(
            effectsOf(
                sorcery(
                    "Gerrard's Wisdom",
                    "{2}{W}{W}",
                    "You gain 2 life for each card in your hand."
                )
            )
        ).toEqual(
            sortKeys([
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        count: {
                            zone: "hand",
                            controller: "controller",
                            times: 2,
                        },
                    },
                },
            ])
        );
    });

    it("Last Stand's first sentence: a TARGET opponent loses 2 per Swamp (wrapper — the whole card has four more forms)", () => {
        expect(
            effectsOf(
                sorcery(
                    "Wrapper",
                    "{B}",
                    "Target opponent loses 2 life for each Swamp you control."
                )
            )
        ).toEqual(
            sortKeys([
                {
                    op: "loseLife",
                    player: { target: 0 },
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { subtype: "Swamp" },
                            times: 2,
                        },
                    },
                },
            ])
        );
    });

    it("Gerrard Capashen's trigger: the announced opponent's hand (wrapper — the whole card has more lines)", () => {
        expect(
            sortKeys(
                triggersOf(
                    oracleCard({
                        name: "Wrapper",
                        manaCost: "{3}{W}",
                        typeLine: "Legendary Creature — Human Soldier",
                        oracleText:
                            "At the beginning of your upkeep, you gain 1 life for each card in target opponent's hand.",
                    })
                )
            )
        ).toEqual(
            sortKeys([
                {
                    id: "wrapper-trigger",
                    oracleText:
                        "At the beginning of your upkeep, you gain 1 life for each card in target opponent's hand.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: {
                                count: {
                                    zone: "hand",
                                    controller: { target: 0 },
                                },
                            },
                        },
                    ],
                    targetRequirement: {
                        type: "player",
                        count: 1,
                        controller: "opponent",
                    },
                },
            ])
        );
    });

    it("Alms of the Vein's trigger: a drain on the announced OPPONENT (wrapper)", () => {
        expect(
            sortKeys(
                triggersOf(
                    oracleCard({
                        name: "Wrapper",
                        manaCost: "{2}{B}",
                        typeLine: "Enchantment",
                        oracleText:
                            "At the beginning of your upkeep, target opponent loses 1 life and you gain 1 life.",
                        power: undefined,
                        toughness: undefined,
                    })
                )[0]!.effects
            )
        ).toEqual(
            sortKeys([
                { op: "loseLife", player: { target: 0 }, amount: 1 },
                { op: "gainLife", player: "controller", amount: 1 },
            ])
        );
    });

    it("Ghastly Death Tyrant's clause: 'its mana value' reads the DESTROYED object's snapshot (wrapper)", () => {
        expect(
            effectsOf(
                sorcery(
                    "Wrapper",
                    "{B}",
                    "Destroy target creature. You lose life equal to its mana value."
                )
            )
        ).toEqual(
            sortKeys([
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { ref: "$that1.manaValue" },
                },
            ])
        );
    });

    it("Reanimate's wording: 'that card's mana value' after a return to hand (wrapper)", () => {
        expect(
            effectsOf(
                sorcery(
                    "Wrapper",
                    "{B}",
                    "Return target creature card from your graveyard to your hand. You lose life equal to that card's mana value."
                )
            )
        ).toEqual(
            sortKeys([
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "hand",
                    bind: "$that1",
                },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { ref: "$that1.manaValue" },
                },
            ])
        );
    });
});

describe("life quantities — refusals stay fail-closed (issue #4136)", () => {
    /** [line, what it is, the refusal's reason — so a refusal for the WRONG
     *  reason (a typo in the wrapper, an unrelated gap) cannot pass]. */
    const REFUSED: readonly [
        string,
        string,
        RegExp,
        { path: string[]; span: string }?,
    ][] = [
        // A drain whose loser is not one announced target: the lowering has no
        // single player to point at for "each opponent" (CR 101.4).
        [
            "Each opponent loses 2 life and you gain 2 life.",
            "each opponent's drain",
            /"each player" is not in grammar v0/,
        ],
        // A second half other than "you gain N life".
        [
            "Target player loses 2 life and that player's controller gains 2 life.",
            "a different second half",
            /no slot consumed/,
        ],
        // Another controller's permanents (Riot Control prints "your opponents
        // control"; "an opponent controls" is the descriptor the rule reads),
        // a combat role, the whole battlefield.
        [
            "You gain 1 life for each creature an opponent controls.",
            "the opponent's permanents",
            /permanents "you control"/,
        ],
        [
            "You gain 2 life for each creature target player controls.",
            "another player's permanents",
            /no slot consumed/,
            {
                path: ["effect clause", "counted set", "object descriptor"],
                span: "creature target player controls",
            },
        ],
        [
            "You gain 1 life for each attacking creature you control.",
            "a combat role",
            /"combatRole" clause has no resolution-time count/,
        ],
        [
            "You gain 1 life for each creature on the battlefield.",
            "no controller",
            /no slot consumed/,
            {
                path: ["effect clause", "counted set", "object descriptor"],
                span: "creature on the battlefield",
            },
        ],
        // A zone the count does not name.
        [
            "You gain 1 life for each card in your graveyard.",
            "a graveyard",
            /permanents "you control"/,
        ],
        // A multiplier that is not a printed number.
        [
            "You gain X life for each Plains you control.",
            "an X multiplier",
            /no slot consumed/,
        ],
        // "its mana value" with no object acted on before it (CR 608.2h).
        [
            "You lose life equal to its mana value.",
            "nothing acted on",
            /names no object acted on/,
        ],
    ];

    for (const [line, why, reason, at] of REFUSED) {
        it(`refuses ${why}: ${line}`, () => {
            const outcome = compileCard(sorcery("Wrapper", "{2}{B}", line));
            expect(outcome.state).toBe("unparsed");
            if (outcome.state !== "unparsed") return;
            expect(outcome.gaps[0]!.reason).toMatch(reason);
            // A generic "no slot consumed" is what ANY unparsed line says, so
            // pin WHERE it was refused: the spell slot, down the sub-grammar
            // path, on exactly this span.
            if (reason.source.includes("no slot consumed"))
                expect(outcome.gaps[0]!.attribution).toMatchObject({
                    slot: "spell",
                    path: at?.path ?? ["effect clause"],
                    span: at?.span ?? line.replace(/\.$/, ""),
                });
        });
    }

    it("control: the same shapes compile once the refused clause is the printed one", () => {
        expect(
            refused(
                sorcery(
                    "Wrapper",
                    "{2}{B}",
                    "You gain 1 life for each creature you control."
                )
            )
        ).toBe(false);
    });
});

describe("life quantities — behaviour through the interpreter (issue #4136)", () => {
    /** Register `card`'s compiled definition under a test id for `fn`. */
    function withCompiled<T>(
        card: ReturnType<typeof oracleCard>,
        fn: (id: string) => T
    ): T {
        const id = `test-4136-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
        const definition = {
            ...compiled(card),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, () => fn(id));
    }

    const own = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, { id });
    const theirs = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p2",
            ownerId: "p2",
        });

    it("a drain moves exactly N from the target to the caster", () => {
        withCompiled(
            sorcery(
                "Drain Probe",
                "{B}",
                "Target player loses 3 life and you gain 3 life."
            ),
            (id) => {
                const state = makeState();
                const before = [
                    getPlayer(state, "p1").life,
                    getPlayer(state, "p2").life,
                ];
                pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
                resolveTopOfStack(state);
                expect([
                    getPlayer(state, "p1").life,
                    getPlayer(state, "p2").life,
                ]).toEqual([before[0]! + 3, before[1]! - 3]);
            }
        );
    });

    it("Landbind Ritual gains 2 per Plains and ignores every other land (CR 205.3i)", () => {
        withCompiled(
            sorcery(
                "Landbind Ritual",
                "{3}{W}{W}",
                "You gain 2 life for each Plains you control."
            ),
            (id) => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                own("Plains", "p1-plains-a"),
                                own("Plains", "p1-plains-b"),
                                own("Plains", "p1-plains-c"),
                                own("Swamp", "p1-swamp"),
                            ],
                        }),
                        makePlayer("p2", {
                            battlefield: [theirs("Plains", "p2-plains")],
                        }),
                    ],
                });
                const before = getPlayer(state, "p1").life;
                pushSpell(state, id, "p1");
                resolveTopOfStack(state);
                // 3 own Plains × 2; the opponent's Plains is not "you control".
                expect(getPlayer(state, "p1").life).toBe(before + 6);
            }
        );
    });

    it("the target opponent loses 2 per Swamp the CASTER controls", () => {
        withCompiled(
            sorcery(
                "Swamp Probe",
                "{B}",
                "Target opponent loses 2 life for each Swamp you control."
            ),
            (id) => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                own("Swamp", "p1-swamp-a"),
                                own("Swamp", "p1-swamp-b"),
                                own("Forest", "p1-forest"),
                            ],
                        }),
                        makePlayer("p2", {
                            battlefield: [theirs("Swamp", "p2-swamp")],
                        }),
                    ],
                });
                const before = [
                    getPlayer(state, "p1").life,
                    getPlayer(state, "p2").life,
                ];
                pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
                resolveTopOfStack(state);
                expect([
                    getPlayer(state, "p1").life,
                    getPlayer(state, "p2").life,
                ]).toEqual([before[0], before[1]! - 4]);
            }
        );
    });

    it("gains 1 per card in the TARGET opponent's hand, not the caster's", () => {
        withCompiled(
            sorcery(
                "Hand Probe",
                "{W}",
                "You gain 1 life for each card in target opponent's hand."
            ),
            (id) => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            hand: [own("Plains", "p1-h1")],
                        }),
                        makePlayer("p2", {
                            hand: [
                                theirs("Plains", "p2-h1"),
                                theirs("Plains", "p2-h2"),
                                theirs("Plains", "p2-h3"),
                                theirs("Plains", "p2-h4"),
                            ],
                        }),
                    ],
                });
                const before = getPlayer(state, "p1").life;
                pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
                resolveTopOfStack(state);
                expect(getPlayer(state, "p1").life).toBe(before + 4);
            }
        );
    });

    it("loses life equal to the DESTROYED creature's mana value (LKI snapshot, CR 608.2h)", () => {
        withCompiled(
            sorcery(
                "Snapshot Probe",
                "{B}",
                "Destroy target creature. You lose life equal to its mana value."
            ),
            (id) => {
                const angel = theirs("Serra Angel", "p2-angel"); // MV 5
                const state = makeState({
                    players: [
                        makePlayer("p1", {}),
                        makePlayer("p2", { battlefield: [angel] }),
                    ],
                });
                const before = getPlayer(state, "p1").life;
                pushSpell(state, id, "p1", [
                    { type: "permanent", id: "p2-angel" },
                ]);
                resolveTopOfStack(state);
                expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
                expect(getPlayer(state, "p1").life).toBe(before - 5);
            }
        );
    });
});
