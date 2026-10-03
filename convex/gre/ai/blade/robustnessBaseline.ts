/**
 * Known noise-pinned blade `must` entries (issue #4875) — the robustness
 * audit's shrink-only baseline (`robustness.ts`, `bun run blade:robustness`).
 *
 * An entry listed here passes its own seeds but fails some run of the audit's
 * wide seed list or jittered weight vectors: it is green by rollout order, and
 * the next refit may flip it. Each row names the follow-up issue that owns
 * rewriting or re-budgeting it.
 *
 * SHRINK-ONLY. The audit fails on an entry that is noise-pinned and NOT listed
 * (a new pin — rewrite the entry, or add its row) and on a listed entry that
 * has become robust (delete its row). A label is matched verbatim, so
 * retitling a listed entry is a delete plus an add. In `health` either is
 * DRIFT, filed as an issue with the tip left green (issue #5016,
 * `scripts/lib/health-robustness-drift.ts`) — only an entry failing its own
 * seeds reds the tip.
 *
 * `land` refuses a PR that closes a row's owning issue while the row is still
 * here (issue #4980): delete it, or re-point it to its next owner.
 */

import type { RobustnessBaselineRow } from "./robustness";

export const ROBUSTNESS_BASELINE: readonly RobustnessBaselineRow[] = [
    // Robust at the health runs of 2026-09-30, pinned by a Bot landing since
    // (not bisected); found by the health RED that issue #4980 repairs, on
    // tip f61bfddc: jitter− 9/10. Still pinned at issue #4882's refit:
    // default 9/10, `material-tiebreak` on most seeds.
    {
        label: "opponent's choice: casts Ravenous Rats into a two-card hand",
        issue: 4981,
    },
];
