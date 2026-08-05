// The one way a script in this repo shells out to `gh`.
//
// It exists to hold a single non-obvious rule that was previously duplicated in
// two wrappers — and a rule that lives in two places is a rule that drifts, with
// the stale copy reading as authoritative.
//
// ── Why the token is stripped ────────────────────────────────────────────────
//
// `.env.local` carries `GITHUB_TOKEN`: the narrow, fine-grained PAT that
// `convex/bugReports.ts` uses SERVER-SIDE to file issues on behalf of the app's
// bug-report feature. **bun auto-loads `.env.local` into `process.env` for every
// script it runs**, and `gh` prefers `GITHUB_TOKEN` over its keyring login. Net
// effect: every `gh` call from a `bun run` script authenticated as the
// bug-report integration rather than as the developer.
//
// The symptom is a permission error on an operation your INTERACTIVE `gh` does
// fine — e.g. `bun run queue:plan` failing with
// `GraphQL: Resource not accessible by personal access token (user.projectV2)`
// while a bare `gh project item-list` succeeds. That divergence is very hard to
// read as an auth problem, because both are "the same `gh`".
//
// So `GITHUB_TOKEN` is removed from the child's environment and `gh` falls back
// to `gh auth login`. **`GH_TOKEN` is deliberately left intact**: it is gh's own
// dedicated variable and the documented way to hand it a token in CI, so it
// remains the explicit override.
//
// Do NOT "fix" a permission error here by widening the app PAT. That credential
// ships to a server-side Convex action; the project board and the issue queue
// are none of its business.

import { execFileSync } from "child_process";

/** Run `gh` under the DEVELOPER's credentials and return stdout. Throws on a
 *  non-zero exit, like `execFileSync`. */
export function gh(args: string[]): string {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    return execFileSync("gh", args, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        env,
    });
}
