// Attack prohibition (issue #5310) — "<Colour> creatures can't attack you",
// CR 508.1c: a restriction the source's controller imposes on the creatures
// that would attack them. The golden compiles the real Oracle line (Elephant
// Grass's other two lines are other forms and stay out of the card, so the
// definition under test is this clause alone); refusals pin the printed
// neighbours; the behaviour block runs the rebuilt effect through the engine's
// own scan (`globalAttackProhibitionReason`).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { globalAttackProhibitionReason } from "../../cards/attackRestrictions";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const LINE = "Black creatures can't attack you.";

const WARD: OracleCard = {
    oracleId: "53cc4b93-538d-4193-8bbb-5b73d3ce9d79",
    name: "Elephant Grass",
    manaCost: "{G}",
    typeLine: "Enchantment",
    oracleText: LINE,
};

const line = (oracleText: string): OracleCard => ({
    ...WARD,
    oracleId: "neighbour",
    name: "Neighbour",
    oracleText,
});

describe("attack prohibition — golden", () => {
    it("a colour word before creatures (CR 508.1c)", () => {
        const outcome = compileCard(WARD);
        expect(outcome.state, JSON.stringify(outcome)).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Elephant Grass",
                types: ["Enchantment"],
                manaCost: { G: 1 },
                oracleText: LINE,
                compiledStaticEffects: [
                    {
                        kind: "attack-prohibition",
                        id: "elephant-grass-attack-ban",
                        oracleText: LINE,
                        attackers: { types: ["Creature"], colors: "B" },
                    },
                ],
            })
        );
    });
});

describe("attack prohibition — refused neighbours", () => {
    it("REFUSES a negated colour (Elephant Grass, Nonblack)", () => {
        expect(
            compileCard(line("Nonblack creatures can't attack you.")).state
        ).toBe("unparsed");
    });

    it("REFUSES the payment rider", () => {
        expect(
            compileCard(
                line(
                    "Black creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."
                )
            ).state
        ).toBe("unparsed");
    });

    it("REFUSES a non-colour qualifier", () => {
        expect(
            compileCard(line("Flying creatures can't attack you.")).state
        ).toBe("unparsed");
    });
});

const creature = (id: string, cost: CardDefinition["manaCost"]) =>
    ({
        id,
        name: id,
        rarity: "common",
        types: ["Creature"],
        manaCost: cost,
        power: 2,
        toughness: 2,
    }) as CardDefinition;

describe("attack prohibition — behaviour through the engine (CR 508.1c)", () => {
    it("forbids opposing black creatures only", () => {
        const outcome = compileCard(WARD);
        if (outcome.state === "unparsed") throw new Error("unparsed");
        const ward: CardDefinition = {
            ...outcome.definition,
            id: WARD.oracleId,
            rarity: "common",
        };
        const black = creature("ban-test-black", { B: 1 });
        const green = creature("ban-test-green", { G: 1 });
        withTemporaryDefinition(ward, () =>
            withTemporaryDefinition(black, () =>
                withTemporaryDefinition(green, () => {
                    const state = makeState({
                        players: [
                            makePlayer("p1", {
                                battlefield: [
                                    makeInstance(ward.id, { id: "w" }),
                                    makeInstance(black.id, { id: "own-b" }),
                                ],
                            }),
                            makePlayer("p2", {
                                battlefield: [
                                    makeInstance(black.id, {
                                        id: "opp-b",
                                        controllerId: "p2",
                                    }),
                                    makeInstance(green.id, {
                                        id: "opp-g",
                                        controllerId: "p2",
                                    }),
                                ],
                            }),
                        ],
                    });
                    const on = (pid: string, id: string) =>
                        state.players
                            .find((p) => p.id === pid)!
                            .battlefield.find((c) => c.id === id)!;
                    const reason = (pid: string, id: string) =>
                        globalAttackProhibitionReason(
                            on(pid, id) as never,
                            state as never
                        );
                    expect(reason("p2", "opp-b")).toBe(LINE);
                    expect(reason("p2", "opp-g")).toBeUndefined();
                    // Directed at "you": the controller's own black creature
                    // is not restricted.
                    expect(reason("p1", "own-b")).toBeUndefined();
                })
            )
        );
    });
});
