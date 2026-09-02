// Deep-Cavern Bat (LCI) — a PRIVATE whole-hand look (CR 400.2, the `lookHand`
// Op from issue #2383) followed by an OPTIONAL linked exile (CR 607) that the
// creature's leaves-the-battlefield trigger returns to its OWNER's hand
// (CR 400.7). Pure DSL over already-exercised Ops, so the per-Op regime covers
// the Ops themselves; what is tested here is the composition the card is.
//
// The three properties that are this card and not Elite Spellbinder's:
// declining the optional pick, the linked round trip, and the exile surviving
// arbitrarily many turns before the Bat leaves (the property the retired stub
// cited `scheduleDelayedTrigger`'s this-turn purge as the blocker for).
//
// Fixtures from `convex/cards/__tests__/setup.ts`.
import { describe, it, expect } from "vitest";
import { deepCavernBat } from "../black";
import { grizzlyBears, swamp } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition, getCardByName } from "../../..";
import { projectPublicState } from "../../../../gameProjections";
import {
    removePermanentTo,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeCleanup } from "../../../../gre/phases";

/** p1's Bat on the battlefield; p2 holds `hand`. */
function setup(hand: CardInstanceState[]) {
    const bat = makeInstance(deepCavernBat.id, {
        id: "bat",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [bat] }),
            makePlayer("p2", { hand }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, bat };
}

function handCard(def: { id: string }, id: string): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
}

/** Puts the ETB trigger on the stack and runs the REAL CR 603.3d announcement
 *  sweep. `targets` is left UNSET on purpose: "target opponent" is a real
 *  target, so the ENGINE must pick it — a fixture that sets it itself never
 *  asks whether the choice was legal. p2 is the sole opponent, so the
 *  mandatory single target auto-locks with no prompt. */
function etbTriggerOnStack(state: GameState, source: CardInstanceState): void {
    const trig: StackItem = {
        ...source,
        id: "bat-etb-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "deep-cavern-bat-exile",
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
    expect(raiseTriggerTargetSelection(state)).toBe(false);
    expect(trig.targets).toEqual([{ type: "player", id: "p2" }]);
}

/** Answers the head PendingChoice with `ids` (`[]` declines the "may"). */
function answer(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

/** Sends the Bat to the graveyard and resolves its leave trigger. */
function batLeaves(state: GameState): void {
    removePermanentTo(state, "bat", "graveyard");
    processPendingActionTriggers(state);
    const trig = state.stack.find(
        (s) => s.triggeredAbilityId === "deep-cavern-bat-return"
    );
    expect(trig).toBeDefined();
    resolveTopOfStack(state);
}

describe("Deep-Cavern Bat (LCI — private look + optional linked exile, returned on leave; CR 400.2 / 607 / 400.7)", () => {
    it("registers by id and name, and carries flying", () => {
        expect(getDefinition(deepCavernBat.id)).toBe(deepCavernBat);
        expect(getCardByName("Deep-Cavern Bat")).toBe(deepCavernBat);
        expect(deepCavernBat.staticAbilities).toContain("flying");
    });

    it("looks privately at the whole hand, then exiles the chosen nonland card into the OPPONENT's exile stamped with the Bat (CR 607)", () => {
        const { state } = setup([
            handCard(grizzlyBears, "bears"),
            handCard(swamp, "land"),
        ]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the pick

        // CR 400.2 — the look is PRIVATE and covers the WHOLE hand: every
        // card is known to the looker ALONE, the land included, before any
        // pick narrows anything. A public `reveal` would have stamped both
        // players (`markKnownToAll`), which is a different game action.
        for (const c of state.players[1].hand) {
            expect(c.knownTo).toEqual(["p1"]);
        }

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        expect(head.playerId).toBe("p1"); // the controller chooses…
        expect(head.zoneOwnerId).toBe("p2"); // …from the opponent's hand
        // "a nonland card" — the land is not offerable.
        expect(head.candidateIds).toEqual(["bears"]);

        answer(state, ["bears"]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["land"]);
        expect(state.players[0].exile).toHaveLength(0); // never the controller's
        const exiled = state.players[1].exile.find((c) => c.id === "bears");
        expect(exiled).toBeDefined();
        expect(exiled!.exiledBySourceId).toBe("bat");
        expect(state.stack).toHaveLength(0);
    });

    it('declining the "may" exiles nothing, and the later leave is a clean no-op (CR 608.2b)', () => {
        const { state } = setup([handCard(grizzlyBears, "bears")]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        resolveTopOfStack(state);

        // "You MAY exile" — count { min: 0, max: 1 }, so the empty submission
        // is legal and is a real branch, not a degenerate one.
        expect(state.pendingChoices![0].count).toEqual({ min: 0, max: 1 });
        answer(state, []);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bears"]);
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.stack).toHaveLength(0);

        // The leave trigger still fires — there is no `condition` gate — and
        // returns nothing.
        batLeaves(state);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bears"]);
        expect(state.players[1].exile).toHaveLength(0);
    });

    it("the leave trigger returns the exiled card to its OWNER's hand, not the controller's (CR 400.7)", () => {
        const { state } = setup([handCard(grizzlyBears, "bears")]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        resolveTopOfStack(state);
        answer(state, ["bears"]);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["bears"]);

        batLeaves(state);

        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bears"]);
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("the exile survives arbitrarily many turns and CLEANUP steps before the Bat leaves", () => {
        const { state } = setup([handCard(grizzlyBears, "bears")]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        resolveTopOfStack(state);
        answer(state, ["bears"]);

        // The retired stub blocked this card on `scheduleDelayedTrigger`'s
        // `leaves-battlefield` timing being THIS-TURN scoped (purged at
        // CLEANUP). The linked-exile channel has no such scope: run six
        // cleanup steps across six turns and the link is still there.
        for (let turn = 1; turn <= 6; turn++) {
            state.turn = turn;
            state.activePlayerId = turn % 2 === 1 ? "p1" : "p2";
            finalizeCleanup(state);
            expect(
                state.players[1].exile.find((c) => c.id === "bears")
                    ?.exiledBySourceId
            ).toBe("bat");
        }

        batLeaves(state);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bears"]);
    });

    it("the look happens even when the pick never raises — an all-land hand is looked at and no choice is offered (CR 608.2b)", () => {
        const { state } = setup([handCard(swamp, "s1"), handCard(swamp, "s2")]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        resolveTopOfStack(state);

        // Nothing matches the nonland filter, so the `choice` Op is skipped
        // outright — and the look, its own game action, still happened. This
        // is what separates `lookHand` from the pick's own #1698 exposure,
        // which never opens when no choice is raised.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
        for (const c of state.players[1].hand) {
            expect(c.knownTo).toEqual(["p1"]);
        }

        // SURFACE — the knowledge OUTLIVES the resolution (ADR 0026: you
        // looked, you know), so the looker's projection still carries the
        // real hand with no pick pending to expose it.
        const forLooker = projectPublicState(state, 1, "p1");
        expect(forLooker.players[1].hand.map((c) => c?.card?.id)).toEqual([
            swamp.id,
            swamp.id,
        ]);
    });

    it("wire: the exiled card is face up to BOTH viewers and pinned to the Bat, while the un-exiled remainder stays private to the looker", () => {
        const { state } = setup([
            handCard(grizzlyBears, "bears"),
            handCard(swamp, "land"),
        ]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        resolveTopOfStack(state);
        answer(state, ["bears"]);

        // CR 406.3 — exile is a public zone (CR 400.2) and this card's text
        // grants no face-down clause, so entering exile cleared `knownTo`
        // (ADR 0026) and the card is face up to everyone.
        const exiled = state.players[1].exile.find((c) => c.id === "bears")!;
        expect(exiled.knownTo).toBeUndefined();
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[1].exile.find(
                (c) => c.id === "bears"
            );
            expect(slim, `exile card missing for ${viewer}`).toBeDefined();
            expect(slim!.card?.id).toBe(grizzlyBears.id);
            expect(slim!.exiledByPermanentId).toBe("bat");
        }

        // The card that was NOT taken stays known to the looker alone — the
        // private look must not have leaked into the public exile grant.
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);
    });
});
