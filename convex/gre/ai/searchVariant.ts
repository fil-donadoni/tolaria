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
 *  A ladder run with NO variant is the control-vs-control null experiment:
 *  its aggregate CI must straddle 50%, which measures the harness noise floor. */
export const LADDER_VARIANTS: Record<string, SearchVariant> = {
    // issue #1929 — margin → win-prob logistic fitted on the ladder corpus,
    // replacing the hand-set linear clip in the open reward band.
    "reward-calibrated": {
        name: "reward-calibrated",
        rewardMapping: "calibrated",
    },
};
