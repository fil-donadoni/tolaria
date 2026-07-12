// Per-card behavior tests for INV gold cards (`convex/cards/sets/inv/multicolor.ts`).
// Both cards belong to the Domain capability cluster (issue #1066). The
// `{ domain: { of } }` value member and the `winGame` Op each already have
// their own permanent interpreter test (`convex/gre/effects/__tests__/interpreter.test.ts`)
// per the new-construct regime (ADR 0045) — the tests here assert the
// CARD-level wiring: Ordered Migration's Domain-scaled token count, and
// Coalition Victory's compound win predicate (both clauses required).

import { describe, it, expect } from "vitest";
import { orderedMigration, coalitionVictory } from "../multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { plains, island, swamp, mountain, forest } from "../../lea/colorless";
import { registerTokenDefinition } from "../../..";

describe("Ordered Migration (CR 111 / 701.7 token creation, Domain, issue #1066)", () => {
    it("creates one 1/1 blue flying Bird per basic land type controlled", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "om-pl",
                            controllerId: "p1",
                        }),
                        makeInstance(island.id, {
                            id: "om-is",
                            controllerId: "p1",
                        }),
                        makeInstance(swamp.id, {
                            id: "om-sw",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, orderedMigration.id, "p1");
        resolveTopOfStack(state);
        const birds = state.players[0].battlefield.filter(
            (c) => c.id !== "om-pl" && c.id !== "om-is" && c.id !== "om-sw"
        );
        expect(birds).toHaveLength(3);
        for (const bird of birds) {
            expect(bird.power).toBe(1);
            expect(bird.toughness).toBe(1);
            expect(bird.staticAbilities).toContain("flying");
        }
    });

    it("creates no tokens for a player with no basic lands", () => {
        const state = makeState();
        pushSpell(state, orderedMigration.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

describe("Coalition Victory (CR 104.2a alternate win, Domain, issue #1066)", () => {
    /** Five distinct basic lands (Domain 5) plus one creature per color,
     *  swappable per test so exactly one clause can be dropped at a time. */
    function fullBoard(overrides: {
        omitLand?: "Plains" | "Island" | "Swamp" | "Mountain" | "Forest";
        omitColor?: "W" | "U" | "B" | "R" | "G";
    }) {
        const lands = [
            { def: plains, subtype: "Plains" },
            { def: island, subtype: "Island" },
            { def: swamp, subtype: "Swamp" },
            { def: mountain, subtype: "Mountain" },
            { def: forest, subtype: "Forest" },
        ]
            .filter((l) => l.subtype !== overrides.omitLand)
            .map((l, i) =>
                makeInstance(l.def.id, {
                    id: `cv-land-${i}`,
                    controllerId: "p1",
                })
            );

        const colorCards: Record<"W" | "U" | "B" | "R" | "G", string> = {
            W: "test-cv-white",
            U: "test-cv-blue",
            B: "test-cv-black",
            R: "test-cv-red",
            G: "test-cv-green",
        };
        for (const [color, id] of Object.entries(colorCards)) {
            registerTokenDefinition({
                id,
                name: id,
                rarity: "common",
                manaCost: { [color]: 1 },
                types: ["Creature"],
                power: 1,
                toughness: 1,
            });
        }
        const creatures = (
            Object.entries(colorCards) as [
                "W" | "U" | "B" | "R" | "G",
                string,
            ][]
        )
            .filter(([color]) => color !== overrides.omitColor)
            .map(([color, id], i) =>
                makeInstance(id, {
                    id: `cv-creature-${color}-${i}`,
                    controllerId: "p1",
                })
            );

        return makeState({
            players: [
                makePlayer("p1", { battlefield: [...lands, ...creatures] }),
                makePlayer("p2"),
            ],
        });
    }

    it("wins when the controller has a land of each basic type AND a creature of each color", () => {
        const state = fullBoard({});
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });

    it("does NOT win when missing one basic land type (Domain 4)", () => {
        const state = fullBoard({ omitLand: "Forest" });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toBeUndefined();
    });

    it("does NOT win when missing a creature of one color", () => {
        const state = fullBoard({ omitColor: "G" });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toBeUndefined();
    });

    it("a multicolour creature covers each of its colors", () => {
        // 5 basic lands + ONE Naya-style tri-color creature (W/R/G) + mono U
        // + mono B creatures — still covers all five colors with fewer
        // creatures than five.
        const lands = [plains, island, swamp, mountain, forest].map((def, i) =>
            makeInstance(def.id, {
                id: `cv-multi-land-${i}`,
                controllerId: "p1",
            })
        );
        const triId = "test-cv-tricolor";
        registerTokenDefinition({
            id: triId,
            name: triId,
            rarity: "common",
            manaCost: { W: 1, R: 1, G: 1 },
            types: ["Creature"],
            power: 3,
            toughness: 3,
        });
        registerTokenDefinition({
            id: "test-cv-mono-u2",
            name: "test-cv-mono-u2",
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        registerTokenDefinition({
            id: "test-cv-mono-b2",
            name: "test-cv-mono-b2",
            rarity: "common",
            manaCost: { B: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        const creatures = [
            makeInstance(triId, { id: "cv-tri", controllerId: "p1" }),
            makeInstance("test-cv-mono-u2", {
                id: "cv-u2",
                controllerId: "p1",
            }),
            makeInstance("test-cv-mono-b2", {
                id: "cv-b2",
                controllerId: "p1",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [...lands, ...creatures] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, coalitionVictory.id, "p1");
        resolveTopOfStack(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });
});
