// A spec read as a board (issue #3577, PRD #3574): hands are a count unless a
// caller reveals them, and the count holds even when the spec names the cards.

import { describe, it, expect } from "vitest";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import { scenarioBoard } from "../scenario-spec-board-model";

const SPEC: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me" },
        { name: "Grizzly Bears", owner: "me", tapped: true, count: 2 },
        { name: "Shock", owner: "me", zone: "hand" },
        { name: "Island", owner: "opp", zone: "battlefield" },
        { name: "Counterspell", owner: "opp", zone: "hand", count: 2 },
        { name: "Lightning Bolt", owner: "opp", zone: "graveyard" },
    ],
    hiddenHand: { me: 1, opp: 1 },
    stack: [
        { kind: "spell", name: "Shock", controller: "me" },
        { kind: "spell", name: "Counterspell", controller: "opp" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 4,
};

function seat(board: ReturnType<typeof scenarioBoard>, name: "me" | "opp") {
    const found = board.seats.find((s) => s.seat === name);
    if (!found) throw new Error(`no seat ${name}`);
    return found;
}

describe("scenarioBoard (issue #3577)", () => {
    it("renders an unrevealed hand as a SIZE only, even when the spec names its cards", () => {
        const board = scenarioBoard(SPEC, ["me"]);
        const opp = seat(board, "opp");
        // Two named copies plus one opaque card — and not one name.
        expect(opp.hand).toEqual({ revealed: false, size: 3 });
        expect(JSON.stringify(opp.hand)).not.toContain("Counterspell");
    });

    it("renders a revealed hand as cards, its size still counting the opaque ones", () => {
        const me = seat(scenarioBoard(SPEC, ["me"]), "me");
        expect(me.hand).toEqual({
            revealed: true,
            size: 2,
            entries: [{ name: "Shock", count: 1, notes: [] }],
        });
    });

    it("hides every hand when no seat is revealed", () => {
        const board = scenarioBoard(SPEC, []);
        expect(board.seats.map((s) => s.hand.revealed)).toEqual([false, false]);
    });

    it("places a zoneless entry on the battlefield and reads the stack top-down", () => {
        const board = scenarioBoard(SPEC, []);
        expect(seat(board, "me").zones).toEqual([
            {
                zone: "battlefield",
                entries: [
                    { name: "Mountain", count: 1, notes: [] },
                    { name: "Grizzly Bears", count: 2, notes: ["tapped"] },
                ],
            },
        ]);
        expect(board.stack.map((item) => item.name)).toEqual([
            "Counterspell",
            "Shock",
        ]);
        expect(board.seats.map((s) => s.seat)).toEqual(["opp", "me"]);
    });
});
