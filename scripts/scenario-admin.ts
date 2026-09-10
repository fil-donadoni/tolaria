#!/usr/bin/env bun
// `bun run scenario:ls` / `bun run scenario:rm "<label>"` — the CLI half of
// the debug-scenario table (issue #3331).
//
// WHY THIS EXISTS. `bunx convex run` authenticates with the DEPLOY KEY, not as
// a user, so `auth.getUserId(ctx)` is null and every `assertIsAdmin` function
// throws `Forbidden: admin only` no matter who is signed into the app. The
// seed path had an ungated `internalMutation` door for exactly that reason
// (`debugScenarios:seedScenarioDirect`); list and delete did not, so an agent
// could create a scenario from the CLI and then had no way to see it or remove
// it. `listScenariosDirect` / `deleteScenariosDirect` are the matching doors;
// this file is the ergonomics, so nobody hand-types the flags again.
//
// TWO CONSTRAINTS INHERITED FROM THE SEED, not re-derived here:
//
//  1. IT RUNS IN THE PRIMARY CHECKOUT, but NOT for the seed's stated reason.
//     `seed-scenario-run.ts` says a linked worktree has no `.env.local`; that
//     is stale — `bootstrap-worktree.ts` copies it, so a worktree resolves the
//     same `CONVEX_DEPLOYMENT`. The reason here is constraint 2: `--push`
//     deploys the tree it stands in, and the dev deployment is SHARED across
//     every session on this machine. Pushing an unmerged worktree from a
//     cleanup command would put unreviewed functions in front of whoever else
//     is using it. `primaryCheckout()` pushes the merged tree instead — which
//     also means a function added in a worktree is only reachable here once it
//     has landed.
//  2. IT PUSHES FIRST (`--push`, via `convexRunArgv`). For the seed that is
//     about server-side card-name resolution (issue #3253); here it is about
//     the FUNCTION existing at all — `listScenariosDirect` is not on the
//     deployment until something pushes it, and depending on a `convex dev`
//     watcher to have done so is the exact failure mode #3253 measured. The
//     push costs ~15s; a "function not found" on a fresh clone costs more.
//
// DELETE IS BY LABEL. `seedScenarioDirect` upserts by label, so the label is
// the handle a CLI caller already holds; an id is a value it can only obtain
// from a seed it performed in that same session.

import { spawnSync } from "node:child_process";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { convexRunArgv } from "./lib/seed-scenario-run";
import { primaryCheckout } from "./lib/primary-checkout";

/** One scenario as `listScenariosDirect` returns it. */
export interface ScenarioRow {
    label: string;
    golden: boolean;
    createdAt?: number;
}

/** The line `scenario:ls` prints for one row — pure, so the formatting is
 *  asserted directly rather than through a subprocess. `★` marks a golden
 *  scenario, the same glyph the admin panel uses for the flag. */
export function formatScenarioRow(row: ScenarioRow): string {
    return `${row.golden ? "★" : " "} ${row.label}`;
}

/** The verdict line `scenario:rm` prints. Pure for the same reason: a `0` is
 *  the interesting outcome (a typo'd label removed nothing) and it must not
 *  read as success. */
export function formatDeleteOutcome(label: string, deleted: number): string {
    if (deleted === 0) {
        return `scenario:rm: no scenario labelled "${label}" — nothing deleted`;
    }
    return `scenario:rm: deleted ${deleted} scenario(s) labelled "${label}"`;
}

/** Run one of the two internal functions and return its parsed JSON result.
 *  Throws with the deployment's own message on failure — both callers are
 *  interactive and want the reason, not a bare exit code. */
function runDirect(fn: string, payload: object): unknown {
    const res = spawnSync("npx", convexRunArgv(fn, JSON.stringify(payload)), {
        cwd: primaryCheckout(),
        encoding: "utf8",
        // The push dominates: ~15s warm, more on a cold bundle cache. Same
        // budget the seed uses.
        timeout: 180_000,
    });
    if (res.error) throw new Error(res.error.message);
    if (res.status !== 0) {
        const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
        throw new Error(convexRunErrorMessage(out));
    }
    // `convex run` prints the return value as JSON on stdout, preceded by the
    // push's own progress lines on stderr.
    const out = (res.stdout ?? "").trim();
    if (out === "") return null;
    return JSON.parse(out) as unknown;
}

function main(): void {
    const [command, ...rest] = process.argv.slice(2);

    if (command === "ls") {
        const rows = (runDirect("debugScenarios:listScenariosDirect", {}) ??
            []) as ScenarioRow[];
        if (rows.length === 0) {
            console.log("scenario:ls: no scenarios on this deployment");
            return;
        }
        for (const row of rows) console.log(formatScenarioRow(row));
        console.log(`\n${rows.length} scenario(s)`);
        return;
    }

    if (command === "rm") {
        const label = rest.join(" ").trim();
        if (label === "") {
            console.error('usage: bun run scenario:rm "<label>"');
            process.exit(1);
        }
        const result = runDirect("debugScenarios:deleteScenariosDirect", {
            label,
        }) as { deleted: number } | null;
        const deleted = result?.deleted ?? 0;
        console.log(formatDeleteOutcome(label, deleted));
        // A no-match is a failed intent, not housekeeping noise: exit non-zero
        // so a script that chains on it stops.
        if (deleted === 0) process.exit(1);
        return;
    }

    console.error('usage: bun run scenario:ls | bun run scenario:rm "<label>"');
    process.exit(1);
}

if (import.meta.main) main();
