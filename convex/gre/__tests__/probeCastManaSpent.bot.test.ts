// CR 601.2h / 702.44a — the dominance probe's cast stamps `notedManaSpent`.
//
// `isDominatedNoOpMove` proves a cast futile by applying it to a clone and
// resolving it. A Converge card (`colorsSpentToCast`) reads the colours it was
// paid with; the probe built its stack item without the record, so every
// converge cast read 0 colours, looked like a no-op and was deleted from the
// Bot's legal moves (issue #7246) — the Bot could only pass.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import type { ScenarioSpec } from "../../debugScenarioSpec";
import { isDominatedNoOpMove } from "../ai/dominance";
import { enumerateMoves } from "../moves";
import type { GameState } from "../state";

function board(secondLand: string): GameState {
    const cards: ScenarioSpec["cards"] = [
        { name: "Prismatic Ending", owner: "me", zone: "hand" },
        { name: "Plains", owner: "me", zone: "battlefield" },
        { name: secondLand, owner: "me", zone: "battlefield" },
        {
            name: "Watchwolf",
            owner: "opp",
            zone: "battlefield",
            summoningSick: false,
        },
    ];
    const scenario: BladeScenario = {
        label: "probe-cast-mana-spent-unit",
        spec: {
            cards,
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    };
    return buildBladeState(scenario);
}

function xOneCast(state: GameState) {
    const me = state.players[0];
    const move = enumerateMoves(state, me.id).find(
        (m) => m.kind === "cast-spell" && m.chosenX === 1
    );
    if (!move || move.kind !== "cast-spell") throw new Error("no X=1 cast");
    return { me, move };
}

describe("dominance probe stamps notedManaSpent (CR 601.2h / 702.44a)", () => {
    it("X=1 off two colours exiles an MV-2 target: not a no-op", () => {
        const state = board("Island");
        const { me, move } = xOneCast(state);
        expect(isDominatedNoOpMove(state, me.id, move)).toBe(false);
    });

    it("X=1 off one colour cannot exile an MV-2 target: still a no-op", () => {
        const state = board("Plains");
        const { me, move } = xOneCast(state);
        expect(isDominatedNoOpMove(state, me.id, move)).toBe(true);
    });
});
