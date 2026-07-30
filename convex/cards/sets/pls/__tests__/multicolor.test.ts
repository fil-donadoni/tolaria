// Planeshift (PLS) — multicolor behavior tests (ADR 0043 colour split, issue
// #1944).
//
// Keldon Twilight is a DSL card, but it introduces a genuinely new construct
// combination the auto-generated canned-scenario smoke sweep cannot drive: a
// CR 603.4 intervening-if reading the new game-level
// `creatureAttackedThisTurn` flag, and a new `EffectCardFilter` clause
// (`controlledSinceTurnStart`) whose truth depends on turn-scoped state the
// generator has no way to arrange. Per the per-Op regime
// (`.claude/rules/gre-development.md`) that earns hand-written coverage here,
// including the wire-format leg — the sacrifice picker's legality is read
// CLIENT-side off projected fields, so a projection that dropped them would
// leave the card correct on the server and dead on the board.

import { describe, it, expect } from "vitest";
import { keldonTwilight } from "../multicolor";
import { grizzlyBears, savannahLions, controlMagic } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    applyControlChange,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import type { PhaseBeginEvent } from "../../../types";

const ABILITY = keldonTwilight.triggeredAbilities!.find(
    (a) => a.id === "keldon-twilight-end-step-sac"
)!;

const endStepEvent = (playerId: string): PhaseBeginEvent => ({
    type: "PHASE_BEGIN",
    phase: "END_STEP",
    activePlayerId: playerId,
});

/** Pushes Keldon Twilight's end-step trigger for `activePlayerId` and resolves
 *  it, exactly as the engine does (`resolveTopOfStack` runs the CR 603.4d
 *  intervening-if re-check before the body). */
function fireEndStep(
    state: GameState,
    source: CardInstanceState,
    activePlayerId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: ABILITY.id,
        triggerSourceId: source.id,
        triggerEvent: endStepEvent(activePlayerId),
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

/** Answers the head `sacrifice-permanents` choice through the REAL server
 *  submit path, so the pick is re-validated against the pending choice's
 *  filter (`effectivePermanentView` + `matchesPermanentFilter`). */
function submitSacrifice(state: GameState, cardInstanceId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [cardInstanceId],
    });
}

/** Board: Keldon Twilight under p1, one long-standing creature per player. */
function twoPlayerBoard(turn = 5) {
    const twilight = makeInstance(keldonTwilight.id, {
        id: "twilight",
        controllerId: "p1",
        ownerId: "p1",
    });
    const mine = makeInstance(grizzlyBears.id, {
        id: "mine",
        controllerId: "p1",
        ownerId: "p1",
    });
    mine.enteredOnTurn = 1;
    const theirs = makeInstance(savannahLions.id, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
    });
    theirs.enteredOnTurn = 1;
    const state = makeState({
        turn,
        players: [
            makePlayer("p1", { battlefield: [twilight, mine] }),
            makePlayer("p2", { battlefield: [theirs] }),
        ],
    });
    return { state, twilight, mine, theirs };
}

describe("Keldon Twilight — card data (Scryfall / modern Oracle text)", () => {
    it("is a {1}{B}{R} rare Enchantment", () => {
        expect(keldonTwilight.manaCost).toEqual({ X: 1, B: 1, R: 1 });
        expect(keldonTwilight.types).toEqual(["Enchantment"]);
        expect(keldonTwilight.rarity).toBe("rare");
        expect(keldonTwilight.oracleText).toBe(
            "At the beginning of each player's end step, if no creatures attacked this turn, that player sacrifices a creature of their choice that they controlled since the beginning of the turn."
        );
    });

    it("declares exactly one triggered ability, written as an Effect Script (ADR 0045)", () => {
        expect(keldonTwilight.triggeredAbilities).toHaveLength(1);
        expect(ABILITY.effects).toBeDefined();
        expect(ABILITY.resolve).toBeUndefined();
    });
});

describe("Keldon Twilight — trigger scope (CR 603.6a, 'each player's end step')", () => {
    it("fires on EACH player's end step, and the sacrificing player is that player", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const self = { ...twilight } as never;

        // p1's own end step.
        expect(ABILITY.matches!(endStepEvent("p1"), self, state)).toBe(true);
        fireEndStep(state, twilight, "p1");
        expect(state.pendingChoices![0].playerId).toBe("p1");
        submitSacrifice(state, mine.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);

        // p2's end step — the OPPONENT is asked, not Keldon Twilight's
        // controller. (`{ ref: "$event.activePlayerId" }`, not "controller".)
        const second = twoPlayerBoard().state;
        const twilight2 = second.players[0].battlefield[0];
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight2 as never, second)
        ).toBe(true);
        fireEndStep(second, twilight2, "p2");
        expect(second.pendingChoices![0].playerId).toBe("p2");
        submitSacrifice(second, "theirs");
        expect(second.players[1].graveyard.map((c) => c.id)).toEqual([
            "theirs",
        ]);
    });

    it("does not fire on other steps", () => {
        const { state, twilight } = twoPlayerBoard();
        expect(
            ABILITY.matches!(
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p1",
                } as PhaseBeginEvent,
                twilight as never,
                state
            )
        ).toBe(false);
    });
});

describe("Keldon Twilight — intervening-if 'if no creatures attacked this turn' (CR 603.4 / 603.4d)", () => {
    it("does not trigger at all once a creature has attacked this turn", () => {
        const { state, twilight } = twoPlayerBoard();
        state.creatureAttackedThisTurn = true;
        expect(
            ABILITY.matches!(endStepEvent("p1"), twilight as never, state)
        ).toBe(false);
    });

    it("fizzles on RESOLUTION if the condition became false after the trigger went on the stack (CR 603.4d)", () => {
        const { state, twilight } = twoPlayerBoard();
        state.stack.push({
            ...twilight,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: ABILITY.id,
            triggerSourceId: twilight.id,
            triggerEvent: endStepEvent("p1"),
            targets: [],
        } as StackItem);
        state.creatureAttackedThisTurn = true;
        resolveTopOfStack(state);
        // No sacrifice choice was ever raised and nothing died.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("counts ANY player's creatures — the OPPONENT attacking suppresses it too", () => {
        const { state, twilight } = twoPlayerBoard();
        // The flag is game-level, so an attack by p2's creature during p2's
        // turn silences the trigger on p2's own end step.
        state.creatureAttackedThisTurn = true;
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight as never, state)
        ).toBe(false);
        state.creatureAttackedThisTurn = undefined;
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight as never, state)
        ).toBe(true);
    });
});

describe("Keldon Twilight — '…that they controlled since the beginning of the turn'", () => {
    it("excludes a creature that ENTERED this turn", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const fresh = makeInstance(savannahLions.id, {
            id: "fresh",
            controllerId: "p1",
            ownerId: "p1",
        });
        fresh.enteredOnTurn = state.turn;
        state.players[0].battlefield.push(fresh);
        fireEndStep(state, twilight, "p1");
        // Only the long-standing creature is offered; picking the fresh one
        // is rejected by the server's own submit validation.
        expect(() => submitSacrifice(state, "fresh")).toThrow();
        submitSacrifice(state, mine.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);
    });

    it("excludes a creature whose CONTROL changed this turn, in either direction", () => {
        const { state, twilight } = twoPlayerBoard();
        const magic = makeInstance(controlMagic.id, {
            id: "magic",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(magic);
        // p1 steals p2's long-standing creature this turn.
        applyControlChange(state, "theirs", "p1", "magic");
        // p1's own creature leaves via the same steal in reverse: give
        // "mine" to p2 as well so p1 has ONLY the freshly-stolen creature.
        applyControlChange(state, "mine", "p2", "magic");
        fireEndStep(state, twilight, "p1");
        // Nothing legal for p1 → no choice raised, nothing sacrificed.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(0);
        // …and p2, who now controls "mine", also may not sacrifice it: they
        // did not control it when the turn began.
        fireEndStep(state, twilight, "p2");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("does nothing (and does not throw) when the player controls no legal creature", () => {
        const { state, twilight } = twoPlayerBoard();
        state.players[0].battlefield = [twilight];
        fireEndStep(state, twilight, "p1");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
        // The trigger still resolved off the stack — the player sees it come
        // and go under its own oracle text.
        expect(state.stack).toHaveLength(0);
    });

    it("is the controller's EXPLICIT choice — the picker is raised even with several legal creatures and nothing is auto-sacrificed", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const second = makeInstance(savannahLions.id, {
            id: "second",
            controllerId: "p1",
            ownerId: "p1",
        });
        second.enteredOnTurn = 1;
        state.players[0].battlefield.push(second);
        fireEndStep(state, twilight, "p1");
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1");
        expect(state.players[0].graveyard).toHaveLength(0);
        submitSacrifice(state, second.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["second"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            mine.id
        );
    });
});

describe("Keldon Twilight — wire format (the picker's legality is read client-side)", () => {
    it("the projection preserves the turn-scoped fields the client filter reads", () => {
        const { state, twilight } = twoPlayerBoard();
        const magic = makeInstance(controlMagic.id, {
            id: "magic",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(magic);
        applyControlChange(state, "theirs", "p1", "magic");
        state.creatureAttackedThisTurn = true;

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.turn).toBe(state.turn);
        expect(projected.controlChangedThisTurn).toEqual(["theirs"]);
        expect(projected.creatureAttackedThisTurn).toBe(true);
        const slimStolen = projected.players[0].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(slimStolen.enteredOnTurn).toBe(1);

        fireEndStep(state, twilight, "p1");
        // Suppressed by the intervening-if reading the projected-safe flag.
        expect(state.pendingChoices).toBeUndefined();
    });

    it("the raised choice carries the filter across the wire so the board can highlight it", () => {
        const { state, twilight } = twoPlayerBoard();
        fireEndStep(state, twilight, "p1");
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.filter).toMatchObject({
            types: "Creature",
            controlledSinceTurnStart: true,
        });
    });
});
