// "… with mana value N or less" on a mass subject — CR 202.3 (issue #8865).
// A PRINTED ceiling is the sweep filter's `manaValueAtMost` literal 1:1, so it
// rides the selector every consumer of the mass subject already passes through
// whole. The announced-X ceiling keeps its own `if` lowering (Pernicious Deed,
// `massSubject.test.ts`); a floor ("3 or greater") and an exact "mana value X"
// stay refused.
//
// Goldens: Culling Sun (`each <singular>`), Ritual of Soot (`all <plural>`),
// Pest Control (`all nonland permanents`), Granulate (`each nonland artifact`),
// Brotherhood's End (a mode of a modal spell). The smoke generator seeds the
// ceiling (a member AT it, a bystander one above), so each reaches `ready` with
// no GOLDEN_FIXTURES row.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function spell(
    name: string,
    manaCost: string,
    oracleText: string,
    typeLine = "Sorcery"
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

function expectDefinition(
    card: ReturnType<typeof oracleCard>,
    expected: Record<string, unknown>
) {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

function refusal(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} compiled: expected a refusal`);
    return outcome.gaps[0]!.attribution;
}

function destroyEach(filter: Record<string, unknown>) {
    return {
        op: "forEach",
        select: { set: "permanents", zone: "battlefield", filter },
        effects: [{ op: "destroy", target: { ref: "$each" } }],
    };
}

describe("Mass subject with a printed mana value ceiling — golden fixtures (CR 202.3)", () => {
    it("each <singular> with mana value N or less: Culling Sun", () => {
        expectDefinition(
            spell(
                "Culling Sun",
                "{2}{W}{W}{B}",
                "Destroy each creature with mana value 3 or less."
            ),
            {
                name: "Culling Sun",
                types: ["Sorcery"],
                manaCost: { X: 2, W: 2, B: 1 },
                oracleText: "Destroy each creature with mana value 3 or less.",
                effects: [
                    destroyEach({ type: "Creature", manaValueAtMost: 3 }),
                ],
            }
        );
    });

    it("all <plural> with mana value N or less: Ritual of Soot", () => {
        expectDefinition(
            spell(
                "Ritual of Soot",
                "{2}{B}{B}",
                "Destroy all creatures with mana value 3 or less."
            ),
            {
                name: "Ritual of Soot",
                types: ["Sorcery"],
                manaCost: { X: 2, B: 2 },
                oracleText: "Destroy all creatures with mana value 3 or less.",
                effects: [
                    destroyEach({ type: "Creature", manaValueAtMost: 3 }),
                ],
            }
        );
    });

    it("all nonland permanents with mana value N or less: Pest Control", () => {
        const definition = compiled(
            spell(
                "Pest Control",
                "{W}{B}",
                "Destroy all nonland permanents with mana value 1 or less.\nCycling {2} ({2}, Discard this card: Draw a card.)"
            )
        );
        expect(definition.effects).toEqual([
            destroyEach({ excludeType: "Land", manaValueAtMost: 1 }),
        ]);
    });

    it("each nonland <type> with mana value N or less: Granulate", () => {
        expectDefinition(
            spell(
                "Granulate",
                "{2}{R}{R}",
                "Destroy each nonland artifact with mana value 4 or less."
            ),
            {
                name: "Granulate",
                types: ["Sorcery"],
                manaCost: { X: 2, R: 2 },
                oracleText:
                    "Destroy each nonland artifact with mana value 4 or less.",
                effects: [
                    destroyEach({
                        type: "Artifact",
                        excludeType: "Land",
                        manaValueAtMost: 4,
                    }),
                ],
            }
        );
    });

    it("the ceiling inside a mode of a modal spell: Brotherhood's End", () => {
        const definition = compiled(
            spell(
                "Brotherhood's End",
                "{1}{R}{R}",
                "Choose one —\n• Brotherhood's End deals 3 damage to each creature and each planeswalker.\n• Destroy all artifacts with mana value 3 or less."
            )
        );
        expect(definition.modes?.[1]?.effects).toEqual([
            destroyEach({ type: "Artifact", manaValueAtMost: 3 }),
        ]);
    });
});

describe("Mass subject with a mana value bound — refusals (fail closed)", () => {
    it("refuses a floor: only a ceiling is read", () => {
        expect(
            refusal(
                spell(
                    "Test",
                    "{2}{B}",
                    "Destroy each creature with mana value 3 or greater."
                )
            )
        ).toMatchObject({
            path: ["effect clause", "mass subject"],
            span: "mvFilter",
        });
    });

    it('refuses an exact "mana value X": Crime // Punishment', () => {
        expect(
            refusal(
                spell(
                    "Punishment",
                    "{X}{B}{G}",
                    "Destroy each artifact, creature, and enchantment with mana value X."
                )
            )
        ).toMatchObject({
            path: ["effect clause", "mass subject"],
            span: "mvFilter",
        });
    });
});

describe("Mass subject with a printed mana value ceiling — behaviour through the interpreter", () => {
    function ids(state: GameState, player: number) {
        return state.players[player]!.battlefield.map((c) => c.id).sort();
    }

    it("Culling Sun destroys creatures AT and under the ceiling on both sides, sparing the rest", () => {
        const definition = {
            ...compiled(
                spell(
                    "Culling Sun",
                    "{2}{W}{W}{B}",
                    "Destroy each creature with mana value 3 or less."
                )
            ),
            id: "test-mv-ceiling-culling-sun",
            rarity: "common",
        } as unknown as CardDefinition;
        withTemporaryDefinition(definition, () => {
            const bears = getCardByName("Grizzly Bears").id; // MV 2
            const angel = getCardByName("Serra Angel").id; // MV 5
            const ogre = getCardByName("Gray Ogre").id; // MV 3, AT the ceiling
            const ring = getCardByName("Sol Ring").id; // MV 1, not a creature
            const p2 = { controllerId: "p2", ownerId: "p2" };
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(bears, { id: "p1-bears" }),
                            makeInstance(angel, { id: "p1-angel" }),
                            makeInstance(ring, { id: "p1-ring" }),
                        ],
                    }),
                    makePlayer("p2", {
                        battlefield: [
                            makeInstance(bears, { id: "p2-bears", ...p2 }),
                            makeInstance(ogre, { id: "p2-ogre", ...p2 }),
                            makeInstance(angel, { id: "p2-angel", ...p2 }),
                        ],
                    }),
                ],
            });
            state.stack.push({
                ...makeInstance(definition.id, { id: "sun" }),
                zone: "stack",
                castById: "p1",
                targets: [],
            });
            resolveTopOfStack(state);
            expect(ids(state, 0)).toEqual(["p1-angel", "p1-ring"]);
            expect(ids(state, 1)).toEqual(["p2-angel"]);
        });
    });
});
