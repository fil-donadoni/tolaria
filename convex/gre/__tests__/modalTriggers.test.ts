// CR 603.3c (issue #2461) — MODAL TRIGGERED ABILITIES. "If a triggered ability
// is modal, its controller announces the mode choice when putting the ability on
// the stack. If one of the modes would be illegal (due to an inability to choose
// legal targets, for example), that mode can't be chosen. If no mode is chosen,
// the ability is removed from the stack."
//
// Everything a modal trigger needs that a modal SPELL already had is here:
// the announcement itself (there is no player-initiated mutation putting a
// trigger on the stack, so the engine raises the choice), the per-mode target
// legality CR 603.3c makes mode legality depend on, the CR 700.2c rule that only
// the chosen mode's requirement constrains targets, the CR 700.2b/700.2f
// immutability of the pick, the CR 603.3b consequence that two copies stop being
// interchangeable, and the wire/serialization seams the announcement rides.
//
// Deceiver Exarch is the catalogue's modal trigger; these tests drive the shared
// engine helpers directly rather than the card, so a failure names the rule.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { deceiverExarch } from "../../cards/sets/nph/blue";
import { grizzlyBears } from "../../cards/sets/lea/green";
import type { GameState, StackItem } from "../state";
import type { GameEvent } from "../../cards/types";
import { resolveTopOfStack } from "../state";
import { raiseTriggerTargetSelection } from "../rules";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { collectTriggers, placeTriggersOnStack } from "../triggers";
import { legalActions } from "../legalActions";
import { computeExpectedInput } from "../expectedInput";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";

const ETB_ID = "deceiver-exarch-etb";

/** The Exarch's ETB trigger as `collectTriggers`/`buildTriggerItem` builds it:
 *  un-announced — no `chosenModeId`, no `targets`. */
function mkTrigger(id: string, controllerId = "p1"): StackItem {
    return {
        id,
        card: { id: deceiverExarch.id },
        controllerId,
        ownerId: controllerId,
        castById: controllerId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        triggeredAbilityId: ETB_ID,
        triggerSourceId: `src-${id}`,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: `src-${id}`,
            controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
    };
}

/** A board where BOTH modes are choosable: p1 controls a tapped bear (untap
 *  target), p2 controls an untapped bear (tap target). */
function twoSidedBoard(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "mine",
                        controllerId: "p1",
                        ownerId: "p1",
                        isTapped: true,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "theirs",
                        controllerId: "p2",
                        ownerId: "p2",
                        isTapped: false,
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function submitHead(state: GameState, id: string) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [id],
    });
}

describe("modal triggered abilities — announcement (CR 603.3c)", () => {
    it("raises the mode choice for the controller as the trigger goes on the stack", () => {
        const state = twoSidedBoard();
        const trig = mkTrigger("t1");
        state.stack.push(trig);

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("trigger-mode");
        expect(head.playerId).toBe("p1");
        expect(head.stackItemId).toBe("t1");
        expect(head.count).toBe(1);
        expect(head.options?.map((o) => o.id)).toEqual([
            "untap-yours",
            "tap-theirs",
        ]);
        // Priority parks on the chooser and the trigger is still on the stack —
        // announcing a mode is not resolving the ability.
        expect(state.priorityPlayerId).toBe("p1");
        expect(state.stack).toHaveLength(1);
        // No target is chosen before the mode is (CR 700.2c).
        expect(trig.targets).toBeUndefined();
        expect(state.pendingTarget).toBeUndefined();
    });

    it("only the chosen mode's requirement constrains the targets (CR 700.2c)", () => {
        const state = twoSidedBoard();
        const trig = mkTrigger("t1");
        state.stack.push(trig);
        raiseTriggerTargetSelection(state);

        submitHead(state, "tap-theirs");
        expect(trig.chosenModeId).toBe("tap-theirs");
        // The board holds two permanents; only ONE is legal under the announced
        // mode, so it auto-selects. Under the sibling mode's requirement — or
        // under an un-scoped one — the other bear would be legal too and a
        // PendingTarget would have been raised instead.
        expect(trig.targets).toEqual([{ type: "permanent", id: "theirs" }]);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("a mode whose required target has no legal candidate can't be chosen (CR 603.3c)", () => {
        // p2 controls nothing, so "tap target permanent an opponent controls"
        // is illegal and never reaches the prompt. One choosable mode left =>
        // no decision => announced with no prompt at all.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        const trig = mkTrigger("t1");
        state.stack.push(trig);

        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.pendingChoices).toBeUndefined();
        expect(trig.chosenModeId).toBe("untap-yours");
        expect(trig.targets).toEqual([{ type: "permanent", id: "mine" }]);
    });

    it("with no choosable mode the ability is removed from the stack (CR 603.3c)", () => {
        // Neither player controls a permanent: both modes are illegal.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
        });
        state.stack.push(mkTrigger("t1"));

        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.pendingTarget).toBeUndefined();
    });

    it("the announced mode is immutable and drives resolution (CR 700.2b / 700.2f)", () => {
        const state = twoSidedBoard();
        const trig = mkTrigger("t1");
        state.stack.push(trig);
        raiseTriggerTargetSelection(state);
        submitHead(state, "tap-theirs");

        // A second announcement sweep must not re-raise the mode choice — the
        // pick is locked once made.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.pendingChoices).toBeUndefined();
        expect(trig.chosenModeId).toBe("tap-theirs");

        resolveTopOfStack(state);
        // The ANNOUNCED mode's script ran (tap), not its sibling's (untap):
        // the opponent's bear is now tapped and p1's stays tapped.
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")!
                .isTapped
        ).toBe(true);
        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")!.isTapped
        ).toBe(true);
    });

    it("rejects a submission naming a mode that was not offered", () => {
        const state = twoSidedBoard();
        state.stack.push(mkTrigger("t1"));
        raiseTriggerTargetSelection(state);
        expect(() => submitHead(state, "no-such-mode")).toThrow(
            /Not a legal mode/
        );
    });
});

describe("modal triggered abilities — the trigger item is built un-announced (CR 603.3c)", () => {
    it("does not inherit a stale chosenModeId from the source permanent", () => {
        // `buildTriggerItem` spreads the SOURCE permanent (`...self`) to make
        // the trigger item, and a battlefield permanent legitimately carries an
        // instance-level `chosenModeId` from its own modal cast —
        // `resetStackTransientState` strips it only on a NON-battlefield exit,
        // because `getEffectiveStaticEffects` reads it on the battlefield. If
        // the spread carried it onto the trigger,
        // `raiseTriggerModeAnnouncement` would read the item as already
        // announced and skip it: no prompt, no error, and a resolution with a
        // mode nobody chose. CR 700.2b — the mode is chosen as part of putting
        // the ability on the stack, never inherited.
        const state = twoSidedBoard();
        const exarch = makeInstance(deceiverExarch.id, {
            id: "exarch",
            controllerId: "p1",
            ownerId: "p1",
        });
        exarch.chosenModeId = "some-spell-mode";
        state.players[0].battlefield.push(exarch);

        // The REAL producer path: collect the ETB trigger and put it on the
        // stack, exactly as the engine does after a permanent enters.
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "exarch",
                controllerId: "p1",
                types: ["Creature"],
            } as GameEvent,
        ]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].chosenModeId).toBeUndefined();

        placeTriggersOnStack(state, triggers);
        const item = state.stack[0];
        expect(item.chosenModeId).toBeUndefined();
        // The announcement is actually owed — the controller is prompted with
        // both modes rather than the trigger sailing through un-announced.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("trigger-mode");
        expect(head.options?.map((o) => o.id)).toEqual([
            "untap-yours",
            "tap-theirs",
        ]);

        // …and the announced mode really runs: the opponent's untapped bear
        // ends up tapped, where an inherited mode resolved as nothing.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["tap-theirs"],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")!
                .isTapped
        ).toBe(true);
    });
});

describe("modal triggered abilities — ordering identity (CR 603.3b)", () => {
    it("two copies of one modal trigger go to a real ordering decision", () => {
        // Pre-#2461 these two were keyed as the SAME printed ability and
        // auto-ordered (ADR 0003's outcome-interchangeable premise). Once each
        // announces its own mode they are not interchangeable.
        const state = twoSidedBoard();
        const landed = placeTriggersOnStack(state, [
            mkTrigger("t1"),
            mkTrigger("t2"),
        ]);
        expect(landed).toBe(false);
        expect(state.stack).toHaveLength(0);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("trigger-order");
        expect(head.candidateIds).toEqual(["t1", "t2"]);
    });
});

describe("modal triggered abilities — client-facing seams", () => {
    it("the announcement is an owed CHOICE for the chooser and a legal submit action", () => {
        const state = twoSidedBoard();
        state.stack.push(mkTrigger("t1"));
        raiseTriggerTargetSelection(state);

        // What the `submitResolutionChoice` mutation gates on.
        const expected = computeExpectedInput(state)!;
        expect(expected.kind).toBe("choice");
        expect(expected.playerId).toBe("p1");

        // What the bot enumerates: one submit per choosable mode. Without a
        // `trigger-mode` branch this falls through to the zone-pick enumerator,
        // finds no zone, and returns nothing — a frozen game.
        const actions = legalActions(state);
        expect(
            actions.map((a) =>
                a.action.kind === "submit-choice"
                    ? a.action.cardInstanceIds[0]
                    : null
            )
        ).toEqual(["untap-yours", "tap-theirs"]);
    });

    it("the announced mode survives the wire projection to the OPPONENT's view", () => {
        const state = twoSidedBoard();
        state.stack.push(mkTrigger("t1"));
        raiseTriggerTargetSelection(state);
        submitHead(state, "tap-theirs");

        // The mode is public once announced (both players may respond knowing
        // it), so it must survive the projection the client subscribes to. The
        // stack-row reducer that renders it is asserted in
        // `src/lib/__tests__/card-utils.test.ts` (a `src/` module cannot be
        // imported from the convex tsconfig project).
        const projected = projectPublicState(state, 1, "p2");
        const row = projected.stack.find((s) => s.id === "t1")!;
        expect(row.chosenModeId).toBe("tap-theirs");
    });

    it("the pending mode choice is visible to both viewers while it is owed", () => {
        const state = twoSidedBoard();
        state.stack.push(mkTrigger("t1"));
        raiseTriggerTargetSelection(state);

        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const head = projected.pendingChoices?.[0];
            expect(head?.kind).toBe("trigger-mode");
            expect(head?.options?.map((o) => o.id)).toEqual([
                "untap-yours",
                "tap-theirs",
            ]);
        }
    });

    it("the announced mode round-trips through persistence", () => {
        const state = twoSidedBoard();
        state.stack.push(mkTrigger("t1"));
        raiseTriggerTargetSelection(state);
        submitHead(state, "tap-theirs");

        const restored = expandState(compactState(state));
        const item = restored.stack.find((s) => s.id === "t1")!;
        expect(item.chosenModeId).toBe("tap-theirs");
        expect(item.targets).toEqual([{ type: "permanent", id: "theirs" }]);
    });
});
