// CR 107.4f — the Bot sees an activated ability's Phyrexian pip (issue #7830).
//
// The enumerator must charge the pip (one mana of its colour OR 2 life) exactly
// as the server does: an ability is offered only when SOME split is fundable,
// the move names the split it funded, and the search sandbox pays the life
// half. Fountain of Youth re-costed to "{1}{G/P}, {T}: gain 1 life"
// (`withTemporaryDefinition` — no printed card carries such a cost yet).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves, type Move } from "../moves";
import { payActivationInSearch } from "../applyMove";
import type { GameState } from "../state";

const FOUNTAIN = getCardByName("Fountain of Youth");
const FOREST = getCardByName("Forest").id;
const ABILITY = FOUNTAIN.activatedAbilities![0].id;

function phyrexianFountain(): CardDefinition {
    return {
        ...FOUNTAIN,
        activatedAbilities: FOUNTAIN.activatedAbilities!.map((a) => ({
            ...a,
            cost: { ...a.cost, mana: { X: 1, phyrexian: { G: 1 } } },
        })),
    };
}

function build(life: number, forests: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                life,
                battlefield: [
                    makeInstance(FOUNTAIN.id, { id: "fountain" }),
                    ...Array.from({ length: forests }, (_, i) =>
                        makeInstance(FOREST, { id: `forest${i}` })
                    ),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

type ActivateMove = Extract<Move, { kind: "activate-ability" }>;

function fountainMoves(state: GameState): ActivateMove[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is ActivateMove =>
            m.kind === "activate-ability" && m.abilityId === ABILITY
    );
}

describe("Bot: Phyrexian pip in an activated cost (CR 107.4f)", () => {
    it("one Forest at 20 life → offered, paying the pip with 2 life", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const moves = fountainMoves(build(20, 1));
            expect(moves).toHaveLength(1);
            expect(moves[0].phyrexianLifePips).toBe(1);
            expect(moves[0].tapPlan).toHaveLength(1);
        });
    });

    it("one Forest at 1 life → NOT offered: {1}{G} is unfundable, life can't pay", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            expect(fountainMoves(build(1, 1))).toHaveLength(0);
        });
    });

    it("two Forests at 1 life → offered, paying the pip with mana", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const moves = fountainMoves(build(1, 2));
            expect(moves).toHaveLength(1);
            expect(moves[0].phyrexianLifePips).toBe(0);
            expect(moves[0].tapPlan).toHaveLength(2);
        });
    });

    it("the search sandbox pays the life half of the split", () => {
        withTemporaryDefinition(phyrexianFountain(), () => {
            const state = build(20, 1);
            const [move] = fountainMoves(state);
            expect(payActivationInSearch(state, "p1", move)).toBe(true);
            expect(state.players[0].life).toBe(18);
        });
    });
});
