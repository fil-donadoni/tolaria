#!/usr/bin/env bun
// `bun run scenario:ls` / `bun run scenario:rm "<label>"` — acting on the
// debug-scenario table from the command line (issue #3331, reshaped by #3333).
//
// HOW IT REACHES AN ADMIN-GATED FUNCTION. A plain `bunx convex run` carries no
// caller identity, so `auth.getUserId(ctx)` is null and `assertIsAdmin` throws
// `Forbidden: admin only`. `convex run --identity '<UserIdentity>'` supplies
// one: convex-auth reads its `subject`, so the call runs AS that user. That is
// the whole mechanism — the deployment needs no ungated door of its own, and
// these commands call the same `listDebugScenarios` / `deleteDebugScenario`
// the admin panel calls.
//
// Issue #3331 originally added a pair of ungated `internal*` functions here
// because it read the `Forbidden` as "the CLI cannot reach admin functions"
// rather than "this call passed no identity". #3333 removed them; the
// ergonomics — not having to hand-type an identity blob with a user id in it —
// is what was worth keeping.
//
// TWO THINGS IT DOES NOT DO, deliberately:
//
//  - NO `--push`. The seed pushes because it resolves card names against the
//    deployed bundle (issue #3253). Every function these commands call has
//    existed for many releases, so a push would buy nothing and cost ~15s.
//  - NO IMPERSONATION OF AN ARBITRARY USER. The identity is resolved from the
//    deployment's own `users` table, first row with `isAdmin`. A deployment
//    with no admin gets a named error rather than a bare `Forbidden`.
//
// It runs in the PRIMARY CHECKOUT. A worktree does have `.env.local`
// (`bootstrap-worktree.ts` copies it), but `primaryCheckout()` keeps the
// deployment lookup in one place — the one thing allowed to read another
// directory, and only for deployment state.

import { spawnSync } from "node:child_process";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { convexRunArgv } from "./lib/seed-scenario-run";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    formatDeleteOutcome,
    formatScenarioRow,
    identityPayload,
    projectScenarioListing,
    selectAdminIdentity,
    selectScenariosByLabel,
    type StoredScenarioRow,
    type UserRow,
} from "./lib/scenario-cli";

/** No push, so the budget is the call itself rather than a bundle upload. */
const CALL_TIMEOUT_MS = 60_000;

function run(argv: string[], timeoutMs = CALL_TIMEOUT_MS): string {
    const res = spawnSync("npx", argv, {
        cwd: primaryCheckout(),
        encoding: "utf8",
        timeout: timeoutMs,
    });
    if (res.error) throw new Error(res.error.message);
    if (res.status !== 0) {
        const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
        throw new Error(convexRunErrorMessage(out));
    }
    return (res.stdout ?? "").trim();
}

/** The `--identity` payload for an admin on this deployment. Throws with the
 *  actionable message when there is none — `assertIsAdmin` would otherwise
 *  report it as `Forbidden: admin only`, which reads like a broken CLI rather
 *  than an unflagged account. */
function adminIdentity(): string {
    const raw = run([
        "convex",
        "data",
        "users",
        "--format",
        "json",
        "--limit",
        "1000",
    ]);
    const users = (raw === "" ? [] : JSON.parse(raw)) as UserRow[];
    const id = selectAdminIdentity(users);
    if (id === null) {
        throw new Error(
            "no admin user on this deployment — flag one with `isAdmin: true` " +
                "(these commands run as an admin because every scenario " +
                "function is `assertIsAdmin`-gated)"
        );
    }
    return identityPayload(id);
}

function callAsAdmin(identity: string, fn: string, payload: object): unknown {
    const out = run(
        convexRunArgv(fn, JSON.stringify(payload), { push: false, identity })
    );
    return out === "" ? null : (JSON.parse(out) as unknown);
}

function listScenarios(identity: string): StoredScenarioRow[] {
    return (callAsAdmin(identity, "debugScenarios:listDebugScenarios", {}) ??
        []) as StoredScenarioRow[];
}

function main(): void {
    const [command, ...rest] = process.argv.slice(2);

    if (command === "ls") {
        const rows = projectScenarioListing(listScenarios(adminIdentity()));
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
        const identity = adminIdentity();
        // Resolve the label to ids through the listing — `deleteDebugScenario`
        // takes an id, and the id is precisely what a CLI caller has no other
        // way to obtain.
        const ids = selectScenariosByLabel(listScenarios(identity), label);
        for (const id of ids) {
            callAsAdmin(identity, "debugScenarios:deleteDebugScenario", { id });
        }
        console.log(formatDeleteOutcome(label, ids.length));
        // A no-match is a failed intent, not housekeeping noise: exit non-zero
        // so a script that chains on it stops.
        if (ids.length === 0) process.exit(1);
        return;
    }

    console.error('usage: bun run scenario:ls | bun run scenario:rm "<label>"');
    process.exit(1);
}

if (import.meta.main) main();
