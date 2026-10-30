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
import type {
    CoinFlipBranchIR,
    EffectSentenceIR,
    SentenceIR,
} from "./effectClause";

/** CR 107.1c — the nomination the series counts against. */
const CHOOSE_A_NUMBER = "Choose a number";

/** CR 705.2 — flip up to the chosen number, stopping at the first loss. */
const SERIES_UP_TO_CHOSEN_NUMBER =
    "Flip a coin that many times or until you lose a flip, whichever comes first";

/** CR 705.1 — the flip a win/lose outcome sentence reads. */
const FLIP_A_COIN = "Flip a coin";

/** CR 705.2 — flip until the first lost flip; the payoff counts the wins. */
const SERIES_UNTIL_LOSS = "Flip a coin until you lose a flip";

/** "If you win the flip, <clause>" / "If you lose the flip, <clause>". */
const FLIP_OUTCOME = /^If you (win|lose) the flip, (.+)$/;

/** "<clause> for each flip you won" — the payoff of an until-loss series. */
const PER_FLIP_WON = /^(.+) for each flip you won$/;

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
    if (span === FLIP_A_COIN) return ok({ role: "coin-flip" as const });
    if (span === SERIES_UNTIL_LOSS)
        return ok({ role: "coin-flip-until-loss" as const });
    const outcome = span.match(FLIP_OUTCOME);
    if (outcome !== null) {
        const inner = readClause(capitalised(outcome[2]!));
        if (!inner.ok) return inner;
        return ok({
            role: "coin-flip-outcome" as const,
            outcome:
                outcome[1] === "win" ? ("win" as const) : ("loss" as const),
            text: outcome[2]!,
            effect: inner.value,
        });
    }
    const won = span.match(PER_FLIP_WON);
    if (won !== null) {
        const inner = readClause(capitalised(won[1]!));
        if (!inner.ok) return inner;
        // CR 122.1 — the one payoff with a fixture: counters put on a
        // permanent, one printed batch per flip won.
        if (
            inner.value.kind !== "counters" ||
            inner.value.count.kind !== "fixed"
        )
            return fail(
                `"… for each flip you won" scales only counters of a printed number in grammar v0`,
                span
            );
        return ok({
            role: "coin-flip-won-payoff" as const,
            counters: inner.value,
        });
    }
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
    {
        role:
            | "choose-number"
            | "coin-flip-series"
            | "coin-flip-payoff"
            | "coin-flip"
            | "coin-flip-outcome"
            | "coin-flip-until-loss"
            | "coin-flip-won-payoff";
    }
>;

/**
 * Fold the three markers into the one effect they print, or name why the
 * sequence is not that effect. Called with the markers exactly as they
 * appeared, consecutively, in the sentence list.
 */
export function foldCoinFlipSeries(
    markers: readonly CoinFlipMarker[]
): EffectSentenceIR | string {
    const head = markers[0];
    if (head?.role === "coin-flip") return foldCoinFlip(markers);
    if (head?.role === "coin-flip-until-loss") {
        const wonPayoff = markers[1];
        if (markers.length !== 2 || wonPayoff?.role !== "coin-flip-won-payoff")
            return '"Flip a coin until you lose a flip." must be followed by its payoff "… for each flip you won"';
        return {
            kind: "coin-flip-until-loss",
            counters: wonPayoff.counters,
        };
    }
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

/**
 * CR 705.1 — "Flip a coin. If you win the flip, <A>. If you lose the flip,
 * <B>.": the flip and one or two outcome sentences, each outcome at most once.
 * A flip with no outcome is a sentence we would drop, so it is refused.
 */
function foldCoinFlip(
    markers: readonly CoinFlipMarker[]
): EffectSentenceIR | string {
    let win: CoinFlipBranchIR | undefined;
    let loss: CoinFlipBranchIR | undefined;
    for (const marker of markers.slice(1)) {
        if (marker.role !== "coin-flip-outcome")
            return '"Flip a coin." may be followed only by its "If you win/lose the flip, …" outcomes';
        const branch = { clause: marker.text, effect: marker.effect };
        if (marker.outcome === "win" && win === undefined) win = branch;
        else if (marker.outcome === "loss" && loss === undefined) loss = branch;
        else return "a coin flip names each outcome at most once";
    }
    if (win === undefined && loss === undefined)
        return '"Flip a coin." with no "If you win/lose the flip, …" outcome does nothing';
    return {
        kind: "coin-flip",
        ...(win !== undefined ? { win } : {}),
        ...(loss !== undefined ? { loss } : {}),
    };
}
