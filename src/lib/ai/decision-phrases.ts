// The AI decision box, in words (issue #3404, PRD #3397).
//
// WHY THIS FILE EXISTS. The DecisionTrace box answers "what did the bot weigh"
// in the vocabulary of the search: `v412 r0.53 a900 Δ-118 self L128 C473 …`.
// That is the right artifact for someone who already knows the engine, and it
// is unreadable for the person the box was opened for — a TESTER, who can say
// whether a play was right but cannot say what `Md` is. Without a reading in
// words, "the bot blundered" arrives as an anecdote (`/bot-slice` phase 0),
// and an anecdote cannot become a Verdict.
//
// Two tables, both exhaustive BY TYPE so a new member is a build error rather
// than a blank line:
//
//   - `MECHANISM_SENTENCES` — one sentence per `RootDecisionMechanism`, the
//     same union `decisionTelemetry.ts` freezes behind `ROOT_RULE_ALLOWLIST`.
//     `ROOT_RULE_ALLOWLIST.why` already explains each rule, but in the
//     vocabulary of the engine ("outcome-equal contenders", "the OUTCOME_EPS
//     window"); this says the same thing to someone reading their own game.
//   - the per-term phrases, which live one file over in `eval-term-labels.ts`
//     with the rest of each term's presentation — see that file's header.
//
// Pure and client-only: nothing here reaches a Move, a mutation or the search
// (ADR 0074). It reads a `PositionBreakdown` the search already built.

import type { EvalTerms, PositionBreakdown } from "@convex/gre";
import type { RootDecisionMechanism } from "@convex/gre/ai/decisionTelemetry";
import { EVAL_TERM_LABELS, EVAL_TERM_ORDER } from "./eval-term-labels";

/** One plain sentence per root mechanism, addressed to a tester watching their
 *  own game — no engine vocabulary, no numbers, present tense.
 *
 *  `Record<RootDecisionMechanism, string>`, so a new mechanism does not compile
 *  until it has a sentence. That is the `eval-term-labels` discipline applied
 *  to the other half of the box: issue #2686 shipped an `EvalTerms` key that
 *  rendered nowhere, and a mechanism with no sentence would render as an
 *  explanation-shaped blank, which is worse than no box at all. */
export const MECHANISM_SENTENCES: Record<RootDecisionMechanism, string> = {
    "mean-reward":
        "The search preferred it — it won more of the games it played out.",
    "material-tiebreak":
        "The games came out level, so it kept the better board.",
    "extra-turn-credit":
        "It takes an extra turn, which is worth more than the short look-ahead can show.",
    "wasteful-attack":
        "The attack would have been absorbed for nothing, so it stayed back.",
    "block-quality":
        "Several blocks looked equally good, so it took the one that loses the least.",
    "announcement-variant":
        "Same spell, different targets or modes — it took the version with the better result.",
    "self-harm-removal":
        "Casting it would have hurt its own side of the board, so it held the card.",
    "free-development":
        "A land or mana source costs it nothing to play, so it played it.",
    "hold-trick":
        "It held an instant back for the opponent's turn instead of spending it now.",
    "colour-mode-evidence":
        "Nothing of any colour was in play yet, so it named the colour the rest of the game points at.",
    "wasted-mana-hold":
        "The mana would have emptied unused, so it kept the card instead.",
    "last-window-fire":
        "This was the last chance to use it, so it used it.",
    "standing-spend-hold":
        "Spending it now would leave the position no better, so it kept the permanent.",
    "resolved-payoff":
        "Once it resolves, its own side of the board is better off — so it cast it.",
};

/** Whether the pick came from the SEARCH itself rather than from a named
 *  tie-break that overrode it. The two structural mechanisms, and only them —
 *  kept as a predicate over the allowlist's own `kind` would be, but without
 *  importing the allowlist into the client bundle for two names. */
export function isSearchMechanism(m: RootDecisionMechanism): boolean {
    return m === "mean-reward" || m === "material-tiebreak";
}

/** At most this many phrases per alternative. Three is what fits one line at
 *  phone width, and beyond three the reading stops being a sentence and starts
 *  being the numeric table the disclosure already holds. */
export const MAX_COMPARISON_PHRASES = 3;

/** What a comparison says when no term moved past its floor. Not an absence of
 *  information: two candidates the evaluator cannot tell apart is the exact
 *  signature `/bot-slice` phase 0 calls the "tie variant", where the pick falls
 *  to a tie-break (or to rollout noise) rather than to the evaluation. */
export const NO_DIFFERENCE_PHRASE = "much the same position";

/** One term's difference between two positions, on one player's side. */
type TermDelta = {
    key: keyof EvalTerms;
    /** `alternative − chosen`, in the term's own points. */
    delta: number;
    /** Whose terms moved — the bot's own side or the opponent's. */
    side: "self" | "opp";
};

/** The phrase for one delta, from the term's row. `opp` deltas reuse the same
 *  two phrases with an "opponent" subject, so a term is described in ONE place
 *  no matter which side of the board moved. */
function phraseFor({ key, delta, side }: TermDelta): string {
    const label = EVAL_TERM_LABELS[key];
    const phrase = delta > 0 ? label.gain : label.loss;
    return side === "opp" ? `opponent ${phrase}` : phrase;
}

/** Every term difference that clears its own floor, largest first.
 *
 *  Magnitudes are compared in units of the term's floor rather than in raw
 *  points, because the terms are on wildly different scales (a creature is
 *  worth ~25 points of life): ranking by raw points would put "gains life"
 *  above "loses a creature" only because life is measured in small numbers.
 *  Exported for the test — and because "which terms actually separated these
 *  two candidates" is the question, with the wording as its presentation. */
export function significantDeltas(
    chosen: PositionBreakdown,
    alternative: PositionBreakdown
): TermDelta[] {
    const out: TermDelta[] = [];
    for (const side of ["self", "opp"] as const) {
        for (const key of EVAL_TERM_ORDER) {
            const delta = alternative[side][key] - chosen[side][key];
            if (Math.abs(delta) >= EVAL_TERM_LABELS[key].floor) {
                out.push({ key, delta, side });
            }
        }
    }
    return out.sort(
        (a, b) =>
            Math.abs(b.delta) / EVAL_TERM_LABELS[b.key].floor -
            Math.abs(a.delta) / EVAL_TERM_LABELS[a.key].floor
    );
}

/** How `alternative` would have differed from the move the bot actually chose,
 *  in words. Always non-empty: with nothing above its floor it returns the
 *  single `NO_DIFFERENCE_PHRASE`, which is itself the diagnosis. */
export function comparePositions(
    chosen: PositionBreakdown,
    alternative: PositionBreakdown,
    limit: number = MAX_COMPARISON_PHRASES
): string[] {
    const phrases = significantDeltas(chosen, alternative)
        .slice(0, limit)
        .map(phraseFor);
    return phrases.length > 0 ? phrases : [NO_DIFFERENCE_PHRASE];
}
