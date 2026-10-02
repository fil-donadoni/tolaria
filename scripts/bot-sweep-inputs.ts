#!/usr/bin/env bun
/**
 * Which of these paths would make a bare `oracle:compile` replay the Bot-play
 * sweep? (issue #4942)
 *
 * Reads repo-relative paths, one per line, on stdin; prints the ones that are
 * a Bot hash input (`isBotSourceFile`, the set `botHash` covers) or fall under
 * the Bot globs (`matchesBotGlob`). Always exits 0 — the verdict is the output.
 *
 * Its one caller is `deny-guard.sh` § 7, which pipes a worktree's diff in and
 * denies a bare `oracle:compile` when anything comes back. Living here, not as
 * a path list in the hook, is what keeps the hook from drifting off the hash.
 */

import { readFileSync } from "node:fs";
import { matchesBotGlob } from "./lib/bot-globs";
import { isBotSourceFile } from "./lib/oracle-bot-reach";

/** The subset of `paths` whose edit puts a Bot PR on the sweep. */
export function botSweepInputs(paths: readonly string[]): string[] {
    return paths.filter((p) => isBotSourceFile(p) || matchesBotGlob(p));
}

if (import.meta.main) {
    const paths = readFileSync(0, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    for (const p of botSweepInputs(paths)) console.log(p);
}
