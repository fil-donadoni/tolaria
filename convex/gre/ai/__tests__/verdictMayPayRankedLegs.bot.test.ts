// A may-pay graveyard or discard leg is not a choice the candidate set offers
// (issue #10855): `choiceCandidates.ts` ranks each by the fitted card worth
// and emits ONE accept, so a verdict judged "pay or not", never which cards.
// A refit can rank another set, and the recorded key then names cards the
// rebuilt position no longer offers as a whole. The judgement stands: the key
// resolves to the one accept with the same other legs and the same leg sizes.
// A key whose leg size the position cannot answer still reads as stale.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { moveKey } from "../../search";
import type { GameState } from "../../state";
import {
    GRAVEYARD_LEG_FOREST_ID,
    GRAVEYARD_LEG_ISLAND_ID,
    GRAVEYARD_LEG_NONBASIC_ID,
    graveyardCard,
} from "../../__tests__/fixtures/mayPayGraveyardLegProbe.fixture";
import {
    fireGraveyardExileLegEtb,
    graveyardExileLegProbeInstance,
} from "../../__tests__/fixtures/mayPayGraveyardExileLegProbe.fixture";
import { resolveVerdictMoves } from "../verdicts/evalPairs";
import { candidateMoves } from "../verdicts/position";
import type { Verdict } from "../verdicts/types";

/** Three DIFFERENT graveyard cards, so no interchangeability collapse can
 *  make two two-card sets read as one. */
function offerState(): GameState {
    const probe = graveyardExileLegProbeInstance("probe", "p1");
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [probe],
                graveyard: [
                    graveyardCard(GRAVEYARD_LEG_FOREST_ID, "g-forest", "p1"),
                    graveyardCard(GRAVEYARD_LEG_ISLAND_ID, "g-island", "p1"),
                    graveyardCard(
                        GRAVEYARD_LEG_NONBASIC_ID,
                        "g-nonbasic",
                        "p1"
                    ),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    fireGraveyardExileLegEtb(state, probe);
    return state;
}

function verdictOver(keys: string[]): Verdict {
    return {
        id: "test:may-pay-graveyard-set",
        spec: { cards: [] },
        seat: "me",
        candidates: keys.map((key, i) => ({
            key,
            description: `candidate ${i}`,
        })),
        answer: { kind: "right", rightIndexes: [0] },
    } as unknown as Verdict;
}

const mayPayKey = (graveyardIds: string[]) =>
    JSON.stringify({ kind: "may-pay", accept: true, graveyardIds });
const DECLINE = JSON.stringify({ kind: "may-pay", accept: false });

describe("resolveVerdictMoves — a may-pay graveyard set the refit re-ranked (issue #10855)", () => {
    const state = offerState();
    const offered = candidateMoves(state, "p1");
    const accept = offered.find((m) => m.kind === "may-pay" && m.accept);

    it("resolves an accept naming another two-card set onto the offered one", () => {
        const chosen =
            accept?.kind === "may-pay" ? (accept.graveyardIds ?? []) : [];
        expect(chosen).toHaveLength(2);
        const other = ["g-forest", "g-island", "g-nonbasic"].filter(
            (id) => !chosen.includes(id)
        );
        // Another set of the same size: the left-out card plus one chosen.
        const stale = mayPayKey([other[0], chosen[0]]);
        expect(offered.map(moveKey)).not.toContain(stale);
        const resolved = resolveVerdictMoves(
            verdictOver([stale, DECLINE]),
            state,
            "p1"
        );
        expect("moves" in resolved && resolved.moves.map(moveKey)).toEqual([
            moveKey(accept!),
            DECLINE,
        ]);
    });

    it("still reports an accept whose leg size the cost does not take as stale", () => {
        const resolved = resolveVerdictMoves(
            verdictOver([mayPayKey(["g-forest"]), DECLINE]),
            state,
            "p1"
        );
        expect(resolved).toEqual({
            error: "candidate no longer enumerated on the rebuilt position: candidate 0",
        });
    });
});

/** A pending discard-one may-pay over two DIFFERENT hand cards. */
function discardOfferState(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [GRAVEYARD_LEG_FOREST_ID, GRAVEYARD_LEG_NONBASIC_ID].map(
                    (cardId, i) =>
                        makeInstance(cardId, {
                            id: `hand-${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        })
                ),
            }),
            makePlayer("p2"),
        ],
        priorityPlayerId: "p1",
        activePlayerId: "p1",
    });
    state.pendingChoices = [
        {
            stackItemId: "stack-1",
            step: 0,
            choiceId: "c1",
            playerId: "p1",
            kind: "may-pay",
            cost: {
                hand: {
                    action: "discard",
                    requirements: [{ filter: {}, count: 1 }],
                },
            },
            count: 1,
            prompt: "Discard a card?",
        },
    ];
    return state;
}

describe("resolveVerdictMoves — a may-pay discard set the refit re-ranked (issue #10855)", () => {
    const state = discardOfferState();
    const offered = candidateMoves(state, "p1");
    const accept = offered.find((m) => m.kind === "may-pay" && m.accept);
    const chosen = accept?.kind === "may-pay" ? (accept.discardIds ?? []) : [];

    it("resolves an accept naming the other hand card onto the offered one", () => {
        expect(chosen).toHaveLength(1);
        const other = ["hand-0", "hand-1"].filter((id) => !chosen.includes(id));
        const stale = JSON.stringify({
            kind: "may-pay",
            accept: true,
            discardIds: other,
        });
        expect(offered.map(moveKey)).not.toContain(stale);
        const resolved = resolveVerdictMoves(
            verdictOver([stale, DECLINE]),
            state,
            "p1"
        );
        expect("moves" in resolved && resolved.moves.map(moveKey)).toEqual([
            moveKey(accept!),
            DECLINE,
        ]);
    });
});
