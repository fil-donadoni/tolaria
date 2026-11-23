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
// three, pre-existing: no full audit had completed since 2026-10-11. All
// three are retired (issues #10335, #10336, #10337). PR #10392's full audit
// (base 258d11289) found two more, pre-existing; both are retired (issues
// #10449, #10448). Blood Moon re-pinned after its refit (PR #10637): the
// full audits of PR #10659 and PR #10660 (2026-11-23) both read jitter+ 9/10
// on the same base — issue #10449 owns it again.
export const ROBUSTNESS_BASELINE: readonly RobustnessBaselineRow[] = [
    {
        label: "nonbasic hate: Blood Moon is cast against the opponent's nonbasic mana",
        issue: 10449,
    },
    // Passes only at its declared 400 iterations: whenever both root edges
    // sit in the visit band, the material tie-break takes the futile cast.
    {
        label: "phyrexian mana: Dismember never aims at toughness above 5",
        issue: 10665,
    },
];
