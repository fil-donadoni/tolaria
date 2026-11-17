// Linked-exile reach (issue #9961) — CR 607.2a: the cards exiled with a
// permanent whose own ability puts them onto the battlefield are latent
// material for its controller while that ability can still fire (CR 701.46a:
// Adapt places no counters on a creature that has a +1/+1 counter), and the
// rollout does not cash the retrieval before the permanent's own exile
// trigger on the stack fills the pile.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import type { ActivatedAbility } from "../../cards/types";
import type { CardInstanceState, StackItem } from "../state";
import { evaluate } from "../evaluate";
import { isDiscouragedRolloutMove } from "../search";
import {
    retrievableLinkedExile,
    retrievalPrecedesOwnLink,
} from "../ai/linkedExileReach";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const EMPEROR = getCardByName("Emperor of Bones");
const ATRAXA = getCardByName("Atraxa, Grand Unifier").id;
const THOUGHTSEIZE = getCardByName("Thoughtseize").id;
const BEARS = getCardByName("Grizzly Bears").id;
const ADAPT_ID = "emperor-of-bones-adapt";
const EXILE_TRIGGER_ID = "emperor-of-bones-exile";

const adapt = EMPEROR.activatedAbilities!.find(
    (a) => a.id === ADAPT_ID
) as ActivatedAbility;

function emperor(over: Partial<CardInstanceState> = {}): CardInstanceState {
    return makeInstance(EMPEROR.id, { id: "emperor", ...over });
}

/** p1 controls `source`; `exiled` sits in p2's exile, linked to it. */
function board(
    source: CardInstanceState,
    exiledCardId: string,
    stack: StackItem[] = []
) {
    const exiled = makeInstance(exiledCardId, {
        id: "linked",
        zone: "exile",
        controllerId: "p2",
        ownerId: "p2",
        exiledBySourceId: source.id,
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [source] }),
            makePlayer("p2", { exile: [exiled] }),
        ],
        stack,
    });
}

function exileTriggerOnStack(): StackItem {
    return {
        ...makeInstance(EMPEROR.id, { id: "trigger", zone: "stack" }),
        castById: "p1",
        triggeredAbilityId: EXILE_TRIGGER_ID,
        triggerSourceId: "emperor",
    } as StackItem;
}

describe("retrievableLinkedExile (issue #9961, CR 607.2a)", () => {
    it("reaches a creature card exiled with a permanent whose ability puts it onto the battlefield under its controller", () => {
        const state = board(emperor(), ATRAXA);
        const reached = retrievableLinkedExile(state, state.players[0]);
        expect(reached.map((c) => c.id)).toEqual(["linked"]);
    });

    it("leaves out a card the retrieval's filter refuses (a creature card only)", () => {
        const state = board(emperor(), THOUGHTSEIZE);
        expect(retrievableLinkedExile(state, state.players[0])).toEqual([]);
    });

    it("is dead once the permanent has a +1/+1 counter: Adapt places none (CR 701.46a)", () => {
        const state = board(emperor({ counters: { "+1/+1": 2 } }), ATRAXA);
        expect(retrievableLinkedExile(state, state.players[0])).toEqual([]);
    });

    it("credits the permanent's controller, never the exiled card's owner", () => {
        const state = board(emperor(), ATRAXA);
        expect(retrievableLinkedExile(state, state.players[1])).toEqual([]);
    });

    it("reads nothing off a permanent with no retrieval", () => {
        const state = board(makeInstance(BEARS, { id: "bears" }), ATRAXA);
        expect(retrievableLinkedExile(state, state.players[0])).toEqual([]);
    });

    it("the leaf prices the linked creature above a linked spent sorcery", () => {
        const creature = board(emperor(), ATRAXA);
        const sorcery = board(emperor(), THOUGHTSEIZE);
        expect(evaluate(creature, "p1")).toBeGreaterThan(
            evaluate(sorcery, "p1")
        );
    });
});

describe("retrievalPrecedesOwnLink (issue #9961, CR 405.5)", () => {
    it("flags Adapt in response to the same permanent's own exile trigger", () => {
        const state = board(emperor(), THOUGHTSEIZE, [exileTriggerOnStack()]);
        expect(
            retrievalPrecedesOwnLink(
                state,
                "p1",
                state.players[0].battlefield[0],
                adapt
            )
        ).toBe(true);
    });

    it("does not flag Adapt with no exile of the permanent's waiting", () => {
        const state = board(emperor(), THOUGHTSEIZE);
        expect(
            retrievalPrecedesOwnLink(
                state,
                "p1",
                state.players[0].battlefield[0],
                adapt
            )
        ).toBe(false);
    });

    it("does not flag an Adapt that can no longer place counters", () => {
        const state = board(
            emperor({ counters: { "+1/+1": 2 } }),
            THOUGHTSEIZE,
            [exileTriggerOnStack()]
        );
        expect(
            retrievalPrecedesOwnLink(
                state,
                "p1",
                state.players[0].battlefield[0],
                adapt
            )
        ).toBe(false);
    });

    it("the rollout guardrail discourages that activation", () => {
        const state = board(emperor(), THOUGHTSEIZE, [exileTriggerOnStack()]);
        state.phase = "BEGINNING_OF_COMBAT";
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        expect(
            isDiscouragedRolloutMove(state, "p1", {
                kind: "activate-ability",
                cardInstanceId: "emperor",
                abilityId: ADAPT_ID,
            } as never)
        ).toBe(true);
    });
});
