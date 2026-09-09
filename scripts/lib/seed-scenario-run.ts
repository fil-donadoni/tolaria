// Calling `debugScenarios:seedScenarioDirect` from a script.
//
// Split out of the two CLIs (`seed-scenario.ts`, `seed-scenario-backlog.ts`)
// so the ONE thing that touches the deployment lives in one place — and so
// both CLIs inherit the same two constraints without either having to
// remember them:
//
//  1. IT RUNS IN THE PRIMARY CHECKOUT. `.env.local` carries
//     `CONVEX_DEPLOYMENT`, and a linked worktree does not have it — a seed run
//     from `../tolaria-issue-N` either fails to find a deployment or, worse,
//     picks up a different one. Every caller passes the primary checkout as
//     cwd; nothing here defaults to `process.cwd()`.
//  1b. IT PUSHES THAT CHECKOUT'S CODE FIRST (`--push`, issue #3253). The
//     mutation resolves every `spec.cards[].name` SERVER-SIDE, against the
//     bundle currently deployed (`convex/debugScenarios.ts`,
//     `collectUnresolvedCardNames`). Without `--push` the seed reads whatever
//     `convex dev` last pushed, which makes it depend on a watcher: stopped,
//     or still bundling the fast-forward `land` performed moments earlier, and
//     a scenario naming the PR's own new card resolves to nothing. Measured
//     over the 80 merged PRs before 2026-09-09: 14 carried a loadable spec and
//     10 had never reached the deployment, every one of which seeded fine when
//     re-run by hand. `--push` makes this deterministic — the seed deploys the
//     tree it is standing in. Verified against a live `convex dev`: the push
//     costs ~15s, leaves the dev process alone, and two concurrent pushes both
//     succeed, so contention is the deployment's problem and not ours.
//  2. IT IS UPSERT-BY-LABEL. `selectScenarioUpsert` patches an existing row
//     with the same label rather than inserting a duplicate, which is what
//     makes the backfill re-runnable and makes a `land` that seeds twice
//     harmless.
//
// The row is DEPLOYMENT-LOCAL by design (#770/#1455): it is a debug affordance
// in one developer's Convex instance, not repo state. That is why seeding can
// never be part of the gate proper — it is post-merge housekeeping that must
// not be able to fail a landed PR.

import { spawnSync } from "node:child_process";
import { convexRunErrorMessage } from "./convex-run-error";
import type { ScenarioCandidate } from "./scenario-block";

export interface SeedOutcome {
    ok: boolean;
    /** `insert` / `patch` as reported by the mutation, when it succeeded. */
    action?: string;
    /** Trimmed stderr/stdout when it failed — an unresolved card name is the
     *  common case, and `seedScenarioDirect` puts the offending names in the
     *  message. */
    error?: string;
}

/** The `npx` argv the seed runs — a pure function so the flags are asserted
 *  directly rather than through a subprocess (the convention the rest of the
 *  scripts follow: every DECISION is a pure function, the plumbing around it
 *  is thin and untested).
 *
 *  `--push` is the load-bearing flag (issue #3253) — see constraint 1b above.
 *  The two it comes with are cost control, not behaviour:
 *
 *   - `--typecheck disable` — `land` has already run the lane gate over this
 *     exact tree, and `VERIFY_MERGED_TIP` (`scripts/land.ts`) is what makes
 *     "this exact tree" true: it refuses to continue unless the merged tip is
 *     the one commit `land` just gated, so a squash merge cannot slip a
 *     different tree past the type-check.
 *   - `--codegen disable` — `convex/_generated` is committed and `check:ts`
 *     inside `check:lane` is what keeps it fresh pre-merge. Codegen emits
 *     TypeScript declarations and boilerplate, not the runtime bundle, so
 *     skipping it cannot push stale code; running it would only dirty the
 *     primary checkout the seed is standing in.
 *
 *  The timeout below is enforced on the `npx` child and kills the whole chain:
 *  measured 2026-09-09 with a 3s budget, the call returns at 3.0s with
 *  `ETIMEDOUT`/`SIGTERM` and leaves no `convex` process behind. */
export function seedScenarioArgv(payload: string): string[] {
    return [
        "convex",
        "run",
        "--push",
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        "debugScenarios:seedScenarioDirect",
        payload,
    ];
}

/**
 * Seed one candidate. Never throws — the callers are post-merge housekeeping
 * and a bulk report, and both want a verdict per row rather than an exception
 * that abandons the rest.
 */
export function seedScenario(
    candidate: ScenarioCandidate,
    cwd: string,
    // `--push` bundles and uploads before the mutation runs (~15s warm,
    // more on a cold cache), so the budget is the push plus the call — not
    // the call alone the 120s default was sized for.
    timeoutMs = 180_000
): SeedOutcome {
    const payload = JSON.stringify({
        label: candidate.label,
        spec: candidate.spec,
        ...(candidate.prompt ? { prompt: candidate.prompt } : {}),
    });
    const res = spawnSync("npx", seedScenarioArgv(payload), {
        cwd,
        encoding: "utf8",
        timeout: timeoutMs,
    });
    if (res.error) return { ok: false, error: res.error.message };
    if (res.status !== 0) {
        const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
        return { ok: false, error: convexRunErrorMessage(out) };
    }
    let action: string | undefined;
    try {
        const parsed = JSON.parse((res.stdout ?? "").trim()) as {
            action?: string;
        };
        action = parsed.action;
    } catch {
        // The mutation returns `{ action, id }`; a shape change should not
        // turn a successful write into a reported failure.
    }
    return action ? { ok: true, action } : { ok: true };
}
