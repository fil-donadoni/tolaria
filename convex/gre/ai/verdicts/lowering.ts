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
// the rebuild cannot know — which candidate the Bot itself picked — named by
// the move describer's sentence for the LIVE board, which is where the caller
// read it and the only board it is matched against.
//
// WHAT THE TWO BOARDS ARE COMPARED BY (issue #3483). Not the describer. Its
// sentence was called "the only vocabulary they share" and it is not one: it
// names the PLAYER, so every decision targeting a player read "→ Mr bambury
// (P1)" live and "→ Blade P2" on the rebuild, and `different-decision` refused
// a position the spec had captured perfectly. `canonicalMoveKey`
// (`gre/canonicalMoveKey.ts`) is the vocabulary both sides really share —
// relative seat index for a player, definition id for a card instance, nothing
// per-world — and the whole class goes with the name rather than that one
// case. The describer stays what it is: the sentence a human READS.

import { COMBAT_DROPPED_PREFIX, specFromState } from "../../scenarioBuilder";
import { describeMove } from "../../describeMove";
import { canonicalMoveKey, relativeSeatIndexes } from "../../canonicalMoveKey";
import { moveKey, decidingPlayer } from "../../search";
import { seatPlayerId } from "../blade/matcher";
import { buildVerdictPosition, candidateMoves } from "./candidates";
import { materialiseJournalSteps, stackShape } from "./journal";
import type { StackJournalEntry } from "./journal";
import type { VerdictCandidate } from "./types";
import type { BladeSeat, BladeSetupStep } from "../blade/types";
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
 *  - `stack-mid-resolution` — an object on the stack is PARTWAY THROUGH
 *    resolving (`resolutionStep` / `collectedChoices`). No setup step puts a
 *    half-resolved object back, and the collected answers are not replayable.
 *  - `stack-not-journalled` — something was on the stack and the journal
 *    (`verdicts/journal.ts`) cannot say how it got there: no window was open,
 *    a move in it had no faithful setup step, a seat did not map, or the
 *    replayed stack does not match the live one object for object.
 *  - `lowering-threw` — `specFromState` refused the position outright.
 *  - `rebuild-threw` — the spec came back but `buildStateFromScenario` could
 *    not rebuild it.
 *  - `no-decision-owed` — the rebuilt position owes the judged seat nothing.
 *  - `single-candidate` — one legal move, so a verdict would state no
 *    preference (`collectVerdictReport`'s UNCONSTRAINING).
 *  - `different-decision` — the rebuilt candidate list is not the live one.
 *  - `combat-not-captured` — the lowering lost a combat fact (issue #3458).
 *  - `pick-not-offered` — the move that was played is not among the candidates:
 *    the LIVE position never offered it (the live site), or the rebuild does
 *    not (the invariant assertion behind the list comparison).
 */
export const VERDICT_REFUSAL_KINDS = [
    "stack-mid-resolution",
    "stack-not-journalled",
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
    /** The position, lowered from the board the search ran on — or, when the
     *  decision was taken with something on the stack, from the QUIET board the
     *  journal kept, with `setup` walking it back to here. */
    spec: ScenarioSpec;
    /** The engine-real steps that walk `spec` to the decision (issue #3480).
     *  Absent for a decision taken on an empty stack, which is the majority.
     *  Exactly the field `Verdict` stores and `buildVerdictPosition` replays,
     *  so a judgement filed from here rebuilds months later the same way. */
    setup?: BladeSetupStep[];
    /** The candidates as the REBUILT position offers them, in enumeration
     *  order — the list the fit will re-derive, so an index here means the same
     *  move there. */
    candidates: VerdictCandidate[];
    /** Which of them the Bot played. Always known: a rebuild that does not
     *  offer the Bot's own move is refused, not returned. */
    botPickIndex: number;
    /** Everything the lowering could not carry (`specFromState`'s own report,
     *  plus any hidden-identity note): a mid-flight payment, an instance-keyed
     *  restricted-mana permission (CR 106.6), … A verdict given on a position
     *  missing one of those is a judgement about a DIFFERENT board, so this is
     *  surfaced, never buried.
     *
     *  It reports the board that was LOWERED, which with a journalled stack is
     *  the QUIET one rather than the decision's own (issue #3480) — `setup`
     *  walks the rest, so a fact the walk itself re-creates is not lost even
     *  though nothing here names it. `loweringSweep.observeDecision`
     *  deliberately re-derives its own tally on the live state instead, and
     *  says why there. */
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
    chosenDescription: string,
    journal?: StackJournalEntry | null
): LoweringOutcome {
    // Which seat a live player id is, in the spec's own frame: `specFromState`
    // is called with `mySeatId: botId`, so the Bot is `players[0]` = `"me"` in
    // everything built from the result.
    const liveSeatOf = (playerId: string): BladeSeat | null =>
        playerId === botId
            ? "me"
            : position.players.some((p) => p.id === playerId)
              ? "opp"
              : null;
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

    // A decision taken with something ON THE STACK — the Bot holding priority
    // over its own spell, or answering the opponent's. A `ScenarioSpec` has no
    // stack, so the board that is lowered is the QUIET one the journal kept
    // (`verdicts/journal.ts`) and the walk back to here travels as `setup`,
    // exactly as a blade entry's does. Lowering the LIVE board instead would
    // rebuild the same position with the spell simply gone, which can leave
    // the candidate list IDENTICAL (pass, and whatever the Bot could do
    // anyway) while the position is materially different — the Bolt that was
    // about to kill a creature never happened.
    //
    // `source` is the board that gets lowered; `setup` is how it is walked
    // back. Both stay at their empty-stack identity when there is no stack.
    let source = position;
    let setup: BladeSetupStep[] | undefined;
    if (position.stack.length > 0) {
        // CR 608.3 — an object PARTWAY through resolving. No setup step puts a
        // half-resolved object back on the stack, and `collectedChoices` are
        // answers already given inside this resolution, which nothing replays.
        // Its own kind rather than the journal's: a journal that saw the whole
        // window still cannot express this, so counting the two together would
        // hide a structural gap behind a coverage one.
        const midResolution = position.stack.filter(
            (item) =>
                item.resolutionStep !== undefined ||
                item.collectedChoices !== undefined
        );
        if (midResolution.length > 0) {
            return {
                ok: false,
                kind: "stack-mid-resolution",
                dropped: [],
                error: `${midResolution.length} object(s) on the stack are partway through resolving (CR 608.3) — a setup step puts an object on the stack, never a half-resolved one`,
            };
        }
        if (!journal) {
            return {
                ok: false,
                kind: "stack-not-journalled",
                dropped: [],
                error: `this decision was taken with ${position.stack.length} object(s) on the stack and no journalled walk to it — the caller either drives no journal, or the window held a move with no faithful setup step`,
            };
        }
        const steps = materialiseJournalSteps(journal.steps, liveSeatOf);
        if (!steps) {
            return {
                ok: false,
                kind: "stack-not-journalled",
                dropped: [],
                error: "the journalled walk names a seat this position does not have — it belongs to another game, or to a seat the lowering cannot place",
            };
        }
        source = journal.quiet;
        setup = steps;
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
        const lowered = specFromState(source, { mySeatId: botId });
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
    // board differs. The same argument the stack sites above make, applied
    // where it is just as true. Before issue #3458 every one of these
    // positions was refused anyway (the spec had no combat at all), so this
    // keeps a wrong-board verdict from being the thing that widening bought.
    // On a journalled window this reads the QUIET board's combat, not the
    // decision's. They are the same combat: no `JournalStep` is a combat
    // declaration (`verdicts/journal.ts` — a blade `declare-attackers` step
    // declares AND walks priority, so it is not one move and is never
    // recorded), so a window cannot cross one.
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
        rebuilt = buildVerdictPosition(spec, setup);
    } catch (error) {
        // A `setup`-carrying build that throws is the JOURNAL's failure, not
        // the board's: `applyBladeSetup` throws `BladeSetupError` when a step
        // finds no purchase in the real engine (ADR 0070 §4), which means the
        // recorded walk does not describe this game. Counting it as
        // `rebuild-threw` would file it under "the spec is unloadable" and
        // point the next reader at the spec vocabulary instead of the journal.
        return {
            ok: false,
            kind: setup ? "stack-not-journalled" : "rebuild-threw",
            dropped,
            error: setup
                ? `the journalled walk (${setup.length} step(s)) could not be replayed on the lowered board: ${message(error)}`
                : `the lowered position could not be rebuilt: ${message(error)}`,
        };
    }

    const seatId = seatPlayerId(rebuilt, QUIZ_SEAT);

    // Did the walk reproduce the STACK? `different-decision` below compares
    // candidate LISTS, and a candidate list is exactly what a response the
    // journal missed can leave unchanged: the opponent casting a second spell
    // in reply adds an object to the board without adding a move to the Bot's
    // options. So the stack itself is compared, object for object, in the only
    // vocabulary the live game and a rebuild share (`stackShape` — names and
    // seats, never instance ids, which the rebuild allocates itself). It fails
    // CLOSED, like every other check here: a mismatch is a refusal.
    if (setup) {
        const rebuiltSeat = (playerId: string): BladeSeat | null =>
            playerId === seatId
                ? QUIZ_SEAT
                : rebuilt.players.some((p) => p.id === playerId)
                  ? "opp"
                  : null;
        const live = stackShape(position, liveSeatOf);
        const replayed = stackShape(rebuilt, rebuiltSeat);
        if (!sameList(live, replayed)) {
            return {
                ok: false,
                kind: "stack-not-journalled",
                dropped,
                error: `the journalled walk rebuilt a different stack — in play [${live.join(" | ")}], on the rebuild [${replayed.join(" | ")}]`,
            };
        }
    }
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

    // The sentences a tester reads are taken off the REBUILT board, whose seats
    // carry the blade harness's own names ("Blade P1" / "Blade P2") — so a
    // candidate rendered as "activate Seal of Fire → Blade P1" in the panel,
    // which is not a player anybody at that table is called (issue #3483). The
    // live nicknames must NOT be propagated here: the quiz's candidate keys
    // have to resolve when `evalPairsOf` re-enumerates from the stored spec
    // months later, and a spec carries no names. So the seats are named by
    // their ROLE instead, in the same relative frame `canonicalMoveKey`
    // compares in. Cosmetic and local, and placed exactly here — after every
    // check above, none of which reads a player name, and before the only
    // describer calls on `rebuilt`.
    nameSeatsByRole(rebuilt, seatId);

    const candidates: VerdictCandidate[] = moves.map((move) => ({
        // The STORED key stays `moveKey` (issue #3400) and this slice does not
        // touch it: a verdict's candidates are found again by re-enumerating
        // the SAME rebuild from the SAME spec, where the ids reproduce, so the
        // structural key is the right handle there — and changing it would
        // strand every verdict already in the corpus. The canonical key below
        // answers a different question (the same move across TWO builds) and
        // is never stored.
        key: moveKey(move),
        description: describeMove(move, rebuilt),
    }));

    // THE decision, or a different one? Everything above checks the rebuild
    // against itself; this checks it against the board the Bot actually
    // searched. Compared by CANONICAL KEY (see this file's header): the ids
    // underneath differ by construction and the describer's sentence is not
    // invariant either, so the comparison runs in the one vocabulary both
    // builds can produce. A mismatch means the lowering lost something the
    // decision depended on, whatever `dropped[]` did or did not manage to name.
    const liveCandidates = candidateMoves(position, botId).map((move) => ({
        key: canonicalMoveKey(move, position, botId),
        description: describeMove(move, position),
    }));
    const rebuiltCandidates = moves.map((move, index) => ({
        key: canonicalMoveKey(move, rebuilt, seatId),
        description: candidates[index].description,
    }));
    const difference = candidateSetsDiffer(liveCandidates, rebuiltCandidates);
    if (difference !== null) {
        return {
            ok: false,
            kind: "different-decision",
            dropped,
            error: `the rebuilt position offers a different decision (${difference}) — this one cannot be captured as a scenario`,
        };
    }

    // The Bot's pick. Two hops, each in the vocabulary that is valid for it:
    // the caller's sentence is matched against the LIVE list, where the
    // describer produced it and where it is exact, and the move it names is
    // then carried to the rebuilt list by canonical key. `find` / `findIndex`
    // take the first match: two candidates can key identically only when they
    // are the same play on interchangeable cards, in which case either one
    // names the move that was made (the describer's own limit, unchanged).
    const played = liveCandidates.find(
        (candidate) => candidate.description === chosenDescription
    );
    if (played === undefined) {
        // The caller named a move the LIVE position never offered, so this is
        // not that decision. Judging the list anyway would file an answer about
        // a DIFFERENT position under the Bot's name — the one failure of this
        // whole flow that nothing downstream could ever detect, because the
        // verdict it produces rebuilds and enumerates perfectly.
        return {
            ok: false,
            kind: "pick-not-offered",
            dropped,
            error: `the Bot played "${chosenDescription}", which is not one of the moves the live position offered — this decision cannot be captured as a scenario`,
        };
    }
    const botPickIndex = rebuiltCandidates.findIndex(
        (candidate) => candidate.key === played.key
    );
    if (botPickIndex === -1) {
        // UNREACHABLE while `candidateSetsDiffer` above returns null: it has
        // already established that the two key multisets are equal, so a key
        // found in the live list is in the rebuilt one. Kept as the assertion
        // that says so, not as a second live failure mode — because the
        // alternative is returning `botPickIndex: -1`, a verdict whose Bot pick
        // points at no candidate, which is precisely the silently-undetectable
        // record this whole function exists to refuse (PR review).
        return {
            ok: false,
            kind: "pick-not-offered",
            dropped,
            error: `the Bot played "${chosenDescription}", which the rebuilt position does not offer — this decision cannot be captured as a scenario`,
        };
    }

    return {
        ok: true,
        lowered: {
            spec,
            ...(setup ? { setup } : {}),
            candidates,
            botPickIndex,
            dropped,
        },
    };
}

/** Name every seat of a REBUILT position by its role relative to `seatId`, so
 *  the describer's sentences read "the opponent" rather than the blade
 *  harness's "Blade P2". Mutates `state`, which the only caller built itself.
 *  Derived from the same relative seat frame `canonicalMoveKey` keys in, so a
 *  third seat gets a number rather than a special case. */
function nameSeatsByRole(state: GameState, seatId: string): void {
    const seats = relativeSeatIndexes(state, seatId);
    for (const player of state.players) {
        const seat = seats.get(player.id);
        if (seat === undefined) continue;
        player.name =
            seat === 0
                ? "the Bot"
                : state.players.length === 2
                  ? "the opponent"
                  : `opponent ${seat}`;
    }
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}

function sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** One candidate, as this guard handles them: the canonical key it is MATCHED
 *  by and the describer's sentence it is REPORTED by. The two are deliberately
 *  different jobs — the whole of issue #3483 was one function doing both. */
export type ComparedCandidate = { key: string; description: string };

/**
 * Whether the live decision and the rebuilt one name the same set of moves —
 * `null` when they agree, else ONE sentence naming how they differ.
 *
 * Matching is by CANONICAL KEY, which is what makes the comparison meaningful
 * across two builds of the same position. REPORTING is by the describer's
 * sentence, because a JSON key is not something a reader can act on — and each
 * side reports in the vocabulary of the board it came from.
 *
 * Exported as the guard's own seam: "the rebuild is missing a move" and "the
 * rebuild offers an extra one" are the two failures that MUST still be
 * refused, and pinning them here names the mechanism instead of hunting a
 * position that happens to produce one.
 */
export function candidateSetsDiffer(
    live: ComparedCandidate[],
    rebuilt: ComparedCandidate[]
): string | null {
    const liveKeys = live.map((candidate) => candidate.key).sort();
    const rebuiltKeys = rebuilt.map((candidate) => candidate.key).sort();
    if (
        liveKeys.length === rebuiltKeys.length &&
        liveKeys.every((key, i) => key === rebuiltKeys[i])
    ) {
        return null;
    }
    const inRebuild = new Set(rebuiltKeys);
    const inLive = new Set(liveKeys);
    const missing = live.find((candidate) => !inRebuild.has(candidate.key));
    const extra = rebuilt.find((candidate) => !inLive.has(candidate.key));
    const parts: string[] = [];
    if (missing) {
        parts.push(
            `the Bot had "${missing.description}" and the rebuild does not`
        );
    }
    if (extra) {
        parts.push(
            `the rebuild offers "${extra.description}" and the Bot did not`
        );
    }
    if (parts.length === 0) {
        // Same keys on both sides but not the same MULTIPLICITY — a
        // duplicate-bearing list, which the set difference above cannot name.
        parts.push(
            `${live.length} move(s) in play against ${rebuilt.length} on the rebuild`
        );
    }
    return parts.join("; ");
}
