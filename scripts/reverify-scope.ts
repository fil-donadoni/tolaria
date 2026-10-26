#!/usr/bin/env bun
/**
 * `bun run reverify:scope` — after a rebase, the tests the base's move owes a
 * re-run (issue #6650). Reads `base:drift`'s receipt for the pre-rebase base
 * sha B, diffs B → origin/<base>, intersects with the branch's own reach.
 * `--conflicts a,b` adds hand-resolved files. Prints the vitest command, or
 * says the receipt carries everything.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORIGIN_BASE } from "./lib/branches";
import { RECEIPT_FILE } from "./lib/base-drift";
import { reverifyScope } from "./lib/lane-verdict";
import { reachIndex, relatedTests } from "./lib/test-reach";

function git(args: string[]): string {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
    return r.stdout;
}
const lines = (s: string) => s.split("\n").filter((l) => l !== "");

const gitDir = git(["rev-parse", "--absolute-git-dir"]).trim();
const receipt = JSON.parse(readFileSync(join(gitDir, RECEIPT_FILE), "utf8"));
const arg = process.argv.find((a) => a.startsWith("--conflicts="));
const conflicts = arg ? arg.slice("--conflicts=".length).split(",") : [];

const baseDelta = lines(
    git(["diff", "--name-only", `${receipt.baseSha}..${ORIGIN_BASE}`])
);
const branchFiles = lines(
    git(["diff", "--name-only", `${ORIGIN_BASE}...HEAD`])
);
const index = reachIndex(process.cwd());
const related = (paths: readonly string[]) => {
    const r = relatedTests(index, [...paths]);
    return [...r["node-engine"], ...r["node-tooling"], ...r.dom];
};
const scope = reverifyScope({
    baseDelta,
    conflictFiles: conflicts,
    related,
    branchFiles,
});
console.log(
    `reverify:scope: base moved ${baseDelta.length} file(s); ${scope.run.length} test(s) to re-run, ${scope.carried} base-reached carried by the receipt`
);
if (scope.run.length > 0) {
    console.log(`bunx vitest run ${scope.run.map((t) => `'${t}'`).join(" ")}`);
}
