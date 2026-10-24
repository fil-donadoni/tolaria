// Damage to "each of X targets" (CR 601.2c + CR 120.3).
//
//  1. GOLDEN fixtures — Meteor Blast and Firestorm compiled whole.
//  2. REFUSALS — neighbours the rule must not read (fail-closed).
//  3. RESOLUTION — the compiled definition through the real interpreter, a
//     creature AND a player among the announced set each take the damage.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getPlayer, resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function spell(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine,
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

const METEOR_BLAST = spell(
    "Meteor Blast",
    "{X}{R}{R}{R}",
    "Sorcery",
    "Meteor Blast deals 4 damage to each of X targets."
);

const FIRESTORM_TEXT =
    "As an additional cost to cast this spell, discard X cards.\nFirestorm deals X damage to each of X targets.";
const FIRESTORM = spell("Firestorm", "{R}", "Instant", FIRESTORM_TEXT);

describe("each of X targets — golden fixtures (CR 601.2c)", () => {
    it("spell · fixed damage (Meteor Blast)", () => {
        expect(sortKeys(compiled(METEOR_BLAST))).toEqual(
            sortKeys({
                name: "Meteor Blast",
                types: ["Sorcery"],
                manaCost: { X: "X", R: 3 },
                oracleText: "Meteor Blast deals 4 damage to each of X targets.",
                effects: [
                    {
                        op: "forEach",
                        select: { set: "targets" },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 4,
                                to: { ref: "$each" },
                            },
                        ],
                    },
                ],
                targetRequirement: { type: "any", count: "X" },
            })
        );
    });

    it("spell · X damage behind a discard-X cost (Firestorm)", () => {
        expect(sortKeys(compiled(FIRESTORM))).toEqual(
            sortKeys({
                name: "Firestorm",
                types: ["Instant"],
                manaCost: { R: 1 },
                oracleText: FIRESTORM_TEXT,
                additionalCosts: { discard: { count: "X" } },
                effects: [
                    {
                        op: "forEach",
                        select: { set: "targets" },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: { X: true },
                                to: { ref: "$each" },
                            },
                        ],
                    },
                ],
                targetRequirement: { type: "any", count: "X" },
            })
        );
    });
});

describe("each of X targets — refused neighbours (fail-closed)", () => {
    it.each([
        [
            "a descriptor after the count (X target creatures)",
            "Probe deals 4 damage to each of X target creatures.",
        ],
        [
            "a printed count instead of X",
            "Probe deals 4 damage to each of two targets.",
        ],
        [
            "a source that announces no {X}",
            "Probe deals 4 damage to each of X targets.",
            "{R}{R}{R}",
        ],
    ])("refuses %s", (_label, text, cost = "{X}{R}{R}{R}") => {
        expect(compileCard(spell("Probe", cost, "Sorcery", text)).state).toBe(
            "unparsed"
        );
    });

    it("refuses the sweep behind another target group", () => {
        expect(
            compileCard(
                spell(
                    "Probe",
                    "{X}{R}{R}{R}",
                    "Sorcery",
                    "Destroy target creature.\nProbe deals 4 damage to each of X targets."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("each of X targets — resolution through the interpreter", () => {
    const BEAR = getCardByName("Serra Angel").id;

    function withCompiled<T>(
        card: ReturnType<typeof oracleCard>,
        fn: (id: string) => T
    ): T {
        const id = `test-5696-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
        const definition = {
            ...compiled(card),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, () => fn(id));
    }

    function board() {
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEAR, {
                            controllerId: "p2",
                            ownerId: "p2",
                            id: "bear",
                        }),
                    ],
                }),
            ],
        });
    }

    it("deals the whole amount to a creature AND a player of the set", () => {
        withCompiled(METEOR_BLAST, (id) => {
            const state = board();
            const life = getPlayer(state, "p2").life;
            pushSpell(state, id, "p1", [
                { type: "permanent", id: "bear" },
                { type: "player", id: "p2" },
            ]);
            resolveTopOfStack(state);
            expect(
                getPlayer(state, "p2").battlefield.find((c) => c.id === "bear")
                    ?.damageMarked
            ).toBe(4);
            expect(getPlayer(state, "p2").life).toBe(life - 4);
        });
    });

    it("reads the announced X for the amount (Firestorm)", () => {
        withCompiled(FIRESTORM, (id) => {
            const state = board();
            const life = getPlayer(state, "p2").life;
            const item = pushSpell(state, id, "p1", [
                { type: "player", id: "p2" },
                { type: "permanent", id: "bear" },
            ]);
            item.chosenX = 2;
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2").life).toBe(life - 2);
            expect(
                getPlayer(state, "p2").battlefield.find((c) => c.id === "bear")
                    ?.damageMarked
            ).toBe(2);
        });
    });
});
