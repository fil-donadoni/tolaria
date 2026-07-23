/**
 * The `declare-attackers` blade setup step (issue #1489, ADR 0070 §4).
 *
 * The invariant under test is the one that makes an engine-real setup worth
 * having: a step that finds no purchase in the engine THROWS. There is no
 * fallback that builds the position "as if" — a silent fallback would run the
 * search on a board other than the one written.
 *
 * CR: 508.1 (attack declaration), 508.1f (attackers tap), 509.1 (the block
 * window the step walks priority to).
 */

import { describe, it, expect } from "vitest";
import { buildStateFromScenario } from "../../../scenarioBuilder";
import { buildBladeBaseState } from "../runner";
import { applyBladeSetup, BladeSetupError } from "../setup";
import { decidingPlayer } from "../../../search";
import type { BladeScenario } from "../types";
import type { ScenarioSpec } from "../../../../debugScenarioSpec";

function run(spec: ScenarioSpec, setup: BladeScenario["setup"]) {
    return applyBladeSetup(
        buildStateFromScenario(buildBladeBaseState(), spec),
        {
            label: "test",
            setup,
        }
    );
}

const ATTACKING_BOARD: ScenarioSpec = {
    cards: [
        {
            name: "Craw Wurm",
            owner: "me",
            zone: "battlefield",
            summoningSick: false,
            count: 2,
        },
        {
            name: "Grizzly Bears",
            owner: "opp",
            zone: "battlefield",
            summoningSick: false,
        },
    ],
    phase: "DECLARE_ATTACKERS",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

describe("blade setup: declare-attackers (CR 508.1)", () => {
    it("walks the board to an OPEN block window owed by the defender", () => {
        const state = run(ATTACKING_BOARD, [{ kind: "declare-attackers" }]);
        expect(state.phase).toBe("DECLARE_BLOCKERS");
        expect(state.combat?.confirmed).toBe(true);
        expect(state.combat?.blockersConfirmed).toBe(false);
        expect(state.combat?.attackerIds).toHaveLength(2);
        // The DEFENDER (players[1]) owes the decision — this is the whole
        // point of the step (`decidingPlayer`, search.ts).
        expect(decidingPlayer(state)).toBe(state.players[1].id);
    });

    it("taps the declared attackers (CR 508.1f) — the engine's own path did it", () => {
        const state = run(ATTACKING_BOARD, [{ kind: "declare-attackers" }]);
        const attackers = state.players[0].battlefield.filter((c) =>
            state.combat!.attackerIds.includes(c.id)
        );
        expect(attackers).toHaveLength(2);
        for (const a of attackers) {
            expect(a.isTapped).toBe(true);
            expect(a.isAttacking).toBe(true);
        }
    });

    it("restricts the attack to the named creatures", () => {
        const spec: ScenarioSpec = {
            ...ATTACKING_BOARD,
            cards: [
                ...ATTACKING_BOARD.cards,
                {
                    name: "Hill Giant",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
        };
        const state = run(spec, [
            { kind: "declare-attackers", cards: ["Hill Giant"] },
        ]);
        expect(state.combat?.attackerIds).toHaveLength(1);
    });

    it("THROWS when the active player controls no legal attacker", () => {
        expect(() =>
            run(
                {
                    cards: [
                        {
                            name: "Grizzly Bears",
                            owner: "opp",
                            zone: "battlefield",
                            summoningSick: false,
                        },
                    ],
                    phase: "DECLARE_ATTACKERS",
                    turn: 3,
                    landCount: 0,
                    libraryCount: 20,
                },
                [{ kind: "declare-attackers" }]
            )
        ).toThrow(BladeSetupError);
    });

    it("THROWS when every candidate is summoning sick (CR 302.6)", () => {
        expect(() =>
            run(
                {
                    ...ATTACKING_BOARD,
                    cards: ATTACKING_BOARD.cards.map((c) =>
                        c.owner === "me" ? { ...c, summoningSick: true } : c
                    ),
                },
                [{ kind: "declare-attackers" }]
            )
        ).toThrow(BladeSetupError);
    });

    it("THROWS when no creature matches the requested names", () => {
        expect(() =>
            run(ATTACKING_BOARD, [
                { kind: "declare-attackers", cards: ["Hill Giant"] },
            ])
        ).toThrow(BladeSetupError);
    });

    it("THROWS when the built state is not at DECLARE_ATTACKERS", () => {
        expect(() =>
            run({ ...ATTACKING_BOARD, phase: "PRECOMBAT_MAIN" }, [
                { kind: "declare-attackers" },
            ])
        ).toThrow(BladeSetupError);
    });
});
