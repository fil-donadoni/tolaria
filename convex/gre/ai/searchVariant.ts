// Search variant seam (issue #1924, map #1892 → decision #1895).
//
// The bot-vs-bot ladder compares two CONFIGURATION VARIANTS of the same engine
// in one process: `control` (production defaults, variant = null) vs
// `candidate` (one config override of difference). This module is that seam —
// a module-level "active variant" the ladder installs around each search call
// (the same install/uninstall pattern as `decisionTelemetry`'s sink), so the
// engine's signatures stay untouched and live play never pays for it.
//
// Determinism: a variant only swaps CONSTANTS consulted inside a synchronous
// `search()` call. Installing it around the call (set → search → clear in a
// `finally`) keeps the whole search — tree, rollouts, tie-breaks — under one
// consistent config, and bit-reproducibility (fixed iterations + seed) holds
// per variant.
//
// Growing the seam: a strength experiment lands as a new optional knob here
// plus one consultation at its use site in the engine, then registers a named
// entry in `LADDER_VARIANTS` so `bun run ladder --variant <name>` can A/B it.
// The knob stays until the ladder verdict lands the change as the new default
// (flag removed) or kills it.

export type SearchVariant = {
    /** Registry name — recorded in ladder JSONL headers and reports. */
    name: string;
    /** Override for the UCB1 exploration constant (`UCB_C` in search.ts). */
    ucbC?: number;
    /** XOR mask applied to the per-decision search seed, for the candidate
     *  seat only (issue #1929). Changes WHICH determinizations ISMCTS samples
     *  and nothing else — same policy, same budget, same rules — so it is
     *  strength-neutral in expectation by construction. Consumed by the ladder
     *  runner (`playLadderGame`), never by search.ts: it perturbs the seed
     *  handed IN, not how the search behaves. */
    searchSeedMask?: number;
    /** Open-band reward mapping (issue #1929): "calibrated" swaps the linear
     *  clip (`materialSignal`) for the fitted logistic margin → win-prob
     *  (`CALIBRATED_REWARD_K` in search.ts). Absent = production linear clip. */
    rewardMapping?: "calibrated";
};

let activeVariant: SearchVariant | null = null;

/** Install (or clear, with null) the active variant. Ladder-only; live play
 *  never calls this, so production always runs with every knob at default. */
export function setSearchVariant(v: SearchVariant | null): void {
    activeVariant = v;
}

export function getSearchVariant(): SearchVariant | null {
    return activeVariant;
}

/** The named candidate configs `bun run ladder --variant <name>` can run.
 *
 *  A ladder run with NO variant is the control-vs-control null experiment. It
 *  necessarily returns EXACTLY 50%, and that is not a measurement: with no
 *  variant installed both seats run the identical config, so a pair's two
 *  orientations play the bit-identical game and only the candidate LABEL
 *  moves — one win and one loss per pair, by arithmetic. The 680-game run of
 *  2026-08-23 came back 20–20 in all 17 matchups, all 340 pairs agreeing on
 *  winner, turns and plies.
 *
 *  So a null run proves determinism (including across worker processes) and
 *  the absence of seat-attribution bias — worth having — but it does NOT
 *  measure the harness noise floor, as this comment used to claim. Nothing in
 *  it varies, so nothing about the variance of a REAL candidate leg follows
 *  from it.
 *
 *  The noise floor is what `placebo` below measures. Judge a candidate's win
 *  rate against THAT, never against a null run's tautological 50%. */
export const LADDER_VARIANTS: Record<string, SearchVariant> = {
    /** The noise-floor baseline (issue #1929). Same policy, same budget, same
     *  rules — only WHICH determinizations ISMCTS samples differs, so it is
     *  strength-neutral by construction and every point it scores away from
     *  50% is chaotic sensitivity: a different sampled world changes one
     *  move, which changes the position, which cascades.
     *
     *  Run it once at decision tier; its confidence interval is the band
     *  inside which a real candidate's result means nothing. Without it there
     *  is no baseline at all — a null run cannot vary (see above), so an
     *  IMPROVEMENT verdict would be unfalsifiable.
     *
     *  Why the seed and not a tiny `ucbC` nudge, which is the obvious idea:
     *  measured 2026-08-24 over 4 games, `ucbC * (1 + eps)` at eps = 1e-12,
     *  1e-9 and 1e-6 changed NOTHING — not a ply, not a winner (UCB scores
     *  are not separated that finely, so the argmax never moves). And a nudge
     *  big enough to bite would no longer be neutral: `ucbC` is a real knob
     *  that can help or hurt. The seed has no strategic content at all, which
     *  is exactly what a placebo needs. */
    placebo: {
        name: "placebo",
        // Arbitrary fixed mask — any value works; pinned so the run is
        // reproducible from its baseSeed like every other ladder run.
        searchSeedMask: 0x5bf03635,
    },

    // issue #1929 — margin → win-prob logistic fitted on the ladder corpus,
    // replacing the hand-set linear clip in the open reward band.
    "reward-calibrated": {
        name: "reward-calibrated",
        rewardMapping: "calibrated",
    },
};
