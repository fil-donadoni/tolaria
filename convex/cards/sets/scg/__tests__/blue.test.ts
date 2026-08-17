import { describe, expect, it } from "vitest";

import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { resolveTopOfStack } from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import { counterspell } from "../../lea/blue";
import { lightningBolt } from "../../lea/red";
import { balduvianBears } from "../../ice/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { stifle } from "../blue";

/** Build a triggered-ability stack item from a source card def id (CR 603 —
 *  the trigger goes on the stack carrying its source's characteristics). */
function triggeredOnStack(
    cardId: string,
    instId: string,
    triggeredAbilityId = "src-trigger"
): StackItem {
    return {
        ...makeInstance(cardId, {
            id: instId,
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        }),
        castById: "p2",
        triggeredAbilityId,
        targets: [],
    };
}

/** Build an activated-ability stack item from a source card def id. */
function activatedOnStack(
    cardId: string,
    instId: string,
    abilityId = "src-ability"
): StackItem {
    return {
        ...makeInstance(cardId, {
            id: instId,
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        }),
        castById: "p2",
        abilityId,
        targets: [],
    };
}

describe("Stifle — counter target activated or triggered ability (CR 701.6a / 113.7a)", () => {
    const req = stifle.targetRequirement!;

    it("targets a TRIGGERED ability on the stack", () => {
        const state = makeState();
        state.stack.push(triggeredOnStack(balduvianBears.id, "bear-trigger"));
        expect(getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1")).toEqual([
            { type: "spell", id: "bear-trigger" },
        ]);
    });

    it("targets an ACTIVATED ability on the stack", () => {
        const state = makeState();
        state.stack.push(activatedOnStack(balduvianBears.id, "bear-ability"));
        expect(getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1")).toEqual([
            { type: "spell", id: "bear-ability" },
        ]);
    });

    it("does NOT target a spell (an ability-kind target rejects spells)", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        expect(getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1")).toEqual(
            []
        );
    });

    it("counters a triggered ability — it vanishes, NOT to a graveyard (CR 113.7a)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.stack.push(triggeredOnStack(balduvianBears.id, "bear-trigger"));
        // Stifle on top of the stack (LIFO) targeting the trigger.
        pushSpell(state, stifle.id, "p1", [
            { type: "spell", id: "bear-trigger" },
        ]);
        resolveTopOfStack(state);
        // The triggered ability left the stack and did NOT land in any zone —
        // an ability is not a card (CR 113.7a).
        expect(state.stack.some((s) => s.id === "bear-trigger")).toBe(false);
        expect(
            state.players.some((p) =>
                [...p.graveyard, ...p.exile, ...p.hand, ...p.library].some(
                    (c) => c.id === "bear-trigger"
                )
            )
        ).toBe(false);
        // Stifle itself resolves to its owner's graveyard.
        expect(
            state.players[0].graveyard.some((c) => c.card.id === stifle.id)
        ).toBe(true);
    });

    it("regression: Counterspell (target spell) can NOT target a triggered ability", () => {
        const state = makeState();
        state.stack.push(triggeredOnStack(balduvianBears.id, "bear-trigger"));
        // Counterspell's requirement omits spellStackKind → spells only.
        const csReq = counterspell.targetRequirement!;
        expect(
            getLegalTargets(state, csReq, NO_TARGETING_SOURCE, "p1")
        ).toEqual([]);
    });
});
