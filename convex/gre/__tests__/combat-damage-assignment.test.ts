// Combat damage assignment budget = EFFECTIVE power (issue #366).
//
// CR 510.1c: a creature assigns combat damage equal to its power. "Power" here
// is the EFFECTIVE power after the CR 613.4 layer pipeline, which includes
// one-shot temporary P/T modifications (layer-7c registry entries) from combat tricks
// such as Giant Growth. The `setDamageAssignment` mutation in `convex/game.ts`
// validates `total <= getEffectivePower(state, source)`; reading the raw base
// `power` field instead wrongly rejected legal assignments for buffed
// attackers. This file pins the engine contract the mutation relies on and
// re-runs it across the wire projection (the path the UI panel reads from).
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardType } from "../../cards/types";
import { getEffectivePower } from "../layers";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import { projectFullState } from "../../gameProjections";

function creature(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

/** Mirrors the source-power validation in `setDamageAssignment`: the budget is
 *  the source's effective power; an assignment is legal iff its total does not
 *  exceed it. */
function assignmentTotalIsLegal(
    state: GameState,
    source: CardInstanceState,
    assignments: Record<string, number>
): boolean {
    const power = Math.max(0, getEffectivePower(state, source));
    const total = Object.values(assignments).reduce((s, n) => s + n, 0);
    return total <= power;
}

describe("combat damage assignment budget (CR 510.1c, issue #366)", () => {
    // Repro: Elvish Archers (base 2/1) blocked by Savannah Lions (2/1) and
    // Pearled Unicorn (2/2), buffed +3/+3 by Giant Growth -> effective 5/4.
    function buffedAttackerState(powerMod: number): {
        state: GameState;
        attacker: CardInstanceState;
    } {
        const attacker = creature("archers", 2, 1);
        const lions = creature("lions", 2, 1, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const unicorn = creature("unicorn", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [lions, unicorn] }),
            ],
        });
        // CR 613.4c (ADR 0082, PRD #2064 S6) — the Giant Growth pump is a
        // Continuous Effects Registry entry, not a field on the attacker.
        state.continuousEffects = [
            {
                id: "ce-1",
                layer: 7,
                sublayer: "7c",
                timestamp: 1,
                expiry: {
                    kind: "duration",
                    duration: { phase: "end-of-turn" },
                    controllerId: "p1",
                },
                affected: { kind: "instances", instanceIds: ["archers"] },
                payload: {
                    kind: "pt-modify",
                    power: powerMod,
                    toughness: powerMod,
                },
                characteristicDefining: false,
            },
        ];
        return { state, attacker };
    }

    it("uses effective power (5) as the budget for a +3/+3 multi-blocked attacker", () => {
        const { state, attacker } = buffedAttackerState(3);
        expect(getEffectivePower(state, attacker)).toBe(5);
    });

    it("accepts a split totaling up to effective power (5), not base power (2)", () => {
        const { state, attacker } = buffedAttackerState(3);
        // 5 to one blocker, 0 to the other.
        expect(
            assignmentTotalIsLegal(state, attacker, { lions: 5, unicorn: 0 })
        ).toBe(true);
        // 2 + 3 split.
        expect(
            assignmentTotalIsLegal(state, attacker, { lions: 2, unicorn: 3 })
        ).toBe(true);
        // A total of 4 (> base 2) was the rejected-but-legal case in the bug.
        expect(
            assignmentTotalIsLegal(state, attacker, { lions: 1, unicorn: 3 })
        ).toBe(true);
    });

    it("rejects a split exceeding effective power (> 5)", () => {
        const { state, attacker } = buffedAttackerState(3);
        expect(
            assignmentTotalIsLegal(state, attacker, { lions: 3, unicorn: 3 })
        ).toBe(false);
    });

    it("lowers the budget for a negative temporary modifier (effective < base)", () => {
        // base 2/1 with -1/-1 -> effective power 1.
        const { state, attacker } = buffedAttackerState(-1);
        expect(getEffectivePower(state, attacker)).toBe(1);
        expect(
            assignmentTotalIsLegal(state, attacker, { lions: 1, unicorn: 0 })
        ).toBe(true);
        expect(
            assignmentTotalIsLegal(state, attacker, { lions: 1, unicorn: 1 })
        ).toBe(false);
    });

    it("survives the wire projection: the panel reads the same effective budget", () => {
        // The UI panel computes the budget from the projected (slim) state via
        // the frontend `effectivePower` helper, which feeds the SAME layer
        // pipeline. The projection must carry `continuousEffects`, or the
        // client would clamp to base power again (the regression class).
        const { state } = buffedAttackerState(3);
        const projected = projectFullState(state, 1);
        const slimAttacker = projected.players[0].battlefield.find(
            (c) => c.id === "archers"
        )!;
        expect(
            getEffectivePower(
                projected as unknown as GameState,
                slimAttacker as unknown as CardInstanceState
            )
        ).toBe(5);
    });
});
