#!/usr/bin/env bun
/**
 * `check:derived-in-diff` — refuse a diff that still carries derived
 * whole-file state (ADR 0157 § Option 1b, issue #6248). See
 * `scripts/lib/derived-in-pr.ts` for the split: the catalogue files are the
 * base's whole, the lockfile's header hashes are the base's lines, its rows
 * are the PR's.
 *
 * Compares HEAD against its merge base with the base branch (`--base=<ref>`
 * overrides). A static path-and-line check over `git diff --name-only` and
 * two `git show`s of the lockfile header — under a second, no corpus, no
 * generator. Run on the base tip itself the two are one commit and it
 * passes; a `diffOnly` cheap guard (`CHEAP_GUARDS`), so health never plans
 * it. The base's own `derive:sync` commits are exempt by subject.
 */
import { spawnSync } from "node:child_process";
import { ORIGIN_BASE } from "./lib/branches";
import { DERIVED_PATHS, LOCKFILE_PATH } from "./lib/derive-sync";
import {
    carriesNothing,
    derivedCarried,
    derivedInDiffProblems,
    DERIVED_IN_DIFF_REMEDY,
} from "./lib/derived-in-pr";

function git(...args: string[]): { ok: boolean; out: string } {
    const r = spawnSync("git", args, { encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout ?? "" };
}

function must(...args: string[]): string {
    const r = git(...args);
    if (!r.ok) throw new Error(`git ${args.join(" ")} failed`);
    return r.out;
}

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const base = baseArg ? baseArg.slice("--base=".length) : ORIGIN_BASE;
const mergeBase = must("merge-base", base, "HEAD").trim();

const changed = must(
    "diff",
    "--name-only",
    mergeBase,
    "HEAD",
    "--",
    ...DERIVED_PATHS
)
    .split("\n")
    .filter((p) => p !== "");

const carried = derivedCarried({
    changed,
    lockfile: () => ({
        head: git("show", `HEAD:${LOCKFILE_PATH}`).out || null,
        base: git("show", `${mergeBase}:${LOCKFILE_PATH}`).out || null,
    }),
    subjectsTouching: (path) =>
        must("log", "--format=%s", `${mergeBase}..HEAD`, "--", path)
            .split("\n")
            .filter((s) => s !== ""),
});

if (carriesNothing(carried)) {
    console.log(
        `✓ check:derived-in-diff: the diff carries no derived state (${changed.length === 0 ? "no derived path changed" : "lockfile rows only"})`
    );
    process.exit(0);
}

const problems = derivedInDiffProblems(carried);
console.error(
    `✗ check:derived-in-diff: the PR carries derived state the base writes (ADR 0157):\n` +
        problems.map((p) => `    ${p}`).join("\n") +
        `\n  fix: ${DERIVED_IN_DIFF_REMEDY}`
);
process.exit(1);
