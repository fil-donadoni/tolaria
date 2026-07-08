// usg red — Echo (CR 702.30) via Goblin Patrol (#990).
//
// Echo is a NEW keyword this set introduces: the `echoPending` instance flag +
// the `echoTrigger` template (convex/cards/abilities/echo.ts). Per the per-Op /
// new-mechanic test regime (.claude/rules/gre-development.md), the mechanic
// earns a full test here — ETB flag set, the upkeep pay-or-sacrifice both ways,
// the fire-exactly-once intervening-if, and a wire-format re-assert of the
// board-visible outcome (survives / sacrificed).

import { describe, it, expect } from "vitest";
import { goblinPatrol } from "..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";

const ECHO_ABILITY = "goblin-patrol-echo";

/** A PHASE_BEGIN UPKEEP trigger event for `playerId`'s upkeep (CR 500.1). */
const upkeepEvent = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** Push the echo trigger onto the stack with the source's upkeep event and
 *  resolve it (mirrors the ice cumulative-upkeep test harness). */
function fireEcho(state: GameState, source: CardInstanceState): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: ECHO_ABILITY,
        triggerSourceId: source.id,
        triggerEvent: upkeepEvent(source.controllerId),
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Answer the head may-pay choice, resuming the suspended resolution. */
function answerMayPay(state: GameState, accept: boolean): void {
    const head = state.pendingChoices![0];
    applyMayPaySubmit(state, { playerId: head.playerId, accept });
}

describe("Goblin Patrol — Echo {R} (CR 702.30)", () => {
    it("is a {R} 2/1 Goblin that declares the echo keyword", () => {
        expect(goblinPatrol.manaCost).toEqual({ R: 1 });
        expect(goblinPatrol.power).toBe(2);
        expect(goblinPatrol.toughness).toBe(1);
        expect(goblinPatrol.subtypes).toContain("Goblin");
        // Keyword census (CR 702.30) — the string drives the ETB echoPending flag.
        expect(goblinPatrol.staticAbilities).toContain("echo");
        // The upkeep trigger is present with the expected id.
        expect(
            (goblinPatrol.triggeredAbilities ?? []).some(
                (t) => t.id === ECHO_ABILITY
            )
        ).toBe(true);
    });

    it("sets echoPending when it enters the battlefield (CR 702.30a)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, goblinPatrol.id, "p1");
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === goblinPatrol.id
        )!;
        expect(live).toBeDefined();
        expect(live.echoPending).toBe(true);
    });

    it("declining the echo cost sacrifices it (CR 702.30a) — survives wire", () => {
        const patrol = makeInstance(goblinPatrol.id, {
            id: "patrol",
            controllerId: "p1",
            ownerId: "p1",
            echoPending: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [patrol], manaPool: { R: 1 } }),
                makePlayer("p2"),
            ],
        });
        fireEcho(state, patrol);
        answerMayPay(state, false);
        // Sacrificed to the graveyard.
        expect(
            state.players[0].battlefield.find((c) => c.id === "patrol")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "patrol")).toBe(
            true
        );
        // Wire format — the board-visible sacrifice survives the projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "patrol")
        ).toBe(false);
    });

    it("paying the echo cost keeps it and never re-fires (CR 702.30a)", () => {
        const patrol = makeInstance(goblinPatrol.id, {
            id: "patrol",
            controllerId: "p1",
            ownerId: "p1",
            echoPending: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [patrol], manaPool: { R: 1 } }),
                makePlayer("p2"),
            ],
        });
        fireEcho(state, patrol);
        answerMayPay(state, true);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "patrol"
        )!;
        expect(live).toBeDefined();
        // Paid → flag cleared so echo never re-triggers.
        expect(live.echoPending).toBeUndefined();

        // Second upkeep: the intervening-if is now false → the trigger fizzles
        // with no may-pay prompt, and the creature stays.
        state.players[0].manaPool = { R: 1 };
        fireEcho(state, live);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "patrol")
        ).toBe(true);

        // Wire format — the survivor is present in the projected board.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "patrol")
        ).toBe(true);
    });

    it("does not fire when echoPending is unset (CR 603.4d intervening-if)", () => {
        const patrol = makeInstance(goblinPatrol.id, {
            id: "patrol",
            controllerId: "p1",
            ownerId: "p1",
            // no echoPending — controlled since before the last upkeep
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [patrol], manaPool: { R: 1 } }),
                makePlayer("p2"),
            ],
        });
        fireEcho(state, patrol);
        // Trigger fizzles: no prompt, creature untouched.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "patrol")
        ).toBe(true);
    });
});
