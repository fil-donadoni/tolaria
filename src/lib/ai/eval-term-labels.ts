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

import type { EvalTerms } from "@convex/gre";

export type EvalTermLabel = {
    /** Terse glyph for the per-candidate trace line (e.g. `L128`). Unique. */
    short: string;
    /** Spelled-out name for the legend and the hover tooltip. */
    name: string;
};

/** Every `EvalTerms` key, in render order. Exhaustive BY TYPE: adding a term to
 *  `EvalTerms` without a row here is a compile error, which is the whole point
 *  — see the header. */
export const EVAL_TERM_LABELS: Record<keyof EvalTerms, EvalTermLabel> = {
    life: { short: "L", name: "Life" },
    hand: { short: "H", name: "Hand (cards in hand)" },
    creatures: { short: "C", name: "Creatures" },
    permanents: { short: "Pm", name: "Permanents (non-creature)" },
    mana: { short: "M", name: "Mana (available)" },
    manaDevelopment: {
        short: "Md",
        name: "Mana development (lands the hand's curve still wants)",
    },
    flexibility: { short: "Fx", name: "Flexibility (options / reach)" },
    library: { short: "Lb", name: "Library (cards left before decking)" },
    graveyard: {
        short: "Gy",
        name: "Graveyard (spells a play-from-graveyard engine can still cast)",
    },
    graveyardReach: {
        short: "Gr",
        name: "Graveyard reach (cards there this player can recur or use)",
    },
};

/** The keys of `EVAL_TERM_LABELS` in declaration order — what both consumers
 *  iterate, so the trace line and the legend can never drift apart. */
export const EVAL_TERM_ORDER = Object.keys(
    EVAL_TERM_LABELS
) as (keyof EvalTerms)[];
