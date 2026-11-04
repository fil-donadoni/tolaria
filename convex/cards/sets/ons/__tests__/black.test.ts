// ONS — black per-card behaviour tests (ADR 0043 colour split). Chain of Smog
// is the first chain whose copier is the spell's own target PLAYER, so its
// retarget re-points who the next link asks. Issue #3657.
//
// CR 707.10 + CR 707.10c: the copy is controlled by the player who put it on
// the stack, and that player picks its new target.

import { describe, expect, it } from "vitest";
import { finalizeTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import { getCardByName, preloadDefinitions } from "../../../index";
import { chainOfSmog as chainOfSmogDefinition } from "../black.cards";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([chainOfSmogDefinition()]);

const chainOfSmog = chainOfSmogDefinition();
const BEARS = getCardByName("Grizzly Bears").id;

const cards = (owner: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(BEARS, {
            id: `${owner}-card-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "hand",
        })
    );

function castAtP2(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { hand: cards("p1", 4) }),
            makePlayer("p2", { hand: cards("p2", 4) }),
        ],
    });
    pushSpell(state, chainOfSmog.id, "p1", [{ type: "player", id: "p2" }]);
    return state;
}

function discardTwo(state: GameState, playerId: string): void {
    const head = state.pendingChoices![0];
    expect(head.kind).toBe("discard-hand");
    expect(head.playerId).toBe(playerId);
    const hand = state.players.find((p) => p.id === playerId)!.hand;
    applyPendingChoiceSubmit(state, {
        playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: hand.slice(0, 2).map((c) => c.id),
    });
}

describe("Chain of Smog (CR 707.10 / 707.10c)", () => {
    it("the target discards two, then THAT player is asked about the copy, on the wire too", () => {
        const state = castAtP2();
        resolveTopOfStack(state);
        discardTwo(state, "p2");

        expect(state.players[1].hand).toHaveLength(2);
        expect(state.players[0].hand).toHaveLength(4);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");
        expect(
            projectPublicState(state, 2, "p2").pendingChoices?.[0]?.playerId
        ).toBe("p2");
    });

    it("declining ends the chain: no copy, the card in its owner's graveyard", () => {
        const state = castAtP2();
        resolveTopOfStack(state);
        discardTwo(state, "p2");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(4);
        expect(
            state.players[0].graveyard.map((c) => (c.card as { id: string }).id)
        ).toEqual([chainOfSmog.id]);
    });

    it("the copy belongs to the copier, who repoints it, and the next link asks the new target", () => {
        const state = castAtP2();
        resolveTopOfStack(state);
        discardTwo(state, "p2");
        applyMayPaySubmit(state, { playerId: "p2", accept: true });

        const pending = state.pendingTarget!;
        expect(pending.kind).toBe("copy-retarget");
        expect(pending.playerId).toBe("p2");
        expect(pending.targetType).toBe("player");
        const copy = state.stack.find((s) => s.id === pending.cardInstanceId)!;
        expect(copy.isCopy).toBe(true);
        expect(copy.controllerId).toBe("p2");
        expect(copy.ownerId).toBe("p2");
        // CR 707.10: until the copier picks, the copy inherits the target.
        expect(copy.targets).toEqual([{ type: "player", id: "p2" }]);

        finalizeTargetSelection(
            state,
            { ...pending, selected: [{ type: "player", id: "p1" }] },
            "p2"
        );
        expect(copy.targets).toEqual([{ type: "player", id: "p1" }]);

        resolveTopOfStack(state);
        discardTwo(state, "p1");
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[1].hand).toHaveLength(2);
        const next = state.pendingChoices![0];
        expect(next.kind).toBe("may-pay");
        expect(next.playerId).toBe("p1");

        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.stack).toHaveLength(0);
        // CR 707.10a: the copy ceased to exist, only the card is in a graveyard.
        const graveyards = [
            ...state.players[0].graveyard,
            ...state.players[1].graveyard,
        ];
        expect(graveyards.some((c) => c.id === copy.id)).toBe(false);
    });

    it("an empty hand discards nothing and still offers the copy", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: cards("p1", 4) }),
                makePlayer("p2", { hand: [] }),
            ],
        });
        pushSpell(state, chainOfSmog.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);

        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
    });
});
