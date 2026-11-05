// Undaunted (CR 702.125): the `getDefinition` expansion seam, the cost the real
// cast path folds (`getCostModifiers` + `applyCostModifiers`), castability
// through `getLegalActions`, the wire projection, and the compiler's verdict on
// a printed and on a granted undaunted.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../../gameProjections";
import { getLegalActions } from "../../../gre/rules";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    type GameState,
    type PlayerState,
} from "../../../gre/state";
import { oracleCard } from "../../../oracle/__tests__/oracle.fixture";
import { compileCard } from "../../../oracle/compile";
import { getDefinition, preloadDefinitions } from "../..";
import { expandDefinition } from "../../registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../__tests__/setup.helper";
import type { CardDefinition } from "../../types";
import { expandUndaunted } from "../undaunted";

function registerSorcery(
    id: string,
    manaCost: CardDefinition["manaCost"],
    staticAbilities: string[]
): string {
    preloadDefinitions([
        {
            id,
            name: `Synthetic ${id}`,
            rarity: "rare",
            manaCost,
            types: ["Sorcery"],
            subtypes: [],
            staticAbilities,
        } as CardDefinition,
    ]);
    return id;
}

const UNDAUNTED = registerSorcery("synthetic-undaunted", { X: 6, G: 1 }, [
    "undaunted",
]);
const DOUBLE_UNDAUNTED = registerSorcery(
    "synthetic-double-undaunted",
    { X: 6, G: 1 },
    ["undaunted", "undaunted"]
);
const CHEAP_UNDAUNTED = registerSorcery("synthetic-cheap-undaunted", { G: 1 }, [
    "undaunted",
]);
const PLAIN = registerSorcery("synthetic-no-undaunted", { X: 6, G: 1 }, []);

/** The total the real cast path charges: the pair `game.ts` calls. */
function castCost(state: GameState, cardId: string): Record<string, number> {
    const view = makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const cost = normalizeManaCost(getDefinition(cardId).manaCost ?? {});
    applyCostModifiers(cost, getCostModifiers(state, view, "spell"));
    return cost;
}

/** Whether the server offers the cast with `generic` floating mana plus the
 *  {G}. */
function castableWith(generic: number): boolean {
    const spell = makeInstance(UNDAUNTED, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const p1: PlayerState = makePlayer("p1", {
        hand: [spell],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: generic },
    });
    const state = makeState({ players: [p1, makePlayer("p2")] });
    return getLegalActions(state, p1, spell).includes("cast");
}

describe("Undaunted cost reduction (CR 702.125a)", () => {
    it("costs {1} less for the one opponent of a two-player game", () => {
        expect(castCost(makeState(), UNDAUNTED)).toEqual({ X: 5, G: 1 });
    });

    it("does not discount a spell without the keyword", () => {
        expect(castCost(makeState(), PLAIN)).toEqual({ X: 6, G: 1 });
    });

    it("counts each opponent, not a fixed {1}", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
        });
        expect(castCost(state, UNDAUNTED)).toEqual({ X: 4, G: 1 });
    });

    it("never touches a coloured pip and floors at {0} (CR 601.2f)", () => {
        expect(castCost(makeState(), CHEAP_UNDAUNTED)).toEqual({ G: 1 });
    });

    it("does not count a player absent from the game (CR 702.125b)", () => {
        const state = makeState({ players: [makePlayer("p1")] });
        expect(castCost(state, UNDAUNTED)).toEqual({ X: 6, G: 1 });
    });

    it("applies every instance (CR 702.125c)", () => {
        expect(castCost(makeState(), DOUBLE_UNDAUNTED)).toEqual({ X: 4, G: 1 });
    });
});

describe("Undaunted on the cast path (CR 601.2f)", () => {
    it("offers the cast at the reduced total and not one mana below it", () => {
        expect(castableWith(5)).toBe(true);
        expect(castableWith(4)).toBe(false);
    });

    it("computes the same cost from the projected state the client reads", () => {
        const state = makeState();
        const projected = projectPublicState(state, 0, "p1");
        expect(castCost(projected as never, UNDAUNTED)).toEqual({
            X: 5,
            G: 1,
        });
    });
});

describe("expandUndaunted (ADR 0054)", () => {
    it("leaves a card without the keyword untouched", () => {
        const def = getDefinition(PLAIN);
        expect(expandUndaunted(def).selfCostReduction).toBeUndefined();
    });

    it("is idempotent, so a re-expansion does not grow the discount", () => {
        const once = getDefinition(UNDAUNTED);
        expect(expandUndaunted(once)).toBe(once);
    });

    it("refuses to overwrite an authored self reduction", () => {
        expect(() =>
            expandUndaunted({
                ...getDefinition(PLAIN),
                staticAbilities: ["undaunted"],
                selfCostReduction: {
                    costReduction: {
                        perCount: { X: 1 },
                        countFilter: { types: "Artifact" },
                    },
                },
            })
        ).toThrow(/undaunted/);
    });
});

describe("Undaunted in the Oracle compiler", () => {
    const REMINDER =
        "Undaunted (This spell costs {1} less to cast for each opponent.)";

    it("takes a printed undaunted out of quarantine", () => {
        const outcome = compileCard(
            oracleCard({
                typeLine: "Sorcery",
                manaCost: "{6}{W}",
                power: undefined,
                toughness: undefined,
                oracleText: `${REMINDER}\nDestroy all creatures.`,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.staticAbilities).toEqual(["undaunted"]);
        expect(
            expandDefinition(outcome.definition as CardDefinition)
                .selfCostReduction
        ).toEqual({
            costReduction: { perCount: { X: 1 }, countMode: "opponents" },
        });
    });

    it("keeps a granted undaunted in quarantine: a grant never reaches the expander", () => {
        const outcome = compileCard(
            oracleCard({
                typeLine: "Enchantment",
                manaCost: "{4}{W}{W}",
                power: undefined,
                toughness: undefined,
                oracleText: "Creatures you control have undaunted.",
            })
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toEqual([
            "ungrantable-keyword",
        ]);
    });
});
