// The browser's half of the stack journal (issue #3480).
//
// The path a judgement takes here is GRE → wire projection → client store →
// quiz, and every one of those seams can drop the thing the next one needs: the
// projection strips fat fields and hides the non-viewer's hand, and the store
// holds projections rather than states because the main thread never has one.
// A test that fed `journalEntryFor` a hand-built `GameState` would prove none
// of that, so these run the REAL projection (`projectPublicState`) and the REAL
// quiz builder.
//
// WHAT THE DRIVER CAN RECORD TODAY, said plainly. `useVsAiDriver` submits the
// BOT's moves and only those; a human's click reaches the server through a
// dozen gesture hooks with no shared chokepoint. So a window a human opened is
// one this store never saw, and the lowering refuses it
// (`stack-not-journalled`) rather than replaying a walk with a hole in it —
// which is the last case below. The store's API is seat-agnostic on purpose
// (`playerId` is a parameter), so wiring the human's own moves is a change at
// their call sites and not here.

import { describe, it, expect, beforeEach } from "vitest";
import {
    buildVerdictPosition,
    candidateMoves,
} from "@convex/gre/ai/verdicts/candidates";
import { applyMoveInSearch } from "@convex/gre/search";
import { describeMove } from "@convex/gre/describeMove";
import { projectPublicState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { GameState } from "@convex/gre/state";
import type { Move } from "@convex/gre";
import { buildVerdictQuiz } from "../verdict-quiz";
import {
    clearStackJournal,
    journalEntryFor,
    markJournalOpaque,
    recordJournalPly,
} from "../stack-journal";
import type { AiTraceSource } from "../trace-store";

/** The same response position the engine-side tests use: `me` points removal
 *  at the creature, and the BOT (`opp`) holds priority over it with removal of
 *  its own — the decision PRD #3397 exists for. */
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

const BOLT_THE_GIANT = "cast Lightning Bolt → Hill Giant";
const QUIET_SEQ = 10;
const DECISION_SEQ = 11;

function moveNamed(state: GameState, playerId: string, sentence: string): Move {
    const move = candidateMoves(state, playerId).find(
        (candidate) => describeMove(candidate, state) === sentence
    );
    if (!move) throw new Error(`"${sentence}" is not legal in this position`);
    return move;
}

function traceFor(state: GameState, botId: string) {
    return {
        botId,
        chosen: describeMove(candidateMoves(state, botId)[0], state),
        iterationsCompleted: 1,
        iterationsRequested: 1,
        elapsedMs: 1,
        stoppedBy: "iterations" as const,
        mechanism: "mean-reward" as const,
        candidates: [],
    };
}

describe("the browser stack journal (issue #3480)", () => {
    beforeEach(clearStackJournal);

    it("names the bot's own submitted move as the window, through the real projection", () => {
        const state = buildVerdictPosition(RESPONSE_SPEC);
        // The BOT is `me` here: it is the active player, so it is the seat
        // that holds priority on a freshly built board and therefore the one
        // whose own move the driver can record.
        const bot = state.players[0].id;

        // Exactly what the driver hands over: the projection the bot decided
        // on, the seat, the Move. Nothing is cloned and no engine call runs
        // until a tester opens the quiz.
        const cast = moveNamed(state, bot, BOLT_THE_GIANT);
        recordJournalPly({
            state: projectPublicState(state, QUIET_SEQ, bot),
            playerId: bot,
            move: cast,
        });

        const entry = journalEntryFor(DECISION_SEQ, bot);
        expect(entry).not.toBe(null);
        // The card NAME survived the projection — the one thing a wire format
        // routinely loses, and the whole reason this runs through the real
        // reducer instead of a hand-built state.
        expect(entry?.steps).toEqual([
            {
                kind: "cast",
                card: "Lightning Bolt",
                by: bot,
                target: { card: "Hill Giant" },
            },
        ]);
        expect(entry?.quiet.stack).toHaveLength(0);
    });

    it("refuses a stack it never saw begin, rather than replaying a hole", () => {
        // The human's own click, which the driver does not submit and this
        // store therefore never sees. The quiz says so with a kind instead of
        // judging the Bot on a board that never existed.
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const [me, bot] = state.players.map((player) => player.id);
        applyMoveInSearch(state, me, moveNamed(state, me, BOLT_THE_GIANT));

        const source: AiTraceSource = {
            state: projectPublicState(state, DECISION_SEQ, bot),
            botId: bot,
        };
        const result = buildVerdictQuiz(
            traceFor(state, bot),
            source,
            journalEntryFor(DECISION_SEQ, bot)
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.refusal.kind).toBe("stack-not-journalled");
    });

    it("offers no window once a submission it cannot express lands in one", () => {
        // The driver's non-search realisations — a parked payment, a
        // combat-damage confirmation, an escalation decline — change the board
        // and have no setup step. This store keeps no state of its own, so the
        // fact rides IN the ring and the window that contains it finds it
        // (PR review, issue #3480).
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const bot = state.players[0].id;
        recordJournalPly({
            state: projectPublicState(state, QUIET_SEQ, bot),
            playerId: bot,
            move: moveNamed(state, bot, BOLT_THE_GIANT),
        });
        expect(journalEntryFor(DECISION_SEQ, bot)).not.toBe(null);

        markJournalOpaque(projectPublicState(state, QUIET_SEQ, bot), bot);
        expect(journalEntryFor(DECISION_SEQ, bot)).toBe(null);
    });

    it("offers no window for a decision taken before the plies it holds", () => {
        // The ring is not a log of one decision: a ply recorded at or after the
        // judged version belongs to a LATER window, and reading it would walk
        // the board past the position under judgement.
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const me = state.players[0].id;
        recordJournalPly({
            state: projectPublicState(state, DECISION_SEQ, me),
            playerId: me,
            move: moveNamed(state, me, BOLT_THE_GIANT),
        });
        expect(journalEntryFor(DECISION_SEQ, me)).toBe(null);
    });

    it("offers no window when the plies it holds never show a quiet board", () => {
        // Every recorded ply already had something on the stack, so the journal
        // never saw this window BEGIN and has no quiet board to lower.
        const state = buildVerdictPosition(RESPONSE_SPEC);
        const [me, bot] = state.players.map((player) => player.id);
        applyMoveInSearch(state, me, moveNamed(state, me, BOLT_THE_GIANT));
        recordJournalPly({
            state: projectPublicState(state, QUIET_SEQ, bot),
            playerId: bot,
            move: moveNamed(state, bot, "pass"),
        });
        expect(journalEntryFor(DECISION_SEQ, bot)).toBe(null);
    });
});
