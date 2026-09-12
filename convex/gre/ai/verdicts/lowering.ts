// Lowering ONE Bot decision into the thing a Verdict is made of — and, when it
// cannot be lowered, saying WHY in a frozen vocabulary (PRD #3397, ADR 0124 §1).
//
// This is the pure core `src/lib/ai/verdict-quiz.ts` was written as. It moved
// here for two reasons, and the second is the load-bearing one:
//
//  1. the browser is not the only caller any more — the lowering sweep
//     (issue #3461) runs it at every decision of a headless self-play game, to
//     MEASURE which refusals actually fire instead of sampling whichever one a
//     tester happened to screenshot;
//  2. a second caller is how a second vocabulary gets invented. The refusal
//     kinds below are a frozen union, not free prose, derived from ONE array so
//     a new refusal cannot be declared without also being countable. Today the
//     consumers of the kind are the sweep, which ranks it, and the debug
//     panel, which TITLES a refusal with it (issue #3457) through the table in
//     `src/lib/ai/verdict-quiz.ts` — a vocabulary inherited from here, never a
//     second one invented beside it.
//
// Every failure is returned as DATA. A position that cannot be lowered, a
// rebuild the seat no longer owes a decision on, a pick the rebuilt list does
// not contain: each is a fact about this decision a caller must be able to SEE,
// never a thrown error inside a debug panel or a self-play loop.
//
// WHY THE CANDIDATE LIST IS REBUILT AND NOT READ OFF THE TRACE. A verdict is a
// POSITION AND AN ANSWER: `spec` plus candidates named by the structural move
// key `moveKey` produces. The fit never sees the live game — `evalPairsOf`
// rebuilds the board from the spec, re-enumerates, and matches candidates BY
// KEY. Ids allocated by that rebuild are not the live game's, so a key taken
// from the live decision would resolve against nothing at fit time, far from
// whoever could still say what they meant. So the lowering does here, once,
// exactly what the fit will do later: build through the SAME
// `buildSetupFreeVerdictState`, enumerate through the SAME `candidateMoves`,
// and key the candidates off THAT. What the caller supplies is the one thing
// the rebuild cannot know — which candidate the Bot itself picked — matched
// through the move describer's sentence, the vocabulary both sides share.

import { COMBAT_DROPPED_PREFIX, specFromState } from "../../scenarioBuilder";
import { describeMove } from "../../describeMove";
import { moveKey, decidingPlayer } from "../../search";
import { seatPlayerId } from "../blade/matcher";
import { buildSetupFreeVerdictState, candidateMoves } from "./candidates";
import type { VerdictCandidate } from "./types";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";

/** The judged seat, in the spec's own frame. Always `"me"`: the lowering below
 *  names the Bot's seat as `"me"`, which is `ScenarioSpec`'s `players[0]`
 *  convention (`gre/ai/blade/types.ts`). */
export const QUIZ_SEAT = "me" as const;

/**
 * Why a Bot decision could NOT become a Verdict — the frozen union.
 *
 * One member per refusal SITE in {@link lowerDecision}, in the order the sites
 * run. It is a closed vocabulary on purpose: it is what a refusal is TITLED
 * with and what the lowering sweep ranks, so "how often does the stack cost us
 * a verdict?" is a lookup rather than a regex over prose.
 *
 * The ARRAY is the source and the union derives from it, never the reverse. A
 * hand-written `readonly VerdictRefusalKind[]` parallel to a hand-written union
 * constrains each element to be a kind but never requires every kind to be
 * PRESENT — so a ninth member added to the union alone keeps `tsc` green while
 * `LoweringSweepTally` seeds no counter for it and the whole refusals cell
 * becomes `NaN` on the first decision that hits it (PR review, issue #3461).
 *
 *  - `stack-not-empty` — something was on the stack; a spec has no stack.
 *  - `lowering-threw` — `specFromState` refused the position outright.
 *  - `rebuild-threw` — the spec came back but `buildStateFromScenario` could
 *    not rebuild it.
 *  - `no-decision-owed` — the rebuilt position owes the judged seat nothing.
 *  - `single-candidate` — one legal move, so a verdict would state no
 *    preference (`collectVerdictReport`'s UNCONSTRAINING).
 *  - `different-decision` — the rebuilt candidate list is not the live one.
 *  - `combat-not-captured` — the lowering lost a combat fact (issue #3458).
 *  - `pick-not-offered` — the rebuild does not offer the move that was played.
 */
export const VERDICT_REFUSAL_KINDS = [
    "stack-not-empty",
    "lowering-threw",
    "combat-not-captured",
    "rebuild-threw",
    "no-decision-owed",
    "single-candidate",
    "different-decision",
    "pick-not-offered",
] as const;

export type VerdictRefusalKind = (typeof VERDICT_REFUSAL_KINDS)[number];

/** One decision, lowered. */
export type LoweredDecision = {
    /** The position, lowered from the board the search ran on. */
    spec: ScenarioSpec;
    /** The candidates as the REBUILT position offers them, in enumeration
     *  order — the list the fit will re-derive, so an index here means the same
     *  move there. */
    candidates: VerdictCandidate[];
    /** Which of them the Bot played. Always known: a rebuild that does not
     *  offer the Bot's own move is refused, not returned. */
    botPickIndex: number;
    /** Everything the lowering could not carry (`specFromState`'s own report,
     *  plus any hidden-identity note): the stack, a mid-flight payment, an
     *  instance-keyed restricted-mana permission (CR 106.6), … A verdict given
     *  on a position missing one of those is a
     *  judgement about a DIFFERENT board, so this is surfaced, never buried. */
    dropped: string[];
};

export type LoweringOutcome =
    | { ok: true; lowered: LoweredDecision }
    | {
          ok: false;
          kind: VerdictRefusalKind;
          /** The sentence a human reads, and ONLY that sentence: what the
           *  lowering dropped belongs to `dropped` below, never folded into
           *  the middle of it. Two sites used to append a semicolon-joined
           *  `(not captured: …)` run-on twenty entries long, which is what the
           *  refusal panel then had to render as one flat red paragraph
           *  (issue #3457). The KIND is what a report counts. */
          error: string;
          /** What the lowering had managed to drop before it refused — empty
           *  for the refusals that fire before `specFromState` ever runs. */
          dropped: string[];
      };

/**
 * Lower one Bot decision into a verdict-shaped record, or say why it cannot be
 * one. Pure — no mutation of `position`.
 *
 * `chosenDescription` is `describeMove`'s sentence for the move the Bot played
 * on the LIVE position (the DecisionTrace's `chosen` in the browser, the
 * describer's own output in a headless run).
 */
export function lowerDecision(
    position: GameState,
    botId: string,
    chosenDescription: string
): LoweringOutcome {
    // A decision taken with priority on the OPPONENT's turn used to refuse here
    // (`opponent-turn`): `ScenarioSpec` had no field for the turn holder, so
    // the rebuild always made the judged seat active and came back offering the
    // sorcery-speed moves the Bot did not have (CR 307.1) — while `pass`
    // existed in both lists, so the pick still resolved and nothing downstream
    // would have noticed the answer was to another question. That refusal took
    // out the entire class PRD #3397 exists for: holding up removal, a combat
    // trick, declining to act under an attack.
    //
    // Issue #3454 gave the spec `activePlayer` / `priority` / `passCount`, and
    // `specFromState` lowers all three — so the lowering CARRIES the fact
    // instead of dropping it, and the site is gone rather than relaxed.
    // Nothing replaces it on purpose: the `different-decision` check below is
    // what proves the lowering worked, comparing the rebuilt candidate list
    // against the live one move for move. A turn holder that failed to survive
    // shows up there as sorcery-speed moves the live list never had.

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
            kind: "stack-not-empty",
            dropped: [],
            error: `this decision was taken with ${position.stack.length} object(s) on the stack — a scenario spec cannot express a stack, so the rebuilt position is a quiet board and a different question`,
        };
    }

    // The hidden half of the board has no identity to lower: a projected
    // client state gives a non-viewer's hand as `null` per card and the adapter
    // rebuilds it as opaque placeholders (`PLACEHOLDER_CARD_ID`). Issue #3452
    // moved that fact INTO the spec — `specFromState` counts them into
    // `hiddenHand` and the rebuild seeds the same shape back — so this site no
    // longer strips anything and the hand the verdict is judged on is the SIZE
    // it was in play, which the evaluation's `hand` term reads. There is one
    // path, not two: nothing pre-filters the position here.
    let spec: ScenarioSpec;
    let dropped: string[];
    try {
        const lowered = specFromState(position, { mySeatId: botId });
        spec = lowered.spec;
        dropped = lowered.dropped;
    } catch (error) {
        return {
            ok: false,
            kind: "lowering-threw",
            dropped: [],
            error: `this position could not be lowered into a scenario: ${message(error)}`,
        };
    }

    // CR 508.1 / 509.1 (issue #3458 review) — a combat fact the spec could not
    // carry is a REFUSAL, not a note. The `different-decision` check below is
    // what catches a lowering that lost something, and combat is the one area
    // where it is systematically blind: an attack redirected at a planeswalker
    // (CR 508.1b) admits exactly the same blocks as an attack on the face
    // (CR 509.1a), and two same-named creatures render as the same
    // `describeMove` sentence — so the two lists match move for move while the
    // board differs. The same argument `stack-not-empty` above makes, applied
    // where it is just as true. Before issue #3458 every one of these
    // positions was refused anyway (the spec had no combat at all), so this
    // keeps a wrong-board verdict from being the thing that widening bought.
    const combatLost = dropped.filter((note) =>
        note.startsWith(COMBAT_DROPPED_PREFIX)
    );
    if (combatLost.length > 0) {
        return {
            ok: false,
            kind: "combat-not-captured",
            dropped,
            error: `this decision's combat did not survive the lowering (${combatLost.length} fact(s)) — the rebuilt board is a different combat, and a candidate list can match move for move while it is`,
        };
    }

    let rebuilt: GameState;
    try {
        rebuilt = buildSetupFreeVerdictState(spec);
    } catch (error) {
        return {
            ok: false,
            kind: "rebuild-threw",
            dropped,
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
            kind: "no-decision-owed",
            dropped,
            error: 'the rebuilt position owes the Bot no decision — what it was deciding did not survive the lowering (see the "not captured" notes for what it lost)',
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
            kind: "single-candidate",
            dropped,
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
    const liveDescriptions = candidateMoves(position, botId)
        .map((move) => describeMove(move, position))
        .sort();
    const rebuiltDescriptions = candidates
        .map((candidate) => candidate.description)
        .sort();
    if (!sameList(liveDescriptions, rebuiltDescriptions)) {
        return {
            ok: false,
            kind: "different-decision",
            dropped,
            error: `the rebuilt position offers a different decision (${describeDifference(liveDescriptions, rebuiltDescriptions)}) — this one cannot be captured as a scenario`,
        };
    }

    // The Bot's pick, by the describer's sentence — the only vocabulary the
    // live decision and the rebuilt position share (the ids underneath differ
    // by construction). `findIndex` takes the first match: two candidates can
    // describe identically only when they are the same play on interchangeable
    // cards, in which case either index names the move that was made.
    const botPickIndex = candidates.findIndex(
        (candidate) => candidate.description === chosenDescription
    );
    if (botPickIndex === -1) {
        // The rebuild does not offer the move that was actually played, so it
        // is not this decision: the lowering lost something the decision
        // depended on (a spell on the stack, a mid-flight payment).
        // Judging the list anyway would file an answer about a DIFFERENT
        // position under the Bot's name — the one failure of this whole flow
        // that nothing downstream could ever detect, because the verdict it
        // produces rebuilds and enumerates perfectly.
        return {
            ok: false,
            kind: "pick-not-offered",
            dropped,
            error: `the Bot played "${chosenDescription}", which the rebuilt position does not offer — this decision cannot be captured as a scenario`,
        };
    }

    return { ok: true, lowered: { spec, candidates, botPickIndex, dropped } };
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}

function sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** One sentence naming how the two candidate lists differ — the first move
 *  each list has that the other does not, which is what tells a reader whether
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
