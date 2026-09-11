// The ONE authority on how an `EvalTerms` key is presented in the debug UI.
//
// WHY THIS FILE EXISTS. `EvalTerms` is the per-term decomposition of the Bot's
// leaf evaluation, rendered twice: as a dense letter line per candidate in the
// AI decision trace, and spelled out in that panel's legend. Both used to keep
// their OWN hand-maintained list of terms, so adding a term to `EvalTerms`
// type-checked while the trace silently dropped it — the self/opp line no
// longer summed to the Δ shown beside it, and the term was invisible to the
// person debugging exactly the decision it had just changed. That happened:
// `manaDevelopment` (issue #2686) shipped and neither list learned about it.
//
// The table below is a `Record<keyof EvalTerms, …>`, so a new term now fails
// `tsc` until it is named here — the guard is the type, not a convention.
// Declaration order IS render order (string keys preserve insertion order).
//
// Since issue #3404 the same row also carries the term's PLAIN-LANGUAGE
// reading — the phrase a tester sees ("loses a creature") and the floor below
// which a difference is not worth a sentence. Deliberately the same table and
// not a fourth one: the failure this file exists to prevent is a term that
// exists in one display and not another, and a separate phrase table would be
// exactly that failure with one more place to forget.

import type { EvalTerms } from "@convex/gre";
import { DEFAULT_EVAL_WEIGHTS as W } from "@convex/gre/ai/evalWeights";

export type EvalTermLabel = {
    /** Terse glyph for the per-candidate trace line (e.g. `L128`). Unique. */
    short: string;
    /** Spelled-out name for the legend and the hover tooltip. */
    name: string;
    /** Noise floor, in this term's own points: a difference smaller than this
     *  earns no sentence in the plain-language comparison (issue #3404).
     *
     *  Every floor is DERIVED from the weight vector rather than typed as a
     *  literal, because the weights are fitted and refitted (ADR 0124 §3,
     *  issue #3401): a hand-set floor would silently stop meaning "one card" /
     *  "one point of life" the first time a fit moved the term under it. Each
     *  row says which unit of the position its floor is half (or all) of. */
    floor: number;
    /** What a difference ABOVE `+floor` reads as, in words, said of the player
     *  the terms belong to — "gains a creature", "keeps a card". Rendered for
     *  the bot's own side as-is, and prefixed with "opponent" for the other
     *  side, so one table covers both. */
    gain: string;
    /** What a difference BELOW `-floor` reads as. */
    loss: string;
};

/** Every `EvalTerms` key, in render order. Exhaustive BY TYPE: adding a term to
 *  `EvalTerms` without a row here is a compile error, which is the whole point
 *  — see the header. */
export const EVAL_TERM_LABELS: Record<keyof EvalTerms, EvalTermLabel> = {
    life: {
        short: "L",
        name: "Life",
        // One point of life.
        floor: W.lifeWeight,
        gain: "gains life",
        loss: "takes damage",
    },
    hand: {
        short: "H",
        name: "Hand (cards in hand)",
        // Half an average card, so a spare land still clears it.
        floor: W.latent.cardAdvantage / 2,
        gain: "keeps a card",
        loss: "spends a card",
    },
    creatures: {
        short: "C",
        name: "Creatures",
        // A quarter of the representative removal victim the latent weights
        // are calibrated on (a 2/2) — i.e. roughly a 1/1 body, the smallest
        // creature whose loss is worth a sentence.
        floor: W.latent.boardRemoval / 4,
        gain: "gains a creature",
        loss: "loses a creature",
    },
    permanents: {
        short: "Pm",
        name: "Permanents (non-creature)",
        // One permanent's flat board presence.
        floor: W.permanentWeight,
        gain: "gains a permanent",
        loss: "loses a permanent",
    },
    mana: {
        short: "M",
        name: "Mana (available)",
        // Half a mana source.
        floor: W.manaWeight / 2,
        gain: "gains a mana source",
        loss: "loses a mana source",
    },
    manaDevelopment: {
        short: "Md",
        name: "Mana development (lands the hand's curve still wants)",
        // Half a land the hand's curve was still asking for.
        floor: W.manaDevWeight / 2,
        gain: "develops its mana",
        loss: "falls behind on mana",
    },
    flexibility: {
        short: "Fx",
        name: "Flexibility (options / reach)",
        // Half a held instant / activated option.
        floor: W.flexWeight / 2,
        gain: "keeps an answer up",
        loss: "gives up an answer",
    },
    library: {
        short: "Lb",
        name: "Library (cards left before decking)",
        // One card of the decking horizon.
        floor: W.deckingWeight,
        gain: "has more cards left to draw",
        loss: "runs closer to decking",
    },
    graveyard: {
        short: "Gy",
        name: "Graveyard (spells a play-from-graveyard engine can still cast)",
        // Half a castable card in the graveyard.
        floor: W.graveyardEngineWeight / 2,
        gain: "gains a castable card in the graveyard",
        loss: "loses a castable card in the graveyard",
    },
    graveyardReach: {
        short: "Gr",
        name: "Graveyard reach (cards there this player can recur or use)",
        // Half a reachable card, priced at the same fraction of an average
        // card the term itself returns.
        floor: (W.latent.cardAdvantage * W.graveyardReachFraction) / 2,
        gain: "gains a card it can bring back",
        loss: "loses a card it can bring back",
    },
};

/** The keys of `EVAL_TERM_LABELS` in declaration order — what both consumers
 *  iterate, so the trace line and the legend can never drift apart. */
export const EVAL_TERM_ORDER = Object.keys(
    EVAL_TERM_LABELS
) as (keyof EvalTerms)[];
