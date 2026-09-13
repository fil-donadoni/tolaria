// Squad — the two linked abilities of CR 702.157 (issue #3220).
//
// CR 702.157a: "Squad is a keyword that represents two linked abilities. The
// first is a static ability that functions while the creature spell with squad
// is on the stack. The second is a triggered ability that functions when the
// creature with squad enters the battlefield. 'Squad [cost]' means 'As an
// additional cost to cast this spell, you may pay [cost] any number of times'
// and 'When this creature enters, if its squad cost was paid, create a token
// that's a copy of it for each time its squad cost was paid.'"
//
// Neither half needed a new engine seam: the cost half is a `kickers[]` entry
// with `keyword: "squad"` + `multi: true` (ADR 0085 + ADR 0079) and the trigger
// half is a CR 603.4-gated ETB whose Effect Script is one already-exercised Op.
// That is exactly why the mechanic is worth a test of its own — every claim
// below is a CONSEQUENCE of composing shipped parts, and nothing else in the
// suite asserts that the composition holds.
//
// Everything here drives the REAL commit path (`finalizeTargetSelection`,
// `convex/game.ts`) and the REAL resolution / trigger machinery
// (`resolveTopOfStack`, `processPendingActionTriggers`) rather than
// hand-building a stack item or a trigger.
import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
    type PendingTarget,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup";
import { securitronSquadron } from "../../cards/sets/pip/white";
import { additionalCostPaidCount, resolveKickerPayments } from "../kicker";

const SQUADRON_ID = "sq1";

/** Casts Securitron Squadron paying its squad cost `times` times, through the
 *  real commit path, and resolves the creature spell. Returns the state with
 *  the Squadron on the battlefield and its ETB triggers pending. */
function castSquadron(times: number): GameState {
    const card = makeInstance(securitronSquadron.id, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        id: SQUADRON_ID,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [card],
                // CR 601.2f — squad is an ADDITIONAL cost: {1}{W} printed,
                // plus {3} for every payment. Nothing here is an alternative
                // cost, so the printed cost is still owed in full.
                manaPool: {
                    W: 1,
                    U: 0,
                    B: 0,
                    R: 0,
                    G: 0,
                    C: 1 + 3 * times,
                },
            }),
            makePlayer("p2"),
        ],
    });
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: SQUADRON_ID,
        targetType: "any",
        count: 0,
        selected: [],
        ...(times > 0 ? { kickerPayments: { squad: times } } : {}),
    };
    finalizeTargetSelection(state, pt, "p1");
    expect(
        state.stack.find((s) => s.id === SQUADRON_ID),
        "the Squadron never reached the stack"
    ).toBeDefined();
    resolveTopOfStack(state);
    return state;
}

/** Drains every trigger the board has raised, ordering batches in collection
 *  order. The squad trigger creates tokens, whose entry raises the +1/+1
 *  trigger, whose resolution raises nothing — so this terminates. */
function drainTriggers(state: GameState): void {
    let guard = 0;
    while (guard++ < 64) {
        processPendingActionTriggers(state);
        resolveTriggerOrder(state);
        if (state.stack.length === 0) break;
        resolveTopOfStack(state);
    }
    expect(guard, "trigger drain did not terminate").toBeLessThan(64);
}

const battlefield = (state: GameState): CardInstanceState[] =>
    getPlayer(state, "p1").battlefield;

const tokensOf = (state: GameState): CardInstanceState[] =>
    battlefield(state).filter((c) => c.isToken === true);

describe("Squad — the cost half (CR 702.157a / 702.33c)", () => {
    it("is payable any number of times, and each payment is recorded", () => {
        // CR 702.157a's "any number of times" is the SAME repeatability axis
        // Multikicker rides, so `resolveKickerPayments` — the single
        // announcement-time validator — accepts an arbitrary count.
        expect(resolveKickerPayments(securitronSquadron, { squad: 3 })).toEqual(
            { squad: 3 }
        );
        expect(resolveKickerPayments(securitronSquadron, { squad: 0 })).toBe(
            undefined
        );
    });

    it("is NOT a kick (CR 702.33d) — the count lands in the unkicked record", () => {
        const state = castSquadron(2);
        const perm = battlefield(state).find((c) => c.id === SQUADRON_ID)!;
        // CR 702.33d defines "kicked" over KICKER costs alone.
        expect(perm.wasKicked).toBeUndefined();
        expect(perm.kickerPayments).toBeUndefined();
        expect(perm.unkickedCostPayments).toEqual({ squad: 2 });
        expect(additionalCostPaidCount(perm, "squad")).toBe(2);
    });
});

describe("Squad — the trigger half (CR 702.157a / 603.4)", () => {
    it("with zero payments the trigger never goes on the stack (CR 603.4)", () => {
        const state = castSquadron(0);
        const perm = battlefield(state).find((c) => c.id === SQUADRON_ID)!;
        expect(perm.unkickedCostPayments).toBeUndefined();
        processPendingActionTriggers(state);
        resolveTriggerOrder(state);
        // The INTERVENING IF is a check-time gate: an unpaid squad cost means
        // no ability is ever announced, not an ability that fizzles.
        expect(
            state.stack.map((s) => s.abilityId ?? s.id),
            "an unpaid squad cost still announced its trigger"
        ).not.toContain("securitron-squadron-squad");
        drainTriggers(state);
        expect(tokensOf(state)).toHaveLength(0);
    });

    it("N payments create exactly N token copies (CR 702.157a)", () => {
        for (const times of [1, 2, 3]) {
            const state = castSquadron(times);
            drainTriggers(state);
            expect(
                tokensOf(state),
                `${times} squad payment(s) did not create ${times} token(s)`
            ).toHaveLength(times);
            for (const token of tokensOf(state)) {
                // CR 707.2 — the copy presents the SOURCE's definition.
                expect(token.card.id).toBe(securitronSquadron.id);
                expect(token.controllerId).toBe("p1");
            }
        }
    });

    it("the token copies carry no squad count of their own (CR 707.2)", () => {
        // Copiable values are printed values; a payment record is not one, so
        // a token copy creates no further tokens. The count above already
        // proves there is no runaway — this pins the REASON.
        const state = castSquadron(2);
        drainTriggers(state);
        for (const token of tokensOf(state)) {
            expect(token.unkickedCostPayments).toBeUndefined();
            expect(additionalCostPaidCount(token, "squad")).toBe(0);
        }
    });

    it("the count does not survive a CR 400.7 re-entry", () => {
        const state = castSquadron(2);
        drainTriggers(state);
        const before = tokensOf(state).length;
        expect(before).toBe(2);
        // Bounce it and cast it again paying NOTHING. The permanent that comes
        // back is a new object (CR 400.7), so it remembers no payment and its
        // trigger — an intervening if — never goes on the stack. Driven
        // through the real departure funnel and the real cast path, because
        // the whole claim is about what those two do to the record.
        removePermanentTo(state, SQUADRON_ID, "hand");
        const returned = getPlayer(state, "p1").hand.find(
            (c) => c.id === SQUADRON_ID
        )!;
        expect(
            returned.unkickedCostPayments,
            "the squad count survived a zone change"
        ).toBeUndefined();
        getPlayer(state, "p1").manaPool = {
            W: 1,
            U: 0,
            B: 0,
            R: 0,
            G: 0,
            C: 1,
        };
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: SQUADRON_ID,
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        resolveTopOfStack(state);
        const recast = battlefield(state).find((c) => c.id === SQUADRON_ID)!;
        expect(recast.unkickedCostPayments).toBeUndefined();
        drainTriggers(state);
        expect(
            tokensOf(state).length,
            "a re-entered Squadron created tokens from a payment it no longer remembers"
        ).toBe(before);
    });
});

describe("Squad — the tokens are creature tokens that enter (CR 603.6a)", () => {
    it("each token gets a +1/+1 counter per Squadron watching the set enter", () => {
        // The squad tokens are COPIES of the Squadron, so each of them also has
        // "whenever a creature token you control enters, put a +1/+1 counter on
        // it", and all of them entered simultaneously — every copy sees every
        // token in the set, itself included (CR 603.6a). N payments therefore
        // put N+1 counters on each of the N tokens: the original's trigger plus
        // each token's own. The ORIGINAL is not a token and gets none.
        for (const times of [1, 2]) {
            const state = castSquadron(times);
            drainTriggers(state);
            const original = battlefield(state).find(
                (c) => c.id === SQUADRON_ID
            )!;
            expect(original.counters?.["+1/+1"] ?? 0).toBe(0);
            for (const token of tokensOf(state)) {
                expect(
                    token.counters?.["+1/+1"] ?? 0,
                    `${times} payment(s): a token did not get one counter per watching Squadron`
                ).toBe(times + 1);
            }
        }
    });
});
