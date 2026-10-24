// "Up to X target cards … where X is the number of …" (CR 601.2c + CR 107.3).
//
//  1. GOLDEN — Reap compiled whole.
//  2. REFUSALS — neighbours the rule must not read (fail-closed).
//  3. RESOLUTION — the compiled definition through the real interpreter: only
//     the announced graveyard cards move, never the opponent picked first.

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

const REAP_TEXT =
    "Return up to X target cards from your graveyard to your hand, where X is the number of black permanents target opponent controls as you cast this spell.";

function instant(text: string, name = "Reap") {
    return oracleCard({
        name,
        manaCost: "{1}{G}",
        typeLine: "Instant",
        oracleText: text,
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

describe("text-defined target count — golden fixture (CR 601.2c)", () => {
    it("spell · up to X cards bounded by the opponent's black permanents (Reap)", () => {
        expect(sortKeys(compiled(instant(REAP_TEXT)))).toEqual(
            sortKeys({
                name: "Reap",
                types: ["Instant"],
                manaCost: { X: 1, G: 1 },
                oracleText: REAP_TEXT,
                effects: [
                    {
                        op: "forEach",
                        select: { set: "targets", zone: "graveyard" },
                        effects: [
                            {
                                op: "moveZone",
                                target: { ref: "$each" },
                                from: "graveyard",
                                to: "hand",
                            },
                        ],
                    },
                ],
                targetRequirement: {
                    type: "player",
                    count: 1,
                    controller: "opponent",
                },
                additionalTargetRequirements: [
                    {
                        type: "card",
                        count: {
                            min: 0,
                            max: {
                                count: {
                                    zone: "battlefield",
                                    controller: { target: 0 },
                                    filter: { color: "B" },
                                },
                            },
                        },
                        zone: "graveyard",
                        controller: "you",
                    },
                ],
            })
        );
    });
});

describe("text-defined target count — refused neighbours (fail-closed)", () => {
    it.each([
        [
            "a bound read at resolution instead of cast",
            REAP_TEXT.replace(" as you cast this spell", ""),
        ],
        [
            "a count of your own permanents",
            REAP_TEXT.replace("target opponent controls", "you control"),
        ],
        [
            "a hand destination other than yours",
            REAP_TEXT.replace("to your hand", "to the battlefield"),
        ],
        [
            "a creature-card descriptor",
            REAP_TEXT.replace("target cards", "target creature cards"),
        ],
        [
            "a bound clause past colour and type",
            REAP_TEXT.replace("black permanents", "tapped permanents"),
        ],
        [
            "two colours in the bound",
            REAP_TEXT.replace("black permanents", "black and red permanents"),
        ],
        [
            "a bare X with no definition",
            "Return up to X target cards from your graveyard to your hand.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(instant(text, "Probe")).state).toBe("unparsed");
    });

    it("refuses a target group announced behind the text-bounded one", () => {
        // The bounded group's width is a fact about the cast, so a later
        // group's positional slot could not be written down (CR 601.2c).
        expect(
            compileCard(instant(`${REAP_TEXT} Destroy target creature.`)).state
        ).toBe("unparsed");
    });

    it("refuses a graveyard group announced before the bounded one", () => {
        // The sweep reads every announced graveyard card, so an earlier group
        // naming one would be swept with Reap's picks.
        expect(
            compileCard(
                instant(
                    `Return target creature card from your graveyard to your hand. ${REAP_TEXT}`
                )
            ).state
        ).toBe("unparsed");
    });

    it("refuses the bound outside a spell (no cast to fix the count at)", () => {
        expect(
            compileCard(
                oracleCard({
                    name: "Probe",
                    manaCost: "{1}{G}",
                    typeLine: "Creature — Elf",
                    oracleText: `{T}: ${REAP_TEXT}`,
                    power: "1",
                    toughness: "1",
                })
            ).state
        ).toBe("unparsed");
    });

    it("reads the opponent's slot, not slot 0, behind a fixed-width group", () => {
        const definition = compiled(
            instant(`Destroy target creature. ${REAP_TEXT}`)
        );
        expect(
            definition.additionalTargetRequirements?.[1]?.count
        ).toMatchObject({ max: { count: { controller: { target: 1 } } } });
    });
});

describe("text-defined target count — resolution through the interpreter", () => {
    const BEAR = getCardByName("Grizzly Bears").id;
    const KNIGHT = getCardByName("Black Knight").id;

    function withReap<T>(fn: (id: string) => T): T {
        const id = "test-5703-reap";
        const definition = {
            ...compiled(instant(REAP_TEXT)),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, () => fn(id));
    }

    function board() {
        return makeState({
            players: [
                makePlayer("p1", {
                    graveyard: ["gy-a", "gy-b", "gy-c"].map((id) =>
                        makeInstance(BEAR, {
                            id,
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        })
                    ),
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(KNIGHT, {
                            id: "knight",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    it("returns exactly the announced graveyard cards to hand, not the opponent", () => {
        withReap((id) => {
            const state = board();
            pushSpell(state, id, "p1", [
                { type: "player", id: "p2" },
                { type: "graveyard-card", id: "gy-a", playerId: "p1" },
            ]);
            resolveTopOfStack(state);
            const p1 = getPlayer(state, "p1");
            expect(p1.hand.map((c) => c.id)).toEqual(["gy-a"]);
            // The resolved instant itself lands in the graveyard.
            expect(p1.graveyard.map((c) => c.id)).toEqual(
                expect.arrayContaining(["gy-b", "gy-c"])
            );
            expect(p1.graveyard.map((c) => c.id)).not.toContain("gy-a");
        });
    });

    it("returns nothing when no card was announced (X = 0)", () => {
        withReap((id) => {
            const state = board();
            pushSpell(state, id, "p1", [{ type: "player", id: "p2" }]);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p1").hand).toHaveLength(0);
            expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toEqual(
                expect.arrayContaining(["gy-a", "gy-b", "gy-c"])
            );
        });
    });
});
