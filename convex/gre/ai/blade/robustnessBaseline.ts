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
 * `scripts/lib/health-robustness-drift.ts`) by an audit that runs AFTER the
 * health verdict (issue #5079); only an entry failing its own seeds is a
 * `wrong`, and `test:blade` reds the tip for that. The baseline's SHAPE (names
 * a `must` entry, once, with an issue) is gated in `test:bot`
 * (`robustness.bot.test.ts`).
 *
 * `land` refuses a PR that closes a row's owning issue while the row is still
 * here (issue #4980): delete it, or re-point it to its next owner.
 */

import type { RobustnessBaselineRow } from "./robustness";

// The first FULL PR-side audit to finish (issue #10319, PR #10333) found
// three, pre-existing: no full audit had completed since 2026-10-11.
// "self-harm: Fatal Push …" flips with the tree: robust on the revert of
// PR #10340 (row deleted there), pinned again on the next base tip (row
// restored) — issue #10337 owns it.
export const ROBUSTNESS_BASELINE: readonly RobustnessBaselineRow[] = [
    {
        label: "Self-growing sacrifice outlet: casts the creature",
        issue: 10336,
    },
    {
        label: "self-harm: Fatal Push still destroys the opponent's mana value 4 creature beside the Bot's own",
        issue: 10337,
    },
];
