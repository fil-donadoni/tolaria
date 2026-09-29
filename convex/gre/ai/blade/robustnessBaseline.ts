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

export const ROBUSTNESS_BASELINE: readonly RobustnessBaselineRow[] = [];
