// Tidehollow Sculler (ALA) — TWO printed triggered abilities (CR 603.2): an
// ETB that reveals the announced opponent's hand and exiles a nonland card
// LINKED to this creature (CR 607, `exiledBySourceId`), and a leaves-the-
// battlefield trigger that returns that card to its OWNER's hand (CR 400.7).
//
// The card is pure DSL over already-exercised Ops, so the per-Op regime
// covers the Ops themselves. What is tested here is the COMPOSITION the card
// is: that the link survives the round trip and lands the card back in the
// OPPONENT's hand rather than the controller's, and the printed stack
// interaction (kill the Sculler in response to its own ETB and the card stays
// exiled indefinitely) that is this card's defining play pattern.
//
// Fixtures from `convex/cards/__tests__/setup.ts`. The `choice` Op suspends
// mid-resolution for the controller's pick, so the DSL smoke sweep skips this
// script — these tests are the coverage.
import { describe, it, expect } from "vitest";
import { tidehollowSculler } from "../multicolor";
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

/** p1's Sculler on the battlefield; p2 holds `hand`. */
function setup(hand: CardInstanceState[]) {
    const sculler = makeInstance(tidehollowSculler.id, {
        id: "sculler",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [sculler] }),
            makePlayer("p2", { hand }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, sculler };
}

function handCard(def: { id: string }, id: string): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
}

/** Puts the ETB trigger on the stack WITHOUT resolving it, then runs the REAL
 *  CR 603.3d announcement sweep. `targets` is left UNSET on purpose: "target
 *  opponent" is a real target, so the ENGINE must pick it — a fixture that
 *  sets `targets` itself never asks whether the choice was legal. With p2 the
 *  sole opponent the sole mandatory target auto-locks, no prompt. */
function etbTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "sculler-etb-trig",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "tidehollow-sculler-exile",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: ["Artifact", "Creature"],
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    expect(raiseTriggerTargetSelection(state)).toBe(false);
    expect(trig.targets).toEqual([{ type: "player", id: "p2" }]);
    return trig;
}

/** Resolves the ETB trigger through its `choose-hand-card` suspension,
 *  submitting `pick` as the controller's choice. Returns the raised choice so
 *  callers can assert on the candidate set. */
function resolveEtbPicking(state: GameState, pick: string) {
    resolveTopOfStack(state);
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("choose-hand-card");
    // The CHOOSER is the controller, the ZONE OWNER the announced opponent —
    // the Thoughtseize `zoneOwnerId` split (issue #920).
    expect(head.playerId).toBe("p1");
    expect(head.zoneOwnerId).toBe("p2");
    applyPendingChoiceSubmit(state, {
        playerId: "p1",
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [pick],
    });
    return head;
}

/** Fires the leaves-the-battlefield trigger by sending the Sculler to the
 *  graveyard, then resolves it. */
function scullerLeaves(state: GameState): void {
    removePermanentTo(state, "sculler", "graveyard");
    processPendingActionTriggers(state);
    const trig = state.stack.find(
        (s) => s.triggeredAbilityId === "tidehollow-sculler-return"
    );
    expect(trig).toBeDefined();
    resolveTopOfStack(state);
}

describe("Tidehollow Sculler (ALA — linked hand exile + return on leave, CR 603.2 / 607 / 400.7)", () => {
    it("registers by id and name", () => {
        expect(getDefinition(tidehollowSculler.id)).toBe(tidehollowSculler);
        expect(getCardByName("Tidehollow Sculler")).toBe(tidehollowSculler);
    });

    it("ETB exiles the chosen nonland card into the OPPONENT's exile, stamped with the Sculler's instance (CR 607)", () => {
        const { state } = setup([
            handCard(grizzlyBears, "bears"),
            handCard(swamp, "land"),
        ]);
        const sculler = state.players[0].battlefield[0];
        etbTriggerOnStack(state, sculler);
        const head = resolveEtbPicking(state, "bears");

        // "a nonland card" — the land is not offerable (`excludeType: "Land"`).
        expect(head.candidateIds).toEqual(["bears"]);

        expect(state.players[1].hand.map((c) => c.id)).toEqual(["land"]);
        // The card lands in its OWNER's exile pile, not the controller's.
        expect(state.players[0].exile).toHaveLength(0);
        const exiled = state.players[1].exile.find((c) => c.id === "bears");
        expect(exiled).toBeDefined();
        expect(exiled!.exiledBySourceId).toBe("sculler");
        expect(state.stack).toHaveLength(0);
    });

    it("the leave trigger returns the exiled card to its OWNER's hand, not the controller's (CR 400.7)", () => {
        const { state } = setup([handCard(grizzlyBears, "bears")]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        resolveEtbPicking(state, "bears");
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["bears"]);

        scullerLeaves(state);

        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bears"]);
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0); // never the controller's
        expect(state.stack).toHaveLength(0);
    });

    it("Sculler killed in response to its own ETB: the return resolves FIRST as a no-op, so the card stays exiled indefinitely", () => {
        const { state } = setup([handCard(grizzlyBears, "bears")]);
        const sculler = state.players[0].battlefield[0];
        etbTriggerOnStack(state, sculler);

        // The Sculler dies with its ETB still on the stack. The leave trigger
        // goes on TOP of it (CR 603.3b) and resolves first with nothing
        // linked — a clean CR 608.2b no-op, NOT a condition-gated skip.
        removePermanentTo(state, "sculler", "graveyard");
        processPendingActionTriggers(state);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            "tidehollow-sculler-exile",
            "tidehollow-sculler-return",
        ]);
        resolveTopOfStack(state); // the return — nothing to return
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bears"]);

        // Then the ETB resolves and exiles. The Sculler will never leave the
        // battlefield again, so nothing ever returns the card.
        resolveEtbPicking(state, "bears");
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["bears"]);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("no-ops on an empty opponent hand, and on a hand of nothing but lands (CR 608.2b)", () => {
        for (const hand of [[], [handCard(swamp, "land")]]) {
            const { state } = setup(hand);
            etbTriggerOnStack(state, state.players[0].battlefield[0]);
            resolveTopOfStack(state);
            // No candidate survives the nonland filter, so no choice is
            // raised at all and nothing is exiled.
            expect(state.pendingChoices ?? []).toHaveLength(0);
            expect(state.players[1].exile).toHaveLength(0);
            expect(state.players[1].hand.map((c) => c.id)).toEqual(
                hand.map((c) => c.id)
            );
            expect(state.stack).toHaveLength(0);

            // The leave trigger still fires (no `condition` gate) and is a
            // clean no-op.
            scullerLeaves(state);
            expect(state.players[1].hand.map((c) => c.id)).toEqual(
                hand.map((c) => c.id)
            );
        }
    });

    it("wire: while the pick is pending, the CONTROLLER sees the opponent's real hand and the opponent's own view is unchanged (issue #1698)", () => {
        const { state } = setup([
            handCard(grizzlyBears, "bears"),
            handCard(swamp, "land"),
        ]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        resolveTopOfStack(state);
        expect(state.pendingChoices![0].kind).toBe("choose-hand-card");

        // `HandCardPick` reads the ordinary `hand` field, not `revealedHand`
        // — the cross-player exposure is keyed on "chooser ≠ zone owner"
        // (`handPickZoneOwner`). Without it the chooser is handed a row of
        // nulls and cannot pick at all.
        const chooserView = projectPublicState(state, 1, "p1");
        expect(chooserView.players[1].hand.map((c) => c?.card?.id)).toEqual([
            grizzlyBears.id,
            swamp.id,
        ]);
        // The zone owner's own view of their own hand is unaffected.
        const ownerView = projectPublicState(state, 1, "p2");
        expect(ownerView.players[1].hand.map((c) => c?.card?.id)).toEqual([
            grizzlyBears.id,
            swamp.id,
        ]);
    });

    it("wire: the exiled card is face up to BOTH viewers and pinned to the Sculler via exiledByPermanentId", () => {
        const { state } = setup([
            handCard(grizzlyBears, "bears"),
            handCard(swamp, "land"),
        ]);
        etbTriggerOnStack(state, state.players[0].battlefield[0]);
        resolveEtbPicking(state, "bears");

        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const exiled = projected.players[1].exile.find(
                (c) => c.id === "bears"
            );
            expect(exiled, `exile card missing for ${viewer}`).toBeDefined();
            // CR 406.3 — exiled cards are face up: the identity crosses the
            // wire to both seats (entering exile clears `knownTo`, ADR 0026).
            expect(exiled!.card?.id).toBe(grizzlyBears.id);
            // issue #791 — the board pin comes free from `exiledBySourceId`.
            expect(exiled!.exiledByPermanentId).toBe("sculler");
        }
    });
});
