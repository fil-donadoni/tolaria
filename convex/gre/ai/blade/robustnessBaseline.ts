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
    // Noise-pinned behind a search defect: the tree walk and the rollout
    // stop at the opponent's mandatory discard (issue #4917), so the cast
    // line is scored mid-resolution, before Tendrils' discard is made, and
    // its rollouts never reach the opponent's turn. Issue #4877 moved the
    // sibling sacrifice entries to the postcombat main; this one waits on
    // the stall fix, which owns the entry.
    {
        label: "Discard sorcery with a sacrifice cost: casts it into a full hand",
        issue: 4917,
    },
    // Robust at health GREEN 143e46bb, jitter− 9/10 on the base tip after the
    // refits of issue #4758 and issue #4880; found landing issue #4878.
    {
        label: "storm: Grapeshot is lethal because the search counts the spell cast before it",
        issue: 4893,
    },
];
