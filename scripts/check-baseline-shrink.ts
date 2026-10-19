#!/usr/bin/env bun
/**
 * `check:baseline-shrink` — refuse a diff that adds a row to Guard C's
 * baseline (issue #5942). See `scripts/lib/baseline-shrink.ts` for why the
 * diff, and only the diff, can see it.
 *
 * Compares HEAD against its merge base with the base branch (`--base=<ref>`
 * overrides). Run on the base tip itself the two are one commit and it passes:
 * a PR-diff guard, run by `check:lane`, never by health.
 */
import { execFileSync } from "node:child_process";
import { ORIGIN_BASE } from "./lib/branches";
import {
    baselineAdditions,
    ROUND_TRIP_BASELINE_PATH,
} from "./lib/baseline-shrink";

const git = (...args: string[]): string =>
    execFileSync("git", args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const base = baseArg ? baseArg.slice("--base=".length) : ORIGIN_BASE;
const mergeBase = git("merge-base", base, "HEAD").trim();

let before: string;
try {
    before = git("show", `${mergeBase}:${ROUND_TRIP_BASELINE_PATH}`);
} catch {
    console.log(
        `✓ check:baseline-shrink: ${ROUND_TRIP_BASELINE_PATH} absent at the merge base — nothing to compare`
    );
    process.exit(0);
}
const added = baselineAdditions(
    before,
    git("show", `HEAD:${ROUND_TRIP_BASELINE_PATH}`)
);
if (added.length === 0) {
    console.log("✓ check:baseline-shrink: Guard C's baseline gained no row");
    process.exit(0);
}
console.error(
    `✗ check:baseline-shrink: ${added.length} row(s) added to ${ROUND_TRIP_BASELINE_PATH}: ${added.join(", ")}.\n` +
        "  The baseline only shrinks. A card that stopped round-tripping carries a " +
        "`// compiler-gap: <fragment> (#issue)` marker naming the Oracle fragment the " +
        "grammar no longer reads — or the regression is fixed."
);
process.exit(1);
