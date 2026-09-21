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

describe("then-chain — golden: the split card that motivated it (CR 608.2c, CR 709.3)", () => {
    it("Depose // Deploy: Deploy's second half is a token, then a life gain", () => {
        const deploy =
            "Create two 1/1 colorless Thopter artifact creature tokens with flying, then you gain 1 life for each creature you control.";
        const depose = "Tap target creature.\nDraw a card.";
        const definition = compiled({
            oracleId: "c547c9ab-a303-48fb-9579-37f9de9a558b",
            name: "Depose // Deploy",
            manaCost: "{1}{W/U} // {2}{W}{U}",
            typeLine: "Instant // Instant",
            oracleText: "",
            layout: "split",
            faces: [
                {
                    name: "Depose",
                    manaCost: "{1}{W/U}",
                    typeLine: "Instant",
                    oracleText: depose,
                },
                {
                    name: "Deploy",
                    manaCost: "{2}{W}{U}",
                    typeLine: "Instant",
                    oracleText: deploy,
                },
            ],
        });
        expect(sortKeys(definition.splitHalves?.[1])).toEqual(
            sortKeys({
                name: "Deploy",
                manaCost: { X: 2, W: 1, U: 1 },
                types: ["Instant"],
                oracleText: deploy,
                effects: [
                    {
                        op: "createToken",
                        token: {
                            name: "Thopter",
                            types: ["Artifact", "Creature"],
                            subtypes: ["Thopter"],
                            power: 1,
                            toughness: 1,
                            colors: [],
                            staticAbilities: ["flying"],
                        },
                        controller: "controller",
                        count: 2,
                    },
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

    it("Deploy's own line: the comma form equals the full-stop form and lowers to token then gain", () => {
        const head =
            "Create two 1/1 colorless Thopter artifact creature tokens with flying";
        const tail = "you gain 1 life for each creature you control";
        const comma = effectsOf(`${head}, then ${tail}.`);
        expect(comma).toEqual(
            effectsOf(`${head}. You gain 1 life for each creature you control.`)
        );
        expect((comma as { op: string }[]).map((e) => e.op)).toEqual([
            "createToken",
            "gainLife",
        ]);
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

    /** The sentence grammar's own answer for `head, then <tail>`. */
    const readChain = (head: string, tail: string) =>
        sentenceRule.run(`${head}, then ${tail}`, parseContext());
    const WOLF = "Create a 2/2 green Wolf creature token";

    // One tail per alternative of the pronoun guard, so deleting any single
    // word from it reds exactly that row. The reason is the guard's own: a
    // tail the clause grammar reads or refuses for another reason would pass
    // an `ok === false` check with the guard gone.
    it.each([
        ["it", "put a +1/+1 counter on it"],
        ["its", "you gain life equal to its power"],
        ["them", "put a +1/+1 counter on them"],
        ["they", "they gain haste until end of turn"],
        ["their", "their controller draws a card"],
        ["that token", "put a +1/+1 counter on that token"],
        ["those tokens", "tap those tokens"],
        ["that creature", "tap that creature"],
        ["those creatures", "tap those creatures"],
    ])(
        "a tail naming the token ('%s') is refused: its referent is the site's object, not the token",
        (_word, tail) => {
            const result = readChain(WOLF, tail);
            expect(result.ok).toBe(false);
            if (!result.ok)
                expect(result.reason).toMatch(/points back at the token/);
        }
    );

    it("a second connector is refused as a tail that is not one effect: the corpus prints no chain of three", () => {
        const result = readChain(
            "Create a 1/1 white Soldier creature token",
            "create a 1/1 white Soldier creature token, then draw a card"
        );
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.reason).toMatch(
                /continues with an effect, not a then-chain/
            );
    });

    it("an unreadable head is refused on the HEAD span, under the token rule's own reason", () => {
        const result = readChain("Create a Food token", "draw a card");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toMatch(/token creation/);
            expect(result.fragment).toBe("Create a Food token");
        }
    });

    it("a tail that is not an effect is refused: an activation restriction", () => {
        const result = readChain(
            "Create a 1/1 white Soldier creature token",
            "activate only as a sorcery"
        );
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.reason).toMatch(
                /continues with an effect, not a restriction/
            );
    });

    it("only a token-creation head opens the connector: the loot pattern is still read by its own rule", () => {
        const loot = compiled(
            sorcery("Then Probe", "{1}{U}", "Draw a card, then discard a card.")
        ).effects as { op: string }[];
        expect(loot.map((e) => e.op)).toEqual(["draw", "choice", "discard"]);
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
