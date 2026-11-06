#!/usr/bin/env bun
// `bun run check:weight-noise [--base=<ref>] [<test file>…]` — refuses a Bot test
// that pins float noise, before a refit reds it on the base (issue #8348).
//
// Runs the `bot-node` test files HEAD adds or edits against its merge base with
// the base branch, or the files named, with the fitted weights nudged
// (`lib/weight-noise.ts`). A lane guard, admitted by a changed bot test: a test
// already on the base is health's. Exit 1 on a red, 0 with nothing to run.

import { spawnSync } from "node:child_process";
import { ORIGIN_BASE } from "./lib/branches";
import {
    VITEST_FS_CACHE_ENV,
    VITEST_FS_CACHE_OFF,
} from "./lib/vitest-fs-cache";
import { noiseCheckedFiles } from "./lib/weight-noise";

function git(...args: string[]): string {
    const run = spawnSync("git", args, { encoding: "utf8" });
    if (run.status !== 0)
        throw new Error(`git ${args.join(" ")}: ${run.stderr.trim()}`);
    return run.stdout;
}

function changedFiles(base: string): string[] {
    const mergeBase = git("merge-base", base, "HEAD").trim();
    return git("diff", "--name-only", "--diff-filter=d", mergeBase, "HEAD")
        .split("\n")
        .filter(Boolean);
}

function main(): number {
    const args = process.argv.slice(2);
    const baseArg = args.find((a) => a.startsWith("--base="));
    const base = baseArg ? baseArg.slice("--base=".length) : ORIGIN_BASE;
    const named = args.filter((a) => !a.startsWith("--"));
    const files = noiseCheckedFiles(
        named.length > 0 ? named : changedFiles(base)
    );
    if (files.length === 0) {
        console.log(
            "check:weight-noise: no changed bot-node test — nothing to run"
        );
        return 0;
    }
    const run = spawnSync(
        "bunx",
        [
            "vitest",
            "run",
            "--config",
            "vitest.weight-noise.config.ts",
            "--project",
            "bot-node",
            ...files,
        ],
        {
            stdio: "inherit",
            env: { ...process.env, [VITEST_FS_CACHE_ENV]: VITEST_FS_CACHE_OFF },
        }
    );
    if (run.status !== 0) {
        console.error(
            "check:weight-noise: red with the fitted weights one last digit away. The test pins float noise or a weight's exact value, and the next refit reds it on the base. Assert a difference through `expectSamePoints` (`convex/gre/ai/__tests__/pointsGrid.helper.ts`), or read the weight instead of its literal."
        );
        return 1;
    }
    console.log(`check:weight-noise: ${files.length} file(s) green`);
    return 0;
}

process.exit(main());
