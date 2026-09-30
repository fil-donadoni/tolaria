/**
 * Known noise-pinned blade `must` entries (issue #4875) — the robustness
 * audit's shrink-only baseline (`robustness.ts`, `bun run blade:robustness`).
 *
 * An entry listed here passes its own seeds but fails some run of the audit's
 * wide seed list or jittered weight vectors: it is green by rollout order, and
 * the next refit may flip it. Each row names the follow-up issue that owns
 * rewriting or re-budgeting it.
 *
 * SHRINK-ONLY. The audit reds on an entry that is noise-pinned and NOT listed
 * (a new pin — file its issue, or rewrite the entry in the same PR) and on a
 * listed entry that has become robust (delete its row). A label is matched
 * verbatim, so retitling a listed entry is a delete plus an add.
 */

import type { RobustnessBaselineRow } from "./robustness";

export const ROBUSTNESS_BASELINE: readonly RobustnessBaselineRow[] = [
    // First run (issue #4875), wide seeds 0..9 × default / jitter+ / jitter-.
    {
        label: "Sacrifice outlet with a transient payoff: casts the creature",
        issue: 4877,
    },
    {
        label: "Discard sorcery with a sacrifice cost: casts it into a full hand",
        issue: 4877,
    },
    // Back on issue #4878's refit (robust after issue #4880's, jitter− 9/10
    // on this one): the same knife-edge issue #4877 tracks.
    {
        label: "Sacrifice-for-removal outlet: casts the creature",
        issue: 4877,
    },
    // Robust at health GREEN 143e46bb, jitter− 9/10 on the base tip after the
    // refits of issue #4758 and issue #4880; found landing issue #4878.
    {
        label: "storm: Grapeshot is lethal because the search counts the spell cast before it",
        issue: 4893,
    },
];
