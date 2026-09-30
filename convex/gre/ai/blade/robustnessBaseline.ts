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
    // Issue #4758's refit (the ETB Ability accounting) took it from 20/20 to
    // 18/20 on seeds 0..19 — decided by `material-tiebreak` throughout.
    {
        label: "discriminating pair: casts Phyrexian Dreadnought WITH an out (Stifle)",
        issue: 4882,
    },
];
