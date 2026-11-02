// CR 702.33e / 601.2c / 603.3d (issue #7210) — a kicked permanent's OWN
// triggered ability reads the number of times its spell was kicked: "When
// Batroc enters, he deals damage equal to his power to each of up to X
// targets, where X is the number of times he was kicked."
//
// Two reads, one record:
//   1. the TARGET COUNT — `{ min: 0, max: { kickerCount: true } }` on the
//      trigger's `targetRequirement`, read once at the trigger's announcement
//      (`triggerTargetMinMax`, `gre/rules.ts`);
//   2. the Effect Script value `{ kickerCount: true }` at the trigger's
//      resolution (`SpellContext.getKickerCount`, `gre/state.ts`).
// The value read already worked — `buildTriggerItem` spreads the source
// permanent, Kicker record included, onto the trigger item — and is pinned
// here as the companion of the bound. The bound did NOT: the trigger walk
// collapsed every text-defined `max` to `min`, so "up to X" chose nothing.
//
// The definition is Batroc-shaped (Multikicker {2}) but the effect is a plain
// `dealDamage` of the kick count, so one resolution exercises both reads.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards";
import { enteredTrigger } from "../../cards/abilities/triggers/enteredTrigger";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { finalizeTargetSelection } from "../../game";
import {
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
} from "../state";

const LEAPER: CardDefinition = {
    id: "test-kicked-trigger-leaper",
    rarity: "rare",
    name: "Kicked Trigger Leaper",
    types: ["Creature"],
    subtypes: ["Human"],
    manaCost: { X: 1, R: 1 },
    power: 2,
    toughness: 2,
    kickers: [
        {
            id: "multikicker",
            description: "Multikicker {2}",
            mana: { X: 2 },
            multi: true,
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "kicked-trigger-leaper-etb",
            oracleText:
                "When this creature enters, it deals damage equal to the number of times it was kicked to each of up to X targets, where X is the number of times it was kicked.",
            scope: "self",
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: { kickerCount: true } },
            },
            effects: [
                {
                    op: "dealDamage",
                    amount: { kickerCount: true },
                    to: { target: 0 },
                },
            ],
        }),
    ],
};

const GIANT = "test-kicked-trigger-giant";
const GIANT_DEF: CardDefinition = {
    id: GIANT,
    rarity: "common",
    name: "Kicked Trigger Giant",
    types: ["Creature"],
    subtypes: ["Giant"],
    manaCost: { X: 5 },
    power: 5,
    toughness: 5,
};

/** Resolves the Leaper with `kicks` Multikicker payments against a board of
 *  three opposing 5/5s, then puts its ETB trigger on the stack. */
function enterKicked(kicks: number): GameState {
    const giants = ["g1", "g2", "g3"].map((id) =>
        makeInstance(GIANT, { id, controllerId: "p2", ownerId: "p2" })
    );
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2", { battlefield: giants })],
    });
    const item = pushSpell(state, LEAPER.id, "p1");
    if (kicks > 0) item.kickerPayments = { multikicker: kicks };
    resolveTopOfStack(state);
    processPendingActionTriggers(state);
    return state;
}

function withDefs(fn: () => void): void {
    withTemporaryDefinition(GIANT_DEF, () =>
        withTemporaryDefinition(LEAPER, fn)
    );
}

describe("Kicked permanent's ETB trigger reads its kick count (CR 702.33e, issue #7210)", () => {
    it("kicked twice: the trigger announces up to TWO targets (CR 601.2c via CR 603.3d)", () => {
        withDefs(() => {
            const state = enterKicked(2);
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0].triggeredAbilityId).toBe(
                "kicked-trigger-leaper-etb"
            );
            expect(state.pendingTarget?.kind).toBe("trigger");
            expect(state.pendingTarget?.count).toEqual({ min: 0, max: 2 });
        });
    });

    it("kicked twice: resolving the trigger deals 2 — the kick count, not the trigger item's 0", () => {
        withDefs(() => {
            const state = enterKicked(2);
            state.pendingTarget!.selected = [{ type: "permanent", id: "g1" }];
            finalizeTargetSelection(
                state,
                state.pendingTarget!,
                state.pendingTarget!.playerId
            );
            resolveTopOfStack(state);
            const g1 = state.players[1].battlefield.find((c) => c.id === "g1");
            expect(g1?.damageMarked).toBe(2);
        });
    });

    it("unkicked: X is 0, so the trigger announces no target and raises no prompt", () => {
        withDefs(() => {
            const state = enterKicked(0);
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0].targets).toEqual([]);
        });
    });

    it("the source leaving before resolution: the kick count still reads the object the ability came from (CR 608.2h)", () => {
        withDefs(() => {
            const state = enterKicked(3);
            expect(state.pendingTarget?.count).toEqual({ min: 0, max: 3 });
            state.pendingTarget!.selected = [{ type: "permanent", id: "g2" }];
            finalizeTargetSelection(
                state,
                state.pendingTarget!,
                state.pendingTarget!.playerId
            );
            // CR 400.7 — the Leaper is returned to hand through the single
            // battlefield-departure funnel, which stamps the trigger's
            // `sourceLki`; the returned card is a new object with no record.
            const trigger = state.stack[0];
            removePermanentTo(state, trigger.triggerSourceId!, "hand");
            expect(trigger.sourceLki).toBeDefined();
            resolveTopOfStack(state);
            const g2 = state.players[1].battlefield.find((c) => c.id === "g2");
            expect(g2?.damageMarked).toBe(3);
        });
    });
});
