// SURFACE test for the `SPELL_KICKED` trigger (CR 702.33d / 603.2, issue
// #1097): Saproling Infestation's "whenever a player kicks a spell" ability
// must be LABELLED on the stack after crossing the wire.
//
// A trigger the GRE places correctly is routinely dead in the UI because a
// view reducer drops the field the renderer keys off (`.claude/rules/
// gre-development.md` § Frontend wiring analysis). This drives the assertion
// through BOTH real reducers — `projectPublicState` (server → wire) and
// `getStackAbilityOracleText` (the resolver `<StackRow>` calls) — never a
// hand-built stack item, which would mask exactly the drop it exists to catch.
import { describe, it, expect } from "vitest";
import {
    getStackAbilityOracleText,
    stackAbilityKindOf,
} from "~/lib/card-utils";
import { projectPublicState } from "@convex/gameProjections";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    type StackItem,
} from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { saprolingInfestation } from "@convex/cards/sets/inv/green";
import { everflowingChalice } from "@convex/cards/sets/wwk/colorless";

describe("Saproling Infestation's kicked trigger on the stack (CR 702.33d)", () => {
    it("keeps its ability id and Oracle text through projectPublicState", () => {
        const infest = makeInstance(saprolingInfestation.id, {
            controllerId: "p1",
            ownerId: "p1",
            id: "infest-wire",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [infest] }),
                makePlayer("p2"),
            ],
        });
        // A real kicked cast: Everflowing Chalice with Multikicker paid once.
        const chalice: StackItem = {
            ...makeInstance(everflowingChalice.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
                id: "chalice-wire",
            }),
            castById: "p1",
            kickerPayments: { kicker: 1 },
        };
        state.stack.push(chalice);
        emitSpellCastEvent(state, chalice);
        processPendingActionTriggers(state);

        const projected = projectPublicState(state, 1, "p1");
        const row = projected.stack.find(
            (s) => s.triggeredAbilityId === "saproling-infestation-kicked"
        );
        expect(row).toBeDefined();
        // <StackRow> asks these two questions, in this order.
        expect(stackAbilityKindOf(row!)).toBe("triggered");
        expect(getStackAbilityOracleText(row!)).toBe(
            "Whenever a player kicks a spell, you create a 1/1 green Saproling creature token."
        );
    });
});
