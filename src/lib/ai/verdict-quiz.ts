// The verdict quiz's model: one Bot decision, lowered into the thing a Verdict
// is made of (issue #3405, PRD #3397, ADR 0124 §1).
//
// The lowering itself is NOT here. It is `convex/gre/ai/verdicts/lowering.ts`,
// because the browser stopped being its only caller: the lowering sweep
// (issue #3461) runs the same function at every decision of a headless
// self-play game to measure which refusals actually fire. What stays here is
// the browser's half — turning the Brain's `AiTraceSource` into the raw
// position the sweep already has, and giving a refusal the shape a PANEL needs
// (issue #3457): the frozen KIND turned into a one-line TITLE, the prose kept
// beside it as the detail, the dropped notes kept as a LIST rather than folded
// into the middle of a sentence, and a plain-text report a tester can paste.

import { projectedToGameState } from "./state-adapter";
import {
    lowerDecision,
    QUIZ_SEAT,
    VERDICT_REFUSAL_KINDS,
    type VerdictRefusalKind,
} from "@convex/gre/ai/verdicts/lowering";
import type { VerdictCandidate } from "@convex/gre/ai/verdicts/types";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { DecisionTrace } from "@convex/gre";
import { describeMove } from "@convex/gre/describeMove";
import type { AiTraceSource } from "./trace-store";
import type { VerdictProposal } from "./verdict-proposals";

export { QUIZ_SEAT };
export type { VerdictRefusalKind };

/** What the quiz renders and submits. */
export type VerdictQuiz = {
    /** The position, lowered from the board the search ran on — stack
     *  included, as declared objects (`spec.stack`, issue #3514). */
    spec: ScenarioSpec;
    /** The candidates as the REBUILT position offers them, in enumeration
     *  order — the list the fit will re-derive, so an index here means the same
     *  move there. */
    candidates: VerdictCandidate[];
    /** Which of them the Bot played. Always known: a rebuild that does not
     *  offer the Bot's own move is refused below, not shown. */
    botPickIndex: number;
    /** Everything the lowering could not carry (`specFromState`'s own report):
     *  the stack, a mid-flight payment, an instance-keyed restricted-mana
     *  permission (CR 106.6), … A verdict given
     *  on a position missing one of those is a judgement about a DIFFERENT
     *  board, so the quiz shows this rather than burying it. */
    dropped: string[];
    /** Which candidate the PLAYER made, when the decision being judged was
     *  theirs (a Verdict Proposal, issue #3986) and the rebuild offers it.
     *  Display only: it is never submitted, so a Verdict given on a proposal
     *  is the same record as one given on the Bot's own decision. */
    playerPickIndex?: number;
};

/**
 * Where a quiz's decision comes from (issue #3986) — the two feeds of the one
 * builder below:
 *
 * - `trace`: a Bot decision from the debug ring (`trace-store.ts`), judged
 *   while the game is on.
 * - `proposal`: a decision the HUMAN seat made, offered back after the game
 *   (`verdict-proposals.ts`). The "Bot pick" is the Brain's own move on the
 *   same view, so `botPickIndex` names the Brain's choice in both feeds and
 *   the stored Verdict cannot tell them apart — which the acceptance asks
 *   for. Know what that costs: here the pick is a COUNTERFACTUAL, a game-end
 *   consult at `verdictProposals.iterations` and its fixed seed rather than
 *   the live difficulty budget, and the player's own move is not stored (it
 *   is only marked on screen, `playerPickIndex`).
 */
export type QuizFeed =
    | { kind: "trace"; trace: DecisionTrace; source: AiTraceSource }
    | { kind: "proposal"; proposal: VerdictProposal };

/** One decision to judge, as the quiz panel takes it (issue #3986). */
export type QuizSubject = {
    /** The decision's identity in its feed, named by a copied refusal. */
    id: number;
    /** The state version the decision was taken at, when known. */
    seq?: number;
    /** The game the decision was taken in, when the feed knows it — a
     *  proposal does; the ring falls back to the session's game. */
    gameId?: string;
    /** What to build the quiz from, or `null` when the feed no longer holds
     *  the position (a ring entry pushed without its board). STABLE across
     *  renders: the panel rebuilds whenever it changes. */
    feed: QuizFeed | null;
};

/** The post-game feed: proposal `index` of the game's list. */
export function proposalQuizSubject(
    proposal: VerdictProposal,
    index: number,
    gameId: string
): QuizSubject {
    return {
        id: index + 1,
        seq: proposal.source.state.seq,
        gameId,
        feed: { kind: "proposal", proposal },
    };
}

/**
 * Why the quiz could not be built — the PANEL's vocabulary, which is the
 * lowering's plus the two refusals only a browser can have.
 *
 * The lowering's kinds are inherited, never restated: `VERDICT_REFUSAL_KINDS`
 * is the frozen union `lowerDecision` refuses with and the lowering sweep
 * ranks, and a second copy here is how the two would drift. What is added is
 * the pair of sites ABOVE the lowering — a decision whose position the trace
 * store no longer holds, and a builder chunk that failed to load or threw —
 * which the panel refuses with today in free prose with no kind at all.
 *
 * They are deliberately NOT added to `VERDICT_REFUSAL_KINDS`: the sweep seeds
 * a counter per member and runs headless, where neither site can ever fire, so
 * a browser-only kind there would report a permanent zero as a measurement.
 */
export const QUIZ_ONLY_REFUSAL_KINDS = [
    "position-not-held",
    "builder-threw",
] as const;

export const QUIZ_REFUSAL_KINDS = [
    ...VERDICT_REFUSAL_KINDS,
    ...QUIZ_ONLY_REFUSAL_KINDS,
] as const;

export type QuizRefusalKind = (typeof QUIZ_REFUSAL_KINDS)[number];

/** How one refusal kind presents itself. */
type RefusalPresentation = {
    /** ONE line, recognisable at a glance: three refusals in a row being the
     *  same class is the thing a tester needs to see without reading four
     *  lines of prose each (issue #3457). */
    title: string;
    /** The issue that would REMOVE this refusal, when the cause is one known
     *  spec gap, and `null` when it is not. Static by construction — never a
     *  lookup, and never a guess: `different-decision` and `pick-not-offered`
     *  are caused by whichever fact the lowering lost on THIS board, which is
     *  any of a dozen open gaps, so they name none and let `dropped[]` say it. */
    trackedBy: number | null;
};

/**
 * The ONE table the refusal panel renders from — title and tracking issue per
 * kind, in the order the sites run.
 *
 * `Record<QuizRefusalKind, …>` is the exhaustiveness: a ninth kind added to
 * the array above reds `tsc` here until it says what it is called, which is
 * the whole reason the kind is a frozen union rather than a string.
 */
export const QUIZ_REFUSALS: Record<QuizRefusalKind, RefusalPresentation> = {
    "stack-mid-resolution": {
        // A structural gap, not a vocabulary one: the declared stack holds
        // announced objects, never a half-resolved one, so no widening of the
        // spec reaches this position.
        title: "An object on the stack is partway through resolving",
        // `null` like its unnamed neighbours, and not issue #3456 (closed by
        // the journal): nothing open tracks this, and a tracking ref that
        // names a CLOSED issue sends a tester to a thread that says the work
        // is done.
        trackedBy: null,
    },
    "lowering-threw": {
        title: "This position could not be lowered into a scenario",
        trackedBy: null,
    },
    "stack-not-lowerable": {
        // Not one gap but a family — a trigger, a copy, a mode, a kicker, a
        // payment mid-flight. The detail line names the item and the FIELD
        // that blocked it, so no single tracking issue is honest here (the
        // trigger slice, issue #3516, is one member of the family).
        title: "An object on the stack cannot be declared in a scenario",
        trackedBy: null,
    },
    "combat-not-captured": {
        title: "The combat could not be captured",
        // Not `null` like its neighbours: this one has a single, named cause —
        // a combat fact `ScenarioSpec` still cannot express — rather than
        // "whichever of a dozen gaps this board hit".
        trackedBy: 3458,
    },
    "rebuild-threw": {
        title: "The lowered scenario could not be rebuilt",
        trackedBy: null,
    },
    "stack-rebuild-mismatch": {
        // Every object WAS named and the rebuild still differs — a builder
        // fault, not a vocabulary gap. The detail line carries both
        // fingerprints, targets and `x` included, so the object is named.
        title: "The rebuilt stack is not the stack in play",
        trackedBy: null,
    },
    "no-decision-owed": {
        title: "The rebuilt position owes the Bot no decision",
        trackedBy: null,
    },
    "single-candidate": {
        title: "Only one legal move — a verdict would state no preference",
        trackedBy: null,
    },
    "different-decision": {
        title: "The rebuild offers a DIFFERENT decision",
        trackedBy: null,
    },
    "pick-not-offered": {
        title: "The rebuild does not offer the move the Bot played",
        trackedBy: null,
    },
    "position-not-held": {
        title: "This decision's position is no longer held",
        trackedBy: null,
    },
    "builder-threw": {
        // NOT "failed to load": the panel's `.catch` also swallows every
        // synchronous throw out of `buildVerdictQuiz` — `projectedToGameState`
        // and the live `candidateMoves` both run outside any try/catch — so a
        // real engine throw would read as a chunk-loading problem and send a
        // tester chasing the wrong thing (PR review, issue #3457).
        title: "The quiz could not be built",
        trackedBy: null,
    },
};

/**
 * A refusal, as the panel renders it and as Copy reports it.
 *
 * The TITLE is deliberately not on it. Carried as a `string` field it would be
 * hand-writable — a future refusal site could pass its own, or an empty one,
 * with nothing to red — and the "one table is the only authority" claim above
 * would be a convention rather than a type. Both readers look the title up
 * from {@link QUIZ_REFUSALS} by `kind` instead, which the `Record` already
 * guarantees exists for every kind (PR review, issue #3457).
 */
export type VerdictQuizRefusal = {
    kind: QuizRefusalKind;
    /** The sentence underneath the title: the lowering's own `error`, or the
     *  panel's for a browser-only kind. */
    detail: string;
    /** What the lowering could not carry, one note per line. Empty for the
     *  refusals that fire before `specFromState` ever runs. */
    dropped: string[];
};

/** Build the refusal record for one kind. */
export function quizRefusal(
    kind: QuizRefusalKind,
    detail: string,
    dropped: string[] = []
): VerdictQuizRefusal {
    return { kind, detail, dropped };
}

/**
 * The refusal as plain text, for the Copy button (issue #3457).
 *
 * Carries the decision's own identity — the ring `id` and the state version
 * the search ran on — because a pasted refusal with no `seq` names no board,
 * and the report exists to be pasted into an issue.
 */
export function formatRefusalReport(
    refusal: VerdictQuizRefusal,
    decision: { id: number; seq?: number; proposal?: boolean }
): string {
    const { title, trackedBy } = QUIZ_REFUSALS[refusal.kind];
    const lines = [
        `verdict quiz refusal: ${refusal.kind}`,
        title,
        "",
        refusal.detail,
        "",
        `${decision.proposal ? "proposal" : "decision"} #${decision.id}${
            decision.seq === undefined ? "" : ` at seq ${decision.seq}`
        }`,
    ];
    if (trackedBy !== null) {
        lines.push(`tracked by issue #${trackedBy}`);
    }
    if (refusal.dropped.length > 0) {
        lines.push("", `not captured (${refusal.dropped.length}):`);
        for (const note of refusal.dropped) lines.push(`- ${note}`);
    }
    return lines.join("\n");
}

export type VerdictQuizResult =
    | { ok: true; quiz: VerdictQuiz }
    | { ok: false; refusal: VerdictQuizRefusal };

/**
 * Lower one decision into a quiz, or say why it cannot be one — from either
 * feed (issue #3986).
 *
 * The position is reconstructed from the feed's source by the same
 * `projectedToGameState` the Brain uses, so the board judged here is the board
 * the search ran on — including what the deciding seat was not allowed to know.
 * A trace already carries its pick as `describeMove`'s sentence; a proposal
 * carries `Move`s, described here on that same position.
 */
export function buildVerdictQuiz(feed: QuizFeed): VerdictQuizResult {
    const source = feed.kind === "trace" ? feed.source : feed.proposal.source;
    const position = projectedToGameState(
        source.state,
        source.knowledge,
        source.botId
    );
    const chosen =
        feed.kind === "trace"
            ? feed.trace.chosen
            : describeMove(feed.proposal.brainMove, position);
    const outcome = lowerDecision(position, source.botId, chosen);
    if (!outcome.ok) {
        return {
            ok: false,
            refusal: quizRefusal(outcome.kind, outcome.error, outcome.dropped),
        };
    }
    if (feed.kind === "trace") return { ok: true, quiz: outcome.lowered };

    // The player's own move, carried to the rebuilt list the same way the
    // Bot's is — by lowering it as the pick. An agreeing proposal is the same
    // candidate. A disagreeing one is never collapsed onto the Bot's pick by a
    // colliding sentence: it is lowered on its own, and left unmarked when
    // that lands on the Bot's candidate or the rebuild does not offer it.
    const playerPickIndex = feed.proposal.agrees
        ? outcome.lowered.botPickIndex
        : lowerPlayerPick(
              position,
              source.botId,
              describeMove(feed.proposal.humanMove, position),
              outcome.lowered.botPickIndex
          );
    return {
        ok: true,
        quiz: {
            ...outcome.lowered,
            ...(playerPickIndex === undefined ? {} : { playerPickIndex }),
        },
    };
}

function lowerPlayerPick(
    position: ReturnType<typeof projectedToGameState>,
    seatId: string,
    played: string,
    botPickIndex: number
): number | undefined {
    const outcome = lowerDecision(position, seatId, played);
    return outcome.ok && outcome.lowered.botPickIndex !== botPickIndex
        ? outcome.lowered.botPickIndex
        : undefined;
}
