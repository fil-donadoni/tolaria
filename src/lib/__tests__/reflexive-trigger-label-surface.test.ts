// SURFACE test (issue #9985): a REFLEXIVE trigger (CR 603.12, "When you do, …")
// must keep its `reflexiveTrigger` flag across the wire so the stack row can
// label it "Reflexive trigger" and not the delayed-trigger label of CR 603.7.
// Driven through the real reducers — the engine drain
// (`processPendingActionTriggers`) and `projectPublicState` — never a
// hand-built view.
import { describe, it, expect } from "vitest";
import { stackAbilityKindOf } from "~/lib/card-utils";
import { projectPublicState } from "@convex/gameProjections";
import {
    processPendingActionTriggers,
    type StackItem,
} from "@convex/gre/state";
import { INLINE_DELAYED_TRIGGER_ID } from "@convex/gre/effects/interpreter";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

const INTI_ID = "fa7a55aa-ae61-4933-b7a4-dcc55dac6fcd";

function inlineItem(id: string, reflexive: boolean): StackItem {
    return {
        ...makeInstance(INTI_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
            id,
        }),
        castById: "p1",
        delayedTriggerId: INLINE_DELAYED_TRIGGER_ID,
        delayedEffects: [],
        delayedOracleText: "When you do, …",
        ...(reflexive ? { reflexiveTrigger: true } : {}),
    };
}

describe("reflexive trigger label on the wire (CR 603.12, issue #9985)", () => {
    it("projects the flag so the kind reads reflexive, not delayed", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.pendingReflexiveTriggers = [inlineItem("refl", true)];
        processPendingActionTriggers(state);
        // A genuine delayed trigger already on the stack (no flag).
        state.stack.push(inlineItem("del", false));

        const projected = projectPublicState(state, 1, "p1");
        const refl = projected.stack.find((s) => s.id === "refl");
        const del = projected.stack.find((s) => s.id === "del");
        expect(stackAbilityKindOf(refl!)).toBe("reflexive");
        expect(stackAbilityKindOf(del!)).toBe("delayed");
    });
});
