/**
 * What the blade robustness audit owes a PR (issue #9361): the health trigger
 * (`lib/health-robustness-trigger.ts`, issue #5078) read on the PR's diff
 * instead of a batch range.
 *
 *   bun scripts/blade-robustness-plan.ts
 *
 * Runs in `blade-robustness.yml`'s `plan` job on the merge ref (`HEAD`, whose
 * first parent is the base tip the PR would land on): the diff is
 * `HEAD^1..HEAD`, the PR's own change. An unreadable first parent is FULL —
 * the trigger's own rule, an audit that cannot be decided is an audit that
 * runs. Writes `mode` (`none` / `full` / `incremental`), `labels` (the JSON
 * array an incremental audit narrows to, else empty) and `reason` to
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

/** The mode for the PR whose merge ref is checked out at `root`. */
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
    const mode = planForMergeRef(process.cwd());
    console.log(describeRobustnessMode(mode));
    const out = process.env.GITHUB_OUTPUT;
    if (out) appendFileSync(out, outputLines(mode).join("\n") + "\n");
}
