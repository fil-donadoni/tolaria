/**
 * What the blade robustness audit owes a PR (issue #9361): the health trigger
 * (`lib/health-robustness-trigger.ts`, issue #5078) read on the PR's diff
 * instead of a batch range.
 *
 *   bun scripts/blade-robustness-plan.ts
 *
 * Runs in `blade-robustness.yml`'s `plan` job. The PR's own change is
 * `<base>...<head>` — the files the PR head changes since its merge-base with
 * the base branch as fetched NOW (`BASE_REF`, `HEAD_SHA` from the event).
 * Never the merge ref's `HEAD^1..HEAD` (issue #10319): GitHub can hand out a
 * merge ref whose first parent is a base tip hours older than the PR's own
 * fork point, and that diff then spans every base commit the branch absorbed
 * since — PR #10295, two `src/` files, read FULL on `damageSplit.ts`. Without
 * the env (a run by hand) the merge ref's first parent is the fallback. An
 * unreadable diff is FULL — the trigger's own rule, an audit that cannot be
 * decided is an audit that runs.
 *
 * Writes `mode` (`none` / `full` / `incremental`), `labels` (the JSON array
 * an incremental audit narrows to, else empty) and `reason` to
 * `$GITHUB_OUTPUT` and prints the trigger's one line. Builtins and the
 * trigger only.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
    describeRobustnessMode,
    robustnessModeFromGit,
    robustnessStepEnv,
    ROBUSTNESS_LABELS_ENV,
    type RobustnessMode,
} from "./lib/health-robustness-trigger";

function git(root: string, args: string[]): string {
    return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
    }).trim();
}

/** The mode for a PR whose `head` lands on branch ref `base` (issue
 *  #10319): the files `head` changes since its merge-base with `base` (a
 *  three-dot diff), the registry compared at that merge-base. The closure is
 *  read at `tip`, the checked-out merge ref (what would land, and the tree
 *  whose blobs a blobless checkout holds). */
export function planForPullRequest(
    root: string,
    base: string,
    head: string,
    tip = "HEAD"
): RobustnessMode {
    let forkPoint: string | null = null;
    let changed: string[] | null = null;
    try {
        forkPoint = git(root, ["merge-base", base, head]);
        changed = git(root, ["diff", "--name-only", forkPoint, head])
            .split("\n")
            .filter((l) => l !== "");
    } catch {
        forkPoint = null;
        changed = null;
    }
    return robustnessModeFromGit({ root, green: forkPoint, tip, changed });
}

/** The mode for the PR whose merge ref is checked out at `root` — the
 *  by-hand fallback (no `BASE_REF`/`HEAD_SHA`). */
export function planForMergeRef(root: string): RobustnessMode {
    let green: string | null = null;
    let changed: string[] | null = null;
    try {
        green = git(root, ["rev-parse", "HEAD^1"]);
        changed = git(root, ["diff", "--name-only", green, "HEAD"])
            .split("\n")
            .filter((l) => l !== "");
    } catch {
        green = null;
        changed = null;
    }
    return robustnessModeFromGit({ root, green, tip: "HEAD", changed });
}

/** The `key=value` lines `$GITHUB_OUTPUT` takes. `reason` is one line. */
export function outputLines(mode: RobustnessMode): string[] {
    const labels = robustnessStepEnv(mode)?.[ROBUSTNESS_LABELS_ENV] ?? "";
    return [
        `mode=${mode.kind}`,
        `labels=${labels}`,
        `reason=${mode.reason.replace(/\s+/g, " ")}`,
    ];
}

if (import.meta.main) {
    const baseRef = process.env.BASE_REF;
    const headSha = process.env.HEAD_SHA;
    const mode =
        baseRef && headSha
            ? planForPullRequest(process.cwd(), `origin/${baseRef}`, headSha)
            : planForMergeRef(process.cwd());
    console.log(describeRobustnessMode(mode));
    const out = process.env.GITHUB_OUTPUT;
    if (out) appendFileSync(out, outputLines(mode).join("\n") + "\n");
}
