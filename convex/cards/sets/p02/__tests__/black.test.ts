// Per-card behavior tests for black cards in `convex/cards/sets/p02/black.ts`
// (Portal Second Age, split by colour per ADR 0043). Fixtures from
// `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import { ravenousRats } from "../black";
import { grizzlyBears } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";

/** Puts Ravenous Rats' ETB trigger on the stack (mirroring
 *  `oublietteTriggerOnStack`, `arn/__tests__/black.test.ts`), runs the REAL
 *  CR 603.3d announcement sweep over it, and resolves it. `targets` is left
 *  UNSET on purpose: "target opponent" is a real target (issue #2801), so the
 *  ENGINE must be the one that picks it — a fixture that sets `targets`
 *  itself never asks whether the choice was legal, which is exactly how the
 *  protection bug hid. Legality itself is covered in
 *  `gre/__tests__/playerTargetProtection.test.ts`. */
function resolveEtbTrigger(state: GameState, source: CardInstanceState): void {
    const trig: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "ravenous-rats-etb",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    // CR 603.3d — sole mandatory target, one legal candidate: auto-selected,
    // no prompt.
    expect(raiseTriggerTargetSelection(state)).toBe(false);
    expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);
    resolveTopOfStack(state);
}

// Ravenous Rats — the DSL smoke sweep skips this script: the `choice` Op
// (`kind: "discard-hand"`) suspends mid-resolution for the opponent's pick,
// which the canned-scenario generator can't drive.
describe("Ravenous Rats (ETB discard — choice Op suspends for player input, CR 603.6a / 701.9)", () => {
    it("suspends on a discard-hand choice for the OPPONENT, then discards their pick", () => {
        const rats = makeInstance(ravenousRats.id, {
            id: "rats",
            controllerId: "p1",
            ownerId: "p1",
        });
        const filler1 = makeInstance(grizzlyBears.id, {
            id: "h1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const filler2 = makeInstance(grizzlyBears.id, {
            id: "h2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rats] }),
                makePlayer("p2", { hand: [filler1, filler2] }),
            ],
        });

        resolveEtbTrigger(state, rats);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.playerId).toBe("p2"); // the OPPONENT discards, not the caster
        expect(head.count).toBe(1);
        // CR 608.3 — the trigger stays on the stack across the wait.
        expect(state.stack).toHaveLength(1);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h1"],
        });
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["h2"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["h1"]);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();

        // Wire projection, from the discarding player's own viewpoint:
        // their remaining hand card stays visible and the discard lands
        // in the (public) graveyard.
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].hand.map((c) => c?.id)).toEqual(["h2"]);
        expect(projected.players[1].graveyard.map((c) => c.id)).toEqual(["h1"]);
    });

    it("skips the discard entirely against an empty hand (CR 608.2b)", () => {
        const rats = makeInstance(ravenousRats.id, {
            id: "rats2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rats] }),
                makePlayer("p2", { hand: [] }),
            ],
        });
        resolveEtbTrigger(state, rats);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
    });
});
