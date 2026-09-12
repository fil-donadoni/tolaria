// The stack journal: a decision taken over a non-empty stack becomes a Verdict
// (issue #3480, PRD #3397).
//
// Every case here runs the REAL pipeline — the production enumerator, the
// production move application, the production lowering — because the thing
// under test is precisely whether a recorded walk rebuilds THE SAME POSITION.
// A hand-built journal checked against a hand-built expectation would assert
// the shape of a data structure and nothing about that.

import { describe, it, expect } from "vitest";
import { StackJournal } from "../verdicts/journal";
import { buildVerdictPosition, candidateMoves } from "../verdicts/candidates";
import { lowerDecision } from "../verdicts/lowering";
import { applyMoveInSearch } from "../../search";
import { describeMove } from "../../describeMove";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

/** The archetypal response position: `me` points removal at the creature and
 *  `opp` — the seat under judgement here — holds priority over it with removal
 *  of its own. Casting passes priority to the non-caster in this engine
 *  (CR 117.3c is realised by `applyMoveInSearch`), so the RESPONDER is the seat
 *  a verdict is owed from, which is also the half of PRD #3397 this issue
 *  exists for. `opp` must hold a real option or the lowering answers
 *  `single-candidate` and proves nothing about the journal. */
const RESPONSE_SPEC: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Lightning Bolt", owner: "me", zone: "hand" },
        { name: "Mountain", owner: "opp", zone: "battlefield" },
        { name: "Lightning Bolt", owner: "opp", zone: "hand" },
        {
            name: "Hill Giant",
            owner: "opp",
            zone: "battlefield",
            summoningSick: false,
        },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    libraryCount: 20,
};

/** The move `playerId` has whose description is exactly `sentence`, applied
 *  through the same `applyMoveInSearch` the search itself replays with — and
 *  journalled first, exactly as a driving caller does. `journal` is `null` for
 *  the move a caller does NOT drive, which is how a hole in a window is made. */
function playThrough(
    journal: StackJournal | null,
    state: GameState,
    playerId: string,
    sentence: string
): Move {
    const move = candidateMoves(state, playerId).find(
        (candidate) => describeMove(candidate, state) === sentence
    );
    if (!move) throw new Error(`"${sentence}" is not legal in this position`);
    journal?.observe(state, playerId, move);
    applyMoveInSearch(state, playerId, move);
    return move;
}

const BOLT_THE_GIANT = "cast Lightning Bolt → Hill Giant";

function chosenDescription(state: GameState, playerId: string): string {
    // Whatever the Bot "played" — any candidate the live position offers. The
    // lowering matches it back by the describer's sentence, so it must be one
    // the rebuild will also offer.
    return describeMove(candidateMoves(state, playerId)[0], state);
}

describe("stack journal: a response decision lowers (issue #3480)", () => {
    it("carries the walk as `setup`, and the rebuild is the SAME position", () => {
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const [me, bot] = state.players.map((player) => player.id);
        expect(state.stack).toHaveLength(0);

        const journal = new StackJournal();
        playThrough(journal, state, me, BOLT_THE_GIANT);
        expect(state.stack).toHaveLength(1);

        const outcome = lowerDecision(
            state,
            bot,
            chosenDescription(state, bot),
            journal.entry()
        );
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;

        // `setup` is the walk, in the judged seat's own frame: the caster is
        // `opp` because the spec is lowered with the BOT as `me`.
        expect(outcome.lowered.setup).toEqual([
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: "opp",
                target: "Hill Giant",
            },
        ]);
        // And the spec is the QUIET board — the Bolt is back in its owner's
        // hand, because a spec cannot express a stack and never pretends to.
        expect(
            outcome.lowered.spec.cards.filter(
                (card) => card.name === "Lightning Bolt" && card.zone === "hand"
            )
        ).toHaveLength(2);

        // The rebuild really is this position: one object on the stack, and
        // the candidate list the verdict names is the live one. (The lowering
        // refuses on either mismatch, so reaching `ok` already asserts it —
        // re-asserted here so a later relaxation of those checks cannot make
        // this case vacuous.)
        const rebuilt = buildVerdictPosition(
            outcome.lowered.spec,
            outcome.lowered.setup
        );
        expect(rebuilt.stack).toHaveLength(1);
        expect(outcome.lowered.candidates.map((c) => c.description)).toEqual(
            candidateMoves(state, bot).map((move) => describeMove(move, state))
        );
    });

    it("refuses a stack nobody journalled", () => {
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const [me, bot] = state.players.map((player) => player.id);
        playThrough(null, state, me, BOLT_THE_GIANT);

        const outcome = lowerDecision(
            state,
            bot,
            chosenDescription(state, bot)
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-journalled");
    });

    it("refuses a window with a move the step vocabulary cannot say", () => {
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const [me, bot] = state.players.map((player) => player.id);
        const journal = new StackJournal();
        playThrough(journal, state, me, BOLT_THE_GIANT);
        expect(journal.entry()?.steps).toHaveLength(1);

        // A land drop and its landfall trigger, a granted ability, a special
        // action, a yes/no answer: none has a faithful setup step. Taken
        // INSIDE the window, each one costs it — the journal says it does not
        // know, rather than handing over a walk with a hole in it. (Outside a
        // window the same move costs nothing: the next empty-stack move opens
        // a fresh one, which is the reset asserted below.)
        journal.observe(state, bot, { kind: "may-pay", accept: true });
        expect(journal.entry()).toBe(null);

        const outcome = lowerDecision(
            state,
            bot,
            chosenDescription(state, bot),
            journal.entry()
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-journalled");
    });

    it("refuses a window whose replay rebuilds a DIFFERENT stack", () => {
        // The fail-closed case the candidate-list comparison cannot catch: a
        // second object on the stack the journal never saw. It adds no move to
        // the decider's options, so the two lists can match move for move while
        // the boards differ — which is why the stack itself is compared.
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const [me, other] = state.players.map((player) => player.id);
        const journal = new StackJournal();
        playThrough(journal, state, me, BOLT_THE_GIANT);
        // Applied WITHOUT journalling it, the way a move the driver does not
        // drive reaches the board — a human's click in a solo game.
        playThrough(null, state, other, BOLT_THE_GIANT);
        expect(state.stack).toHaveLength(2);

        const outcome = lowerDecision(
            state,
            me,
            chosenDescription(state, me),
            journal.entry()
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-journalled");
        expect(outcome.error).toContain("different stack");
    });

    it("refuses an object partway through resolving with its OWN kind", () => {
        // CR 608.3 — a resume checkpoint. No setup step puts a half-resolved
        // object back, so this is structural and stays refused however
        // complete the journal is: its own kind, never the journal's.
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const [me, bot] = state.players.map((player) => player.id);
        const journal = new StackJournal();
        playThrough(journal, state, me, BOLT_THE_GIANT);
        state.stack[0].resolutionStep = 1;

        const outcome = lowerDecision(
            state,
            bot,
            chosenDescription(state, bot),
            journal.entry()
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-mid-resolution");
    });

    it("drops the window the moment the stack empties again", () => {
        // The journal holds ONE window, never a log: a move taken on an empty
        // stack restarts it, which is also what clears a broken one.
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const me = state.players[0].id;
        const journal = new StackJournal();
        playThrough(journal, state, me, BOLT_THE_GIANT);
        expect(journal.entry()?.steps).toHaveLength(1);

        // Back to a quiet board: the first window is gone, and the new one
        // holds exactly the move taken on it — never both.
        const quiet = buildVerdictPosition(RESPONSE_SPEC);
        playThrough(journal, quiet, quiet.players[0].id, BOLT_THE_GIANT);
        expect(journal.entry()?.steps).toHaveLength(1);
        expect(journal.entry()?.quiet.stack).toHaveLength(0);
    });
});
