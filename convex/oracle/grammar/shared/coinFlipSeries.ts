/**
 * Shared sub-grammar: A BOUNDED COIN-FLIP SERIES AND ITS PAYOFF — "Choose a
 * number. Flip a coin that many times or until you lose a flip, whichever
 * comes first. If you win all the flips, draw two cards for each flip."
 * (CR 705.1–705.2, issue #3813, ADR 0144).
 *
 * Three sentences, one effect. Each is read here as a marker the sentence
 * assembly folds onto the next, the way a library look waits for its routing:
 *
 *   1. "Choose a number"                       → `choose-number` (CR 107.1c)
 *   2. "Flip a coin that many times or until
 *       you lose a flip, whichever comes first" → `coin-flip-series`
 *   3. "If you win all the flips, <draw> for
 *       each flip"                              → `coin-flip-payoff`
 *
 * "That many" has no antecedent without sentence 1, and "the flips" none
 * without sentence 2, so none of the three is an effect alone — assembly
 * refuses any one of them out of that order (`foldCoinFlipSeries`).
 *
 * Fail-closed:
 *  - only the series wording the corpus prints with a payoff this grammar
 *    lowers is read. "Flip a coin until you lose a flip" (Crazed Firecat) and
 *    "Flip X coins" (Rabid Sheep) are the same Op, but their payoffs ("for
 *    each flip you won" on a counter, a named token) are not read yet, and a
 *    series with no payoff is a sentence we would drop;
 *  - the payoff's inner clause must be a draw of a printed number of cards by
 *    "you" — the one form with a fixture. Any other clause is refused with its
 *    own reason rather than scaled by accident;
 *  - Fiery Gambit's "or choose to stop flipping" is a different mechanic (a
 *    decision between flips) and never matches the anchored pattern.
 */

import { fail, ok, type RuleResult } from "../../rule";
import type { EffectSentenceIR, SentenceIR } from "./effectClause";

/** CR 107.1c — the nomination the series counts against. */
const CHOOSE_A_NUMBER = "Choose a number";

/** CR 705.2 — flip up to the chosen number, stopping at the first loss. */
const SERIES_UP_TO_CHOSEN_NUMBER =
    "Flip a coin that many times or until you lose a flip, whichever comes first";

/** "If you win all the flips, <clause> for each flip". */
const ALL_WON_PER_FLIP = /^If you win all the flips, (.+) for each flip$/;

/**
 * One sentence of the family, or `null` when the span is not one (the caller
 * then asks the rest of the sentence grammar). `readClause` reads the payoff's
 * inner clause with the SAME effect grammar a full sentence gets.
 */
export function readCoinFlipSentence(
    span: string,
    readClause: (clause: string) => RuleResult<EffectSentenceIR>
): RuleResult<SentenceIR> | null {
    if (span === CHOOSE_A_NUMBER) return ok({ role: "choose-number" as const });
    if (span === SERIES_UP_TO_CHOSEN_NUMBER)
        return ok({ role: "coin-flip-series" as const });
    const payoff = span.match(ALL_WON_PER_FLIP);
    if (payoff === null) return null;
    const clause = readClause(capitalised(payoff[1]!));
    if (!clause.ok) return clause;
    const effect = clause.value;
    // CR 121.1 — the one payoff with a fixture: "you" draw a printed number of
    // cards, multiplied by the flips made.
    if (
        effect.kind !== "draw" ||
        effect.player.kind !== "you" ||
        effect.count.kind !== "fixed"
    )
        return fail(
            `"… for each flip" scales only a draw of a printed number of cards by you in grammar v0`,
            span
        );
    return ok({
        role: "coin-flip-payoff" as const,
        draw: effect,
        perFlip: effect.count.value,
    });
}

function capitalised(span: string): string {
    return span.charAt(0).toUpperCase() + span.slice(1);
}

/** The three markers, in the order assembly must see them. */
export type CoinFlipMarker = Extract<
    SentenceIR,
    { role: "choose-number" | "coin-flip-series" | "coin-flip-payoff" }
>;

/**
 * Fold the three markers into the one effect they print, or name why the
 * sequence is not that effect. Called with the markers exactly as they
 * appeared, consecutively, in the sentence list.
 */
export function foldCoinFlipSeries(
    markers: readonly CoinFlipMarker[]
): EffectSentenceIR | string {
    const [choose, series, payoff] = markers;
    if (
        markers.length !== 3 ||
        choose?.role !== "choose-number" ||
        series?.role !== "coin-flip-series" ||
        payoff?.role !== "coin-flip-payoff"
    )
        return '"Choose a number.", the coin-flip series and "If you win all the flips, …" must follow one another in that order';
    return {
        kind: "coin-flip-series",
        player: payoff.draw.player,
        perFlip: payoff.perFlip,
    };
}
