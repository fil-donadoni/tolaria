// LCI red — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Inti, Seneschal of the Sun composes ONLY already-exercised constructs
// (reflexiveTrigger — Minsc & Boo, clb/multicolor.ts; the impulse-draw
// protocol — Ragavan/Robber of the Rich), so this file exists to pin the
// CARD (both abilities wired together, driven through the real stack), not
// to re-prove the underlying machinery.

import { describe, it, expect } from "vitest";
import { intiSeneschalOfTheSun } from "../red";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";

const grizzlyBears = getCardByName("Grizzly Bears");

function pushAttackTrigger(state: GameState, inti: CardInstanceState) {
    state.stack.push({
        ...inti,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "inti-attack-discard",
        triggerSourceId: inti.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: [inti.id],
        } as StackItem["triggerEvent"],
        targets: [],
    });
}

function boardWithAttackingInti(): {
    state: GameState;
    inti: CardInstanceState;
} {
    const inti = makeInstance(intiSeneschalOfTheSun.id, {
        id: "inti",
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
    const handCard = makeInstance(grizzlyBears.id, {
        id: "hand-card",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [inti], hand: [handCard] }),
            makePlayer("p2"),
        ],
    });
    return { state, inti };
}

describe("Inti, Seneschal of the Sun (CR 603.3c reflexive trigger + impulse draw, issue #1527)", () => {
    it("is a {1}{R} 2/2 Legendary Creature — Human Knight", () => {
        expect(intiSeneschalOfTheSun.manaCost).toEqual({ X: 1, R: 1 });
        expect(intiSeneschalOfTheSun.power).toBe(2);
        expect(intiSeneschalOfTheSun.toughness).toBe(2);
        expect(intiSeneschalOfTheSun.subtypes).toEqual(["Human", "Knight"]);
    });

    it("declining the discard does nothing — no reflexive trigger, hand untouched", () => {
        const { state, inti } = boardWithAttackingInti();
        pushAttackTrigger(state, inti);
        resolveTopOfStack(state); // suspends at the choice
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: [], // decline the optional discard
        });
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.stack.some((s) => s.reflexiveTrigger)).toBe(false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "inti")
                ?.counters?.["+1/+1"]
        ).toBeUndefined();
    });

    it("discarding fires the reflexive trigger: +1/+1 counter and trample on target attacking creature", () => {
        const { state, inti } = boardWithAttackingInti();
        const top = getCardByName("Grizzly Bears");
        state.players[0].library = [
            makeInstance(top.id, {
                id: "own-top",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        pushAttackTrigger(state, inti);
        resolveTopOfStack(state); // suspends at the choice
        const pick = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["hand-card"],
        });
        expect(state.players[0].hand).toHaveLength(0);
        expect(
            state.players[0].graveyard.some((c) => c.id === "hand-card")
        ).toBe(true);

        // CR 603.3b (ADR 0058) — the discard ALSO fires Inti's OWN second
        // ability (the "whenever you discard" impulse trigger, same event),
        // so both it and the reflexive trigger become simultaneously
        // waiting and need APNAP ordering before either lands on the stack.
        const orderPick = state.pendingChoices![0];
        expect(orderPick.kind).toBe("trigger-order");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: orderPick.stackItemId,
            step: orderPick.step,
            choiceId: orderPick.choiceId,
            cardInstanceIds: orderPick.candidateIds!,
        });

        // Resolve both stacked triggers, providing the reflexive's target
        // (CR 603.3d — announced only once it's actually on the stack).
        while (state.stack.length > 0) {
            if (raiseTriggerTargetSelection(state)) {
                state.pendingTarget!.selected = [
                    { type: "permanent", id: "inti" },
                ];
                finalizeTargetSelection(
                    state,
                    state.pendingTarget!,
                    state.pendingTarget!.playerId
                );
            }
            resolveTopOfStack(state);
        }

        const after = state.players[0].battlefield.find(
            (c) => c.id === "inti"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(after.grantedStaticAbilities?.[0]?.ability).toBe("trample");

        // The SAME discard also drove Inti's second ability: its own top
        // library card is exiled with a this-turn cast grant.
        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].exile).toHaveLength(1);
        expect(state.players[0].exile[0].id).toBe("own-top");
        expect(state.players[0].exile[0].castableFromExileBy).toBe("p1");
    });
});

describe("Inti, Seneschal of the Sun — discard-triggered impulse draw", () => {
    it("exiles the controller's own top library card and grants a this-turn cast permission", () => {
        const inti = makeInstance(intiSeneschalOfTheSun.id, {
            id: "inti",
            controllerId: "p1",
            ownerId: "p1",
        });
        const top = makeInstance(grizzlyBears.id, {
            id: "top-card",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            turn: 2,
            players: [
                makePlayer("p1", { battlefield: [inti], library: [top] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...inti,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "inti-discard-impulse",
            triggerSourceId: inti.id,
            triggerEvent: {
                type: "CARD_DISCARDED",
                playerId: "p1",
                cardInstanceId: "some-other-card",
            } as StackItem["triggerEvent"],
            targets: [],
        });
        resolveTopOfStack(state);

        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].exile).toHaveLength(1);
        const exiled = state.players[0].exile[0];
        expect(exiled.id).toBe("top-card");
        expect(exiled.castableFromExileBy).toBe("p1");
        expect(exiled.castableFromExileUntilTurn).toBe(2);
        expect(exiled.knownTo).toEqual(["p1"]);
    });
});
