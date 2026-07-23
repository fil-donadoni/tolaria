// Grounding-floor parity tests (issue #1520). `contextAwareGrounding` is
// meant to REFINE `contextFreeGrounding`'s representative-magnitude floor
// against real board state — never regress below it. For a genuinely
// unmodeled dynamic amount (`counters`, `kickerCount`, `escaped`) the
// context-aware resolver used to fall back to a bare 0, strictly LESS
// informed than the context-free floor it's supposed to sharpen (a "damage
// equal to charge counters" card priced at zero in a tutor prior).

import { describe, it, expect } from "vitest";
import { contextFreeGrounding } from "../grounding";
import { contextAwareGroundingForChoice } from "../candidateValue";
import { makeState, makePlayer } from "../../../cards/__tests__/setup";
import type { EffectValue } from "../../../cards/types";

const cf = contextFreeGrounding();

describe("context-aware grounding never regresses below the context-free floor (issue #1520)", () => {
    function stateFor() {
        return makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
    }

    it("counters: context-aware matches the context-free floor for an unmodeled object", () => {
        const v: EffectValue = {
            counters: { of: { ref: "$source" }, type: "charge" },
        };
        const cfFloor = cf.value(v).amount;
        const state = stateFor();
        const aware = contextAwareGroundingForChoice(state, "p1").value(v);
        expect(aware.amount).toBeGreaterThanOrEqual(cfFloor);
        expect(aware.amount).toBe(cfFloor);
    });

    it("kickerCount: context-aware matches the context-free floor when unresolvable pre-cast", () => {
        const v: EffectValue = { kickerCount: true };
        const cfFloor = cf.value(v).amount;
        const state = stateFor();
        const aware = contextAwareGroundingForChoice(state, "p1").value(v);
        expect(aware.amount).toBeGreaterThanOrEqual(cfFloor);
        expect(aware.amount).toBe(cfFloor);
    });

    it("escaped: context-aware matches the context-free floor for an unmodeled object", () => {
        const v: EffectValue = { escaped: { of: { ref: "$source" } } };
        const cfFloor = cf.value(v).amount;
        const state = stateFor();
        const aware = contextAwareGroundingForChoice(state, "p1").value(v);
        expect(aware.amount).toBeGreaterThanOrEqual(cfFloor);
        expect(aware.amount).toBe(cfFloor);
    });

    it("none of the three unmodeled amounts ground to a bare zero", () => {
        const state = stateFor();
        const grounding = contextAwareGroundingForChoice(state, "p1");
        const values: EffectValue[] = [
            { counters: { of: { ref: "$source" }, type: "charge" } },
            { kickerCount: true },
            { escaped: { of: { ref: "$source" } } },
        ];
        for (const v of values) {
            expect(grounding.value(v).amount).toBeGreaterThan(0);
        }
    });
});
