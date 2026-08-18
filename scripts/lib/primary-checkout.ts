// The primary checkout — the one that owns `.git/` — as a single shared
// resolver (issue #2519).
//
// Five call sites duplicated this exact test before this file existed:
// `loop-scorecard.ts`, `land.ts`, `docs-lane.ts`, `worktree-gc.ts` (inlined,
// not even a function) and `bootstrap-worktree.ts` (an outlier: it returns
// `null` when we already ARE the primary, because its caller needs to know
// "there is nothing to bootstrap FROM" rather than a usable path — a
// different signature, left alone here). Migrating those five onto this
// module is explicitly out of scope for #2519: each already ships behind its
// own tests, and unifying them is a separate change from adding the two NEW
// callers this issue needs (`loop-status.ts` and the `/api/loop-status`
// route in `telemetry-serve.ts`).
//
// The test itself: in the primary checkout, `git rev-parse --git-common-dir`
// prints the RELATIVE path `.git`. In a linked worktree it prints an
// ABSOLUTE path to `<primary>/.git`. That difference IS the "am I a linked
// worktree?" question — no path-name heuristics, no guessing from `cwd`.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

export function primaryCheckout(cwd: string = process.cwd()): string {
    const r = spawnSync("git", ["rev-parse", "--git-common-dir"], {
        encoding: "utf8",
        cwd,
    });
    const common = (r.stdout ?? "").trim();
    return r.status === 0 && common.startsWith("/")
        ? dirname(resolve(common))
        : resolve(cwd);
}
