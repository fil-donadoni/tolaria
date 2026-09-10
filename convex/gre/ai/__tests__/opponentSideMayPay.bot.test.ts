// CR 117.3a (issue #3243) — the bot answering a cost-free `mayPay` whose
// BENEFICIARY is the OTHER seat.
//
// Every shipped cost-free "you may" before this one pays the player who
// answers: Sibilant Spirit and Questing Phelddagrif both offer a card TO the
// answerer. Palantír of Orthanc inverts that — "target opponent may have YOU
// draw a card" — so an accept is a gift to the OFFERER, and the punisher for
// declining lands on the answerer. `OP_BENEFICENCE`'s row for `mayPay` is
// `"neutral"` (the Op binds a boolean; the stake belongs to the sibling `if`
// that reads it), which is the FAIL-OPEN sign: nothing in the announcement
// layer says which way this decision runs, and the "accept iff trivially
// affordable" prior (`choicePriors.ts`) actively biases towards yes. What has
// to get it right is the SEARCH, applying both branches through the real GRE.
//
// The two tests are a DISCRIMINATING PAIR on exactly that axis (ADR 0070 §1 —
// a decline-half a never-accepting bot also satisfies asserts nothing alone):
// the same cost-free `mayPay` Op, the same yes/no candidate set, opposite
// correct answers, and the ONLY thing that differs is who receives the card.
//
// This is a search-level test rather than a blade entry for a structural
// reason: Palantír's decision sits BEHIND a controller-side scry choice, and a
// blade `setup` sequence deliberately may not answer a pending choice ("a
// decision, not a board, and therefore the search's job rather than the
// fixture's" — `blade/types.ts`, the `know-library-top` step's own doc).

import { describe, it, expect } from "vitest";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../state";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { searchWithTrace } from "../../search";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { getCardByName } from "../../../cards";

/** Deterministic: fixed iterations (never wall-clock) and explicit seeds. */
const ITERATIONS = 400;
const SEEDS = [0xb1ade, 1, 2];

/** Push a triggered ability the way `collectTriggers` builds it, controlled by
 *  p1, and resolve it. */
function fireTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"],
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        id: `trig-${triggeredAbilityId}`,
        castById: source.controllerId,
        zone: "stack",
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets,
    } as StackItem);
    resolveTopOfStack(state);
}

function answerOf(state: GameState, seed: number): boolean | null {
    const { move } = searchWithTrace(
        state,
        "p2",
        { iterations: ITERATIONS },
        seed
    );
    return move?.kind === "may-pay" ? move.accept : null;
}

/** Palantír's end-step trigger, walked to the point where p2 owns the offer:
 *  the trigger resolves into the controller's scry, which is answered by
 *  keeping everything on top so the mill below sees the declared library. */
function palantirOffer(): GameState {
    const palantir = makeInstance(getCardByName("Palantír of Orthanc").id, {
        id: "palantir1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { influence: 1 },
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [palantir],
                // Forty basic lands: the milled cards must be worth 0 mana
                // value (CR 202.3) AND come off a library deep enough that
                // milling two of them is not itself a gift to the answerer —
                // a short library makes DECLINING attractive because it decks
                // the offering player, which is a different axis from the one
                // this pair is about.
                library: Array.from({ length: 40 }, (_, i) =>
                    makeInstance(getCardByName("Forest").id, {
                        id: `lib-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2", {
                // The bot needs a DEEP library of its own, or the half passes
                // for the wrong reason: with an empty one, accepting would
                // make it draw from nothing and lose (CR 104.3c), so it would
                // decline whoever the card went to. Twenty also clears
                // `libraryTerm`'s 12-card decking horizon (evaluate.ts).
                library: Array.from({ length: 20 }, (_, i) =>
                    makeInstance(getCardByName("Forest").id, {
                        id: `p2lib-${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    })
                ),
            }),
        ],
    });
    state.phase = "END_STEP";
    fireTrigger(
        state,
        palantir,
        "palantir-of-orthanc-end-step",
        {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        },
        [{ type: "player", id: "p2" }]
    );
    const scry = state.pendingChoices![0];
    expect(scry.kind).toBe("order-top");
    applyPendingChoiceSubmit(state, {
        playerId: scry.playerId,
        stackItemId: scry.stackItemId,
        step: scry.step,
        choiceId: scry.choiceId,
        cardInstanceIds: [...(scry.candidateIds ?? [])],
        secondZoneIds: [],
    });
    return state;
}

/** The MIRROR shape: a cost-free `mayPay` offered to p2 whose accept draws p2
 *  the card. Sibilant Spirit's attack trigger, pushed directly — the point is
 *  the Op, not the combat that raises it. */
function ownBenefitOffer(): GameState {
    const spirit = makeInstance(getCardByName("Sibilant Spirit").id, {
        id: "spirit1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [spirit] }),
            makePlayer("p2", {
                // Twenty, not five: `libraryTerm` (evaluate.ts, CR 104.3c)
                // scores steeply negative below a 12-card horizon, so a short
                // library makes DRAWING a cost and the half would pass for the
                // wrong reason.
                library: Array.from({ length: 20 }, (_, i) =>
                    makeInstance(getCardByName("Forest").id, {
                        id: `p2lib-${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    })
                ),
            }),
        ],
    });
    fireTrigger(state, spirit, "sibilant-spirit-attack", {
        type: "ATTACKERS_DECLARED",
        attackerIds: [spirit.id],
        attackingPlayerId: "p1",
    } as StackItem["triggerEvent"]);
    return state;
}

describe("cost-free mayPay: the bot answers by WHO gets the card (CR 117.3a)", () => {
    it("DECLINES the offer that would hand the OFFERING player a card", () => {
        for (const seed of SEEDS) {
            const state = palantirOffer();
            const offer = state.pendingChoices![0];
            expect(offer.kind).toBe("may-pay");
            expect(offer.playerId).toBe("p2");
            // The library is all basic lands, so the punisher's total mana
            // value is 0 (CR 202.3) and declining is literally free.
            expect(answerOf(state, seed), `seed ${seed}`).toBe(false);
        }
    });

    it("ACCEPTS the same shape when the card comes to IT", () => {
        for (const seed of SEEDS) {
            const state = ownBenefitOffer();
            const offer = state.pendingChoices![0];
            expect(offer.kind).toBe("may-pay");
            expect(offer.playerId).toBe("p2");
            expect(answerOf(state, seed), `seed ${seed}`).toBe(true);
        }
    });
});
