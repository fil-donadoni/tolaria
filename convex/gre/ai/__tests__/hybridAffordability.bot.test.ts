/**
 * Issue #3037 — a guild-hybrid pip (CR 107.4e / 202.1a) is mana owed: the cast
 * affordance (`getLegalActions`) and the Bot's tap planner (`planManaPayment`)
 * must total it like the payment does, so a cost of hybrid pips alone is never
 * read as free. Position: Figure of Destiny `{R/W}` against Islands.
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import { enumerateMoves, planManaPayment } from "../../moves";
import { getLegalActions } from "../../rules";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";

function build(lands: string[]): GameState {
    const spec: BladeScenario["spec"] = {
        cards: [
            { name: "Figure of Destiny", owner: "me", zone: "hand" },
            ...lands.map((name) => ({
                name,
                owner: "me" as const,
                zone: "battlefield" as const,
            })),
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        landCount: 0,
        libraryCount: 20,
    };
    return buildBladeState({
        label: "hybrid-affordability-unit",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

const figureCasts = (state: GameState) => {
    const player = state.players[0];
    const figure = player.hand[0];
    return {
        legal: getLegalActions(state, player, figure).includes("cast"),
        moves: enumerateMoves(state, player.id).filter(
            (m) => m.kind === "cast-spell"
        ),
        player,
    };
};

describe("hybrid pips are owed by both affordability probes (issue #3037)", () => {
    it("CR 107.4e — {R/W} on three Islands: not castable, no cast enumerated", () => {
        const { legal, moves } = figureCasts(
            build(["Island", "Island", "Island"])
        );
        expect(legal).toBe(false);
        expect(moves).toEqual([]);
    });

    it("CR 107.4e — {R/W} with one Mountain: castable, one-tap plan agrees with the gate", () => {
        const { legal, moves } = figureCasts(
            build(["Island", "Island", "Mountain"])
        );
        expect(legal).toBe(true);
        expect(moves.length).toBeGreaterThan(0);
        for (const m of moves) {
            if (m.kind !== "cast-spell") continue;
            expect(m.tapPlan).toHaveLength(1);
        }
    });

    it("CR 202.1a — a mixed {1}{R/W}{R/W} is totalled whole: hybrid neither dropped nor doubled", () => {
        const state = build(["Mountain", "Plains", "Island", "Island"]);
        const player = state.players[0];
        const cost = { X: 1, "R/W": 2 } as Record<string, number>;
        expect(planManaPayment(state, player, cost)).toHaveLength(3);
        const two = build(["Mountain", "Plains"]);
        expect(planManaPayment(two, two.players[0], cost)).toBeNull();
        const noPips = build(["Island", "Island", "Island"]);
        expect(planManaPayment(noPips, noPips.players[0], cost)).toBeNull();
    });
});
