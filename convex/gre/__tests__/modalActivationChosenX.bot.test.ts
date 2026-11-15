// CR 700.2a / 107.3a via CR 602.2b (issue #3688) — a MODAL activated ability
// whose activation cost carries a player-chosen `{X}`: the mode and the value
// of X are both chosen as part of activating it, so the Bot's
// `activate-ability` moves carry `chosenModeIds` AND `chosenX`. The X range is
// bounded by what the payment planner funds — including a restricted X
// ("Spend only white mana on X", `ManaCost.xSpendColors`), which only mana of
// the permitted colour can pay.
//
// Atalya, Samite Master is the FIXTURE, never a special case: nothing under
// test reads a card name.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { preloadDefinitions } from "../../cards/registry";
import { resolveCardExport } from "../../cards/defineCard";
import { atalyaSamiteMaster } from "../../cards/sets/inv/white.cards";
import { enumerateMoves, type Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../state";

// The PR head carries no catalogue row for a newly shipped card (ADR 0157).
preloadDefinitions([resolveCardExport(atalyaSamiteMaster)!]);

const ATALYA = "90500e7a-f76d-453a-bda0-d56d3f7c7534";
const PLAINS = getCardByName("Plains").id;
const MOUNTAIN = getCardByName("Mountain").id;
const LIONS = getCardByName("Savannah Lions").id;

function inst(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        isSummoningSick: false,
    });
}

/** p1 in its main phase: Atalya, a creature to shield, two Plains and two
 *  Mountains — four mana, of which only two can pay a white-only X. */
function board(): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    inst(ATALYA, "atalya"),
                    inst(LIONS, "lions"),
                    inst(PLAINS, "w1"),
                    inst(PLAINS, "w2"),
                    inst(MOUNTAIN, "r1"),
                    inst(MOUNTAIN, "r2"),
                ],
            }),
            makePlayer("p2", {}),
        ],
    });
}

type ActivateMove = Extract<Move, { kind: "activate-ability" }>;

function atalyaMoves(state: GameState): ActivateMove[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is ActivateMove =>
            m.kind === "activate-ability" && m.cardInstanceId === "atalya"
    );
}

function xValues(moves: ActivateMove[], modeId: string): number[] {
    return [
        ...new Set(
            moves
                .filter((m) => m.chosenModeIds?.[0] === modeId)
                .map((m) => m.chosenX ?? -1)
        ),
    ].sort();
}

describe("modal {X} activated ability — the Bot announces mode AND X (CR 700.2a / 107.3a, issue #3688)", () => {
    it("emits gain-life moves at every white-fundable X, never above", () => {
        expect(xValues(atalyaMoves(board()), "gain-life")).toEqual([0, 1, 2]);
    });

    it("emits targeted prevent moves carrying the announced X", () => {
        const prevent = atalyaMoves(board()).filter(
            (m) => m.chosenModeIds?.[0] === "prevent"
        );
        expect(xValues(prevent, "prevent")).toEqual([0, 1, 2]);
        expect(
            prevent.some(
                (m) =>
                    m.chosenX === 2 &&
                    m.targets.some((t) => "id" in t && t.id === "lions")
            )
        ).toBe(true);
    });

    it("a third Plains raises the ceiling to X = 3", () => {
        const state = board();
        state.players[0].battlefield.push(inst(PLAINS, "w3"));
        expect(xValues(atalyaMoves(state), "gain-life")).toEqual([0, 1, 2, 3]);
    });
});
