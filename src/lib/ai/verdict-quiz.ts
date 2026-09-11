// The verdict quiz's model: one Bot decision, lowered into the thing a Verdict
// is made of (issue #3405, PRD #3397, ADR 0124 §1).
//
// WHY THE CANDIDATE LIST IS REBUILT AND NOT READ OFF THE TRACE. A verdict is a
// POSITION AND AN ANSWER: `spec` plus candidates named by the structural move
// key `moveKey` produces. The trace in the box holds `Move` objects too — but
// they carry the INSTANCE IDS of the live game, and the fit never sees that
// game: `evalPairsOf` rebuilds the board from the spec, re-enumerates, and
// matches the verdict's candidates BY KEY. Ids allocated by that rebuild are
// not the live game's, so a key taken from the trace would resolve against
// nothing and the whole verdict would come back "candidate no longer
// enumerated" at fit time — far from the tester who could still say what they
// meant.
//
// So the lowering does here, once, exactly what the fit will do later: build
// the position through the SAME builder (`buildSetupFreeVerdictState`, pinned
// to `buildVerdictState` by its own test — an in-play verdict has no setup
// steps, and the browser cannot reach the blade runner at all, ADR 0074),
// enumerate through the SAME
// `candidateMoves`, and key the candidates off THAT. What the trace is used for
// is the one thing the rebuild cannot know — which of those candidates the Bot
// itself picked — matched through the move describer's sentence, the same
// vocabulary the box already renders.
//
// Every failure is returned as data. A position that cannot be lowered, a
// rebuild the seat no longer owes a decision on, a pick the rebuilt list does
// not contain: each is a fact about this decision that the tester must SEE
// before submitting, never a thrown error inside a debug panel.

import { specFromState } from "@convex/gre/scenarioBuilder";
import { describeMove } from "@convex/gre/describeMove";
import { moveKey, decidingPlayer } from "@convex/gre/search";
import { PLACEHOLDER_CARD_ID } from "@convex/gre/constants";
import { seatPlayerId } from "@convex/gre/ai/blade/matcher";
import {
    buildSetupFreeVerdictState,
    candidateMoves,
} from "@convex/gre/ai/verdicts/candidates";
import type { VerdictCandidate } from "@convex/gre/ai/verdicts/types";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { GameState } from "@convex/gre/state";
import type { DecisionTrace } from "@convex/gre";
import { projectedToGameState } from "./state-adapter";
import type { AiTraceSource } from "./trace-store";

/** The judged seat, in the spec's own frame. Always `"me"`: the lowering below
 *  names the Bot's seat as `"me"`, which is `ScenarioSpec`'s `players[0]`
 *  convention (`gre/ai/blade/types.ts`). */
export const QUIZ_SEAT = "me" as const;

/** What the quiz renders and submits. */
export type VerdictQuiz = {
    /** The position, lowered from the board the search ran on. */
    spec: ScenarioSpec;
    /** The candidates as the REBUILT position offers them, in enumeration
     *  order — the list the fit will re-derive, so an index here means the same
     *  move there. */
    candidates: VerdictCandidate[];
    /** Which of them the Bot played. Always known: a rebuild that does not
     *  offer the Bot's own move is refused below, not shown. */
    botPickIndex: number;
    /** Everything the lowering could not carry (`specFromState`'s own report):
     *  the stack, a mana pool, combat past the declare step, … A verdict given
     *  on a position missing one of those is a judgement about a DIFFERENT
     *  board, so the quiz shows this rather than burying it. */
    dropped: string[];
};

export type VerdictQuizResult =
    | { ok: true; quiz: VerdictQuiz }
    | { ok: false; error: string };

/**
 * Lower one traced decision into a quiz, or say why it cannot be one.
 *
 * `source` is what the consult was called with; the position is reconstructed
 * from it by the same `projectedToGameState` the Brain uses, so the board
 * judged here is the board the search ran on — including what the Bot was not
 * allowed to know.
 */
export function buildVerdictQuiz(
    trace: DecisionTrace,
    source: AiTraceSource
): VerdictQuizResult {
    const position = projectedToGameState(
        source.state,
        source.knowledge,
        source.botId
    );

    if (position.activePlayerId !== source.botId) {
        // A decision taken with priority on the OPPONENT's turn cannot be
        // captured: `ScenarioSpec` has no field for the turn holder, so the
        // rebuild always makes the judged seat the active player. The position
        // that comes back is a different one — it offers the sorcery-speed
        // moves the Bot did not have — and "pass" exists in both lists, so the
        // Bot's own pick still resolves and nothing downstream would notice
        // that the answer is to another question. `specFromState` reports the
        // mismatch in `dropped[]`; here it has to be a refusal.
        return {
            ok: false,
            error: "this decision was taken on the opponent's turn — a scenario spec cannot express the turn holder, so the rebuilt position would be the Bot's own turn and a different decision entirely",
        };
    }

    if (position.stack.length > 0) {
        // A decision taken with something ON THE STACK — the Bot holding
        // priority over its own spell, or answering the opponent's. A
        // `ScenarioSpec` has no stack: the rebuild is the same board with the
        // spell simply gone, which can leave the candidate list IDENTICAL
        // (pass, and whatever the Bot could do anyway) while the position is
        // materially different — the Bolt that was about to kill a creature
        // never happened. The list check below cannot see that, and the
        // evaluation would learn the pair as if the board were quiet.
        return {
            ok: false,
            error: `this decision was taken with ${position.stack.length} object(s) on the stack — a scenario spec cannot express a stack, so the rebuilt position is a quiet board and a different question`,
        };
    }

    // The hidden half of the board has no identity to lower. The projection
    // gives a non-viewer's hand as `null` per card and the adapter rebuilds it
    // as opaque placeholders (`PLACEHOLDER_CARD_ID`) — which `specFromState`
    // cannot name, and throws on. They are stripped rather than invented, and
    // the hand size they carried is REPORTED: the opponent's hand count feeds
    // the evaluation's `hand` term, so a verdict given here is one given on a
    // board where the opponent holds fewer cards than they did.
    const { state: visible, hidden } = withoutHiddenIdentities(position);

    let spec: ScenarioSpec;
    let dropped: string[];
    try {
        const lowered = specFromState(visible, { mySeatId: source.botId });
        spec = lowered.spec;
        dropped = [...hidden, ...lowered.dropped];
    } catch (error) {
        return {
            ok: false,
            error: `this position could not be lowered into a scenario: ${message(error)}`,
        };
    }

    let rebuilt: GameState;
    try {
        rebuilt = buildSetupFreeVerdictState(spec);
    } catch (error) {
        return {
            ok: false,
            error: `the lowered position could not be rebuilt: ${message(error)}`,
        };
    }

    const seatId = seatPlayerId(rebuilt, QUIZ_SEAT);
    if (decidingPlayer(rebuilt) !== seatId) {
        // The same check `evalPairsOf` runs before it builds a pair. Caught
        // here it is a sentence in the panel; caught there it is a verdict in
        // git that never meant anything.
        return {
            ok: false,
            error: "the rebuilt position owes the Bot no decision — what it was deciding did not survive the lowering (see the stack or combat notes above)",
        };
    }

    const moves = candidateMoves(rebuilt, seatId);
    if (moves.length < 2) {
        // A one-candidate list is what `collectVerdictReport` calls
        // UNCONSTRAINING: every decider takes the only legal line, so the
        // judgement states no preference and the fit can build no pair from it.
        // The mutation would accept it and the corpus would carry a row that
        // means nothing.
        return {
            ok: false,
            error: "the rebuilt position offers only one move — a verdict there would state no preference",
        };
    }

    const candidates: VerdictCandidate[] = moves.map((move) => ({
        key: moveKey(move),
        description: describeMove(move, rebuilt),
    }));

    // THE decision, or a different one? Everything above checks the rebuild
    // against itself; this checks it against the board the Bot actually
    // searched. The two lists are compared through the describer because that
    // is the only vocabulary they share — the ids underneath differ by
    // construction — and a mismatch means the lowering lost something the
    // decision depended on, whatever `dropped[]` did or did not manage to name.
    const liveDescriptions = candidateMoves(position, source.botId)
        .map((move) => describeMove(move, position))
        .sort();
    const rebuiltDescriptions = candidates
        .map((candidate) => candidate.description)
        .sort();
    if (!sameList(liveDescriptions, rebuiltDescriptions)) {
        return {
            ok: false,
            error: `the rebuilt position offers a different decision (${describeDifference(liveDescriptions, rebuiltDescriptions)}) — this one cannot be captured as a scenario${
                dropped.length > 0
                    ? ` (not captured: ${dropped.join("; ")})`
                    : ""
            }`,
        };
    }

    // The Bot's pick, by the describer's sentence — the only vocabulary the
    // live decision and the rebuilt position share (the ids underneath differ
    // by construction). `findIndex` takes the first match: two candidates can
    // describe identically only when they are the same play on interchangeable
    // cards, in which case either index names the move that was made.
    const botPickIndex = candidates.findIndex(
        (candidate) => candidate.description === trace.chosen
    );
    if (botPickIndex === -1) {
        // The rebuild does not offer the move that was actually played, so it
        // is not this decision: the lowering lost something the decision
        // depended on (a declared combat, a spell on the stack, a mana pool).
        // Judging the list anyway would file an answer about a DIFFERENT
        // position under the Bot's name — the one failure of this whole flow
        // that nothing downstream could ever detect, because the verdict it
        // produces rebuilds and enumerates perfectly.
        return {
            ok: false,
            error: `the Bot played "${trace.chosen}", which the rebuilt position does not offer — this decision cannot be captured as a scenario${
                dropped.length > 0
                    ? ` (not captured: ${dropped.join("; ")})`
                    : ""
            }`,
        };
    }

    return { ok: true, quiz: { spec, candidates, botPickIndex, dropped } };
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}

/** The same state with every hidden-identity instance removed from a hand, plus
 *  one note per seat that lost cards. Libraries keep their placeholders: the
 *  lowering never names library contents, it only counts them. */
function withoutHiddenIdentities(state: GameState): {
    state: GameState;
    hidden: string[];
} {
    const hidden: string[] = [];
    const players = state.players.map((player) => {
        const visible = player.hand.filter(
            (card) => (card.card as { id?: string }).id !== PLACEHOLDER_CARD_ID
        );
        if (visible.length === player.hand.length) return player;
        hidden.push(
            `${player.id}'s hand: ${player.hand.length - visible.length} card(s) whose identity the Bot could not see — dropped, so the rebuilt hand is ${visible.length} card(s) and the evaluation's hand term reads lower here than it did in play`
        );
        return { ...player, hand: visible };
    });
    return hidden.length === 0
        ? { state, hidden }
        : {
              state: { ...state, players: players as GameState["players"] },
              hidden,
          };
}

function sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** One sentence naming how the two candidate lists differ — the first move
 *  each list has that the other does not, which is what tells a tester whether
 *  they are looking at a lowering gap or a bug. */
function describeDifference(live: string[], rebuilt: string[]): string {
    const missing = live.find((move) => !rebuilt.includes(move));
    const extra = rebuilt.find((move) => !live.includes(move));
    const parts: string[] = [];
    if (missing)
        parts.push(`the Bot had "${missing}" and the rebuild does not`);
    if (extra) parts.push(`the rebuild offers "${extra}" and the Bot did not`);
    if (parts.length === 0) {
        parts.push(
            `${live.length} move(s) in play against ${rebuilt.length} on the rebuild`
        );
    }
    return parts.join("; ");
}
