// Every Pending Choice kind has a submit handler and a legal-actions handler
// (issue #4440, CR 608.2). Both dispatchers — `applyPendingChoiceSubmit` and
// `legalActions`' choice arm — read the handler registry (issue #4443), whose
// `Record` type makes a kind with no row a compile error; this is the runtime
// half. It drives each kind through the real entry points and fails when one
// reaches the unhandled-kind refusal, i.e. when no row answered it. Any OTHER
// throw is the kind's own handler rejecting the probe's empty payload, which
// is the handler existing.
import { describe, it, expect } from "vitest";
import type { GameState, PendingChoice, PendingChoiceKind } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { legalActions } from "../legalActions";
import { PENDING_CHOICE_HANDLERS } from "../pendingChoiceHandlers";
import { makeState } from "../../cards/__tests__/setup";

/** The kinds the tests iterate are the registry's own rows. The registry is a
 *  `Record<PendingChoiceKind, …>`, so a kind added to the union without a row
 *  — or a row removed — reds `check:ts`; this list can never fall behind
 *  the union the way a hand-kept copy could (issue #4443). */
const KINDS = Object.keys(PENDING_CHOICE_HANDLERS) as PendingChoiceKind[];

const UNHANDLED = /Unhandled pending choice kind/;

/** A state whose queue head is a bare choice of `kind`: no zone, count 0, an
 *  empty stack. Small enough that every kind's own arm is reached with
 *  nothing else in the way; a second queued choice keeps a tail that gets
 *  that far from resuming a resolution. */
function stateWithHead(kind: PendingChoiceKind): GameState {
    const head = (choiceId: string): PendingChoice => ({
        stackItemId: "probe",
        step: 0,
        choiceId,
        playerId: "p1",
        kind,
        count: 0,
        prompt: "probe",
    });
    return makeState({ pendingChoices: [head("c0"), head("c1")] });
}

/** The error a dispatcher threw for `kind`, or `undefined` if it answered. */
function thrownBy(run: () => unknown): Error | undefined {
    try {
        run();
        return undefined;
    } catch (e) {
        return e as Error;
    }
}

function submitProbe(kind: PendingChoiceKind): Error | undefined {
    const state = stateWithHead(kind);
    return thrownBy(() =>
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: "probe",
            step: 0,
            choiceId: "c0",
            cardInstanceIds: [],
        })
    );
}

function legalActionsProbe(kind: PendingChoiceKind): Error | undefined {
    const state = stateWithHead(kind);
    return thrownBy(() => legalActions(state));
}

describe("Pending Choice kind coverage (CR 608.2, issue #4440)", () => {
    it("the probe reaches the unhandled-kind refusal — a kind outside the union is refused by both dispatchers", () => {
        // Positive control: without it, a probe stopped by some earlier throw
        // would make every row below pass vacuously.
        const bogus = "not-a-kind" as PendingChoiceKind;
        expect(submitProbe(bogus)?.message).toMatch(UNHANDLED);
        expect(legalActionsProbe(bogus)?.message).toMatch(UNHANDLED);
    });

    it.each(KINDS)("%s has a submit handler", (kind) => {
        expect(submitProbe(kind)?.message ?? "").not.toMatch(UNHANDLED);
    });

    it.each(KINDS)("%s has a legal-actions handler", (kind) => {
        expect(legalActionsProbe(kind)?.message ?? "").not.toMatch(UNHANDLED);
    });
});
