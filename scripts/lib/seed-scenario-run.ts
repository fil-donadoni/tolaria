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

/**
 * Seed one candidate. Never throws — the callers are post-merge housekeeping
 * and a bulk report, and both want a verdict per row rather than an exception
 * that abandons the rest.
 */
export function seedScenario(
    candidate: ScenarioCandidate,
    cwd: string,
    timeoutMs = 120_000
): SeedOutcome {
    const payload = JSON.stringify({
        label: candidate.label,
        spec: candidate.spec,
        ...(candidate.prompt ? { prompt: candidate.prompt } : {}),
    });
    const res = spawnSync(
        "npx",
        ["convex", "run", "debugScenarios:seedScenarioDirect", payload],
        { cwd, encoding: "utf8", timeout: timeoutMs }
    );
    if (res.error) return { ok: false, error: res.error.message };
    if (res.status !== 0) {
        const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
        return { ok: false, error: firstUsefulLine(out) };
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

/** Convex prints a stack around the thrown message; the first line naming the
 *  actual error is what a reader needs. */
function firstUsefulLine(text: string): string {
    const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    const named = lines.find(
        (l) => l.includes("Unknown card name") || l.includes("Error:")
    );
    return (named ?? lines[lines.length - 1] ?? "unknown failure").slice(
        0,
        300
    );
}
