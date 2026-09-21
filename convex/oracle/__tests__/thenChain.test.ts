// Token creation followed by ", then <clause>" (CR 111.1 / CR 608.2c,
// issue #4250).
//
//  1. GOLDEN — a real corpus card compiled whole: Hire a Crew, the one card
//     whose only gap was this connector and whose second clause the grammar
//     already read (a mass pump).
//  2. EQUIVALENCE — the comma form lowers to EXACTLY the script the full-stop
//     form does, for every second-clause kind the grammar reads today.
//  3. REFUSALS — a second clause the grammar does not read fails the sentence
//     with THAT clause's own reason; a tail that points back at the token, a
//     tail that is not an effect, a chain of chains and an unreadable head
//     stay refused.
//  4. BEHAVIOUR — the two Ops run in order through the real interpreter, so
//     the second one sees the tokens the first created (the point of "then").

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
import { getEffectivePower } from "../../gre/layers";
import { getPlayer, resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sentenceRule } from "../grammar/shared/effectClause";
import { sortKeys } from "../gates";
import { oracleCard, parseContext } from "./fixtures";

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

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const effectsOf = (text: string) =>
    sortKeys(compiled(sorcery("Then Probe", "{2}{W}", text)).effects);

const refusal = (text: string) => {
    const outcome = compileCard(sorcery("Then Probe", "{2}{W}", text));
    if (outcome.state !== "unparsed")
        throw new Error(`"${text}" compiled: ${outcome.state}`);
    return outcome.gaps[0]!;
};

describe("then-chain — golden (CR 608.2c)", () => {
    it("Hire a Crew: a token, then a mass pump that reaches the token", () => {
        const oracleText =
            "Create a 2/1 black Villain creature token with menace, then creatures you control get +1/+0 until end of turn. (A creature with menace can't be blocked except by two or more creatures.)";
        expect(
            sortKeys(
                compiled({
                    oracleId: "6eb7a870-b626-4326-9e4c-45193f8ce138",
                    name: "Hire a Crew",
                    manaCost: "{2}{R}",
                    typeLine: "Instant",
                    oracleText,
                    layout: "normal",
                })
            )
        ).toEqual(
            sortKeys({
                name: "Hire a Crew",
                types: ["Instant"],
                manaCost: { X: 2, R: 1 },
                oracleText,
                effects: [
                    {
                        op: "createToken",
                        token: {
                            name: "Villain",
                            types: ["Creature"],
                            subtypes: ["Villain"],
                            power: 2,
                            toughness: 1,
                            colors: ["B"],
                            staticAbilities: ["menace"],
                        },
                        controller: "controller",
                    },
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
                                power: 1,
                                toughness: 0,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("then-chain — equal to the full-stop form (CR 608.2c)", () => {
    const HEADS = [
        "Create two 1/1 white Soldier creature tokens",
        "Create two 1/1 white Soldier creature tokens with flying",
        "Create a 1/1 white Soldier creature token",
    ];
    const TAILS = [
        "you gain 1 life for each creature you control",
        "draw a card",
        "creatures you control get +1/+0 until end of turn",
    ];
    for (const head of HEADS)
        for (const tail of TAILS)
            it(`"${head}, then ${tail}" = "${head}. ${tail[0]!.toUpperCase()}${tail.slice(1)}."`, () => {
                expect(effectsOf(`${head}, then ${tail}.`)).toEqual(
                    effectsOf(
                        `${head}. ${tail[0]!.toUpperCase()}${tail.slice(1)}.`
                    )
                );
            });

    it("Depose // Deploy's second half reads: the count is the whole controlled set", () => {
        const effects = effectsOf(
            "Create two 1/1 white Soldier creature tokens with flying, then you gain 1 life for each creature you control."
        );
        expect(effects.map((e) => e.op)).toEqual(["createToken", "gainLife"]);
    });
});

describe("then-chain — refusals (fail-closed)", () => {
    it("an unreadable second clause is refused with THAT clause's span: then populate", () => {
        const gap = refusal(
            "Create a 3/3 green Centaur creature token, then populate."
        );
        expect(gap.attribution?.span).toBe("Populate");
        expect(gap.attribution?.path).toContain("effect clause");
    });

    it("the same clause after a full stop is refused at the same span", () => {
        const comma = refusal(
            "Create a 3/3 green Centaur creature token, then populate."
        );
        const stop = refusal(
            "Create a 3/3 green Centaur creature token. Populate."
        );
        expect(comma.attribution?.span).toBe(stop.attribution?.span);
    });

    it("a tail that names the token ('it', 'that token') stays refused: the site binds those to another object", () => {
        for (const tail of [
            "put a +1/+1 counter on it",
            "put a +1/+1 counter on that token",
            "attach this Equipment to it",
        ])
            expect(
                compileCard(
                    sorcery(
                        "Then Probe",
                        "{2}{W}",
                        `Create a 2/2 green Wolf creature token, then ${tail}.`
                    )
                ).state
            ).toBe("unparsed");
    });

    it("a second connector is refused: the corpus prints no chain of three", () => {
        expect(
            compileCard(
                sorcery(
                    "Then Probe",
                    "{2}{W}",
                    "Create a 1/1 white Soldier creature token, then create a 1/1 white Soldier creature token, then draw a card."
                )
            ).state
        ).toBe("unparsed");
    });

    it("an unreadable head is refused under the token rule's own reason", () => {
        const result = sentenceRule.run(
            "Create a Food token, then draw a card",
            parseContext()
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/token creation/);
    });

    it("a tail that is not an effect is refused: an activation restriction", () => {
        const result = sentenceRule.run(
            "Create a 1/1 white Soldier creature token, then activate only as a sorcery",
            parseContext()
        );
        expect(result.ok).toBe(false);
    });

    it("only a token-creation head opens the connector: a bare pair is not read", () => {
        expect(
            compileCard(
                sorcery("Then Probe", "{2}{W}", "Scry 1, then draw a card.")
            ).state
        ).toBe("unparsed");
    });
});

describe("then-chain — behaviour through the interpreter (CR 608.2c)", () => {
    function withCompiled<T>(
        card: ReturnType<typeof oracleCard>,
        fn: (id: string) => T
    ): T {
        const id = `test-4250-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
        const definition = {
            ...compiled(card),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, () => fn(id));
    }

    const bears = () => getCardByName("Grizzly Bears").id;

    it("the life gain counts the tokens the same sentence just created", () => {
        withCompiled(
            sorcery(
                "Deploy Probe",
                "{2}{W}",
                "Create two 1/1 white Soldier creature tokens, then you gain 1 life for each creature you control."
            ),
            (id) => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                makeInstance(bears(), { id: "p1-bears-a" }),
                                makeInstance(bears(), { id: "p1-bears-b" }),
                            ],
                        }),
                        makePlayer("p2", {
                            battlefield: [
                                makeInstance(bears(), {
                                    id: "p2-bears",
                                    controllerId: "p2",
                                    ownerId: "p2",
                                }),
                            ],
                        }),
                    ],
                });
                const before = getPlayer(state, "p1").life;
                pushSpell(state, id, "p1");
                resolveTopOfStack(state);
                // 2 Grizzly Bears + 2 fresh Soldiers; the opponent's is not "you control".
                expect(getPlayer(state, "p1").life).toBe(before + 4);
                expect(
                    state.players[0]!.battlefield.filter((c) =>
                        c.subtypes.includes("Soldier")
                    )
                ).toHaveLength(2);
            }
        );
    });

    it("Hire a Crew's pump reaches the Villain it just made", () => {
        withCompiled(
            oracleCard({
                name: "Hire a Crew",
                manaCost: "{2}{R}",
                typeLine: "Instant",
                oracleText:
                    "Create a 2/1 black Villain creature token with menace, then creatures you control get +1/+0 until end of turn.",
                power: undefined,
                toughness: undefined,
            }),
            (id) => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                makeInstance(bears(), { id: "p1-bears" }),
                            ],
                        }),
                        makePlayer("p2"),
                    ],
                });
                pushSpell(state, id, "p1");
                resolveTopOfStack(state);
                const battlefield = state.players[0]!.battlefield;
                const villain = battlefield.find((c) =>
                    c.subtypes.includes("Villain")
                )!;
                const bear = battlefield.find((c) => c.id === "p1-bears")!;
                expect(getEffectivePower(state, villain)).toBe(3);
                expect(getEffectivePower(state, bear)).toBe(3);
            }
        );
    });
});
