#!/usr/bin/env bun
/**
 * `check:issue-log-comments` — a comment block with 3+ distinct `issue #N`
 * refs is an issue log, not a mechanism (issue #6170). Ratchet verdict in
 * `scripts/lib/issue-log-comments.ts`.
 *
 * Two halves: the census (every tracked source against the committed
 * baseline, which holds the legacy blocks) and the diff (the baseline may
 * not GAIN a key against the merge base — `--base=<ref>` overrides; on the
 * base tip the two are one commit and that half passes). `--update` rewrites
 * the baseline to the current blocks but refuses to add one: it only shrinks.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { ORIGIN_BASE } from "./lib/branches";
import {
    ISSUE_LOG_BASELINE_PATH,
    ISSUE_LOG_EXCLUDED,
    ISSUE_LOG_SOURCE,
    ISSUE_LOG_THRESHOLD,
    baselineAdditions,
    issueLogBlocks,
    issueLogVerdict,
} from "./lib/issue-log-comments";

const git = (...args: string[]): string =>
    execFileSync("git", args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });

const files = git("ls-files", "-z")
    .split("\0")
    .filter((f) => ISSUE_LOG_SOURCE.test(f) && !ISSUE_LOG_EXCLUDED.test(f));
const found = files.flatMap((f) =>
    issueLogBlocks(f, fs.readFileSync(f, "utf8"))
);
const baseline: string[] = JSON.parse(
    fs.readFileSync(ISSUE_LOG_BASELINE_PATH, "utf8")
);

if (process.argv.includes("--update")) {
    const keep = new Set(found.map((b) => b.key));
    const next = baseline.filter((k) => keep.has(k));
    fs.writeFileSync(
        ISSUE_LOG_BASELINE_PATH,
        `${JSON.stringify(next, null, 4)}\n`
    );
    console.log(
        `check:issue-log-comments: baseline ${baseline.length} → ${next.length}`
    );
    process.exit(0);
}

const verdict = issueLogVerdict(found, baseline);
const failures: string[] = [];
for (const b of verdict.fresh)
    failures.push(
        `  ${b.file}:${b.line} names ${b.refs.length} issues (${b.refs.map((n) => `#${n}`).join(", ")})`
    );
if (verdict.fresh.length)
    failures.unshift(
        `✗ ${verdict.fresh.length} comment block(s) name ${ISSUE_LOG_THRESHOLD}+ distinct issues.\n` +
            "  Describe the mechanism (what it reads, why); history is git's and the PR's. One `(issue #N)` pointer is fine."
    );
if (verdict.stale.length)
    failures.push(
        `✗ ${verdict.stale.length} baseline key(s) match no block: run \`bun run check:issue-log-comments -- --update\` (the baseline only shrinks).`
    );

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const base = baseArg ? baseArg.slice("--base=".length) : ORIGIN_BASE;
try {
    const mergeBase = git("merge-base", base, "HEAD").trim();
    const before: string[] = JSON.parse(
        git("show", `${mergeBase}:${ISSUE_LOG_BASELINE_PATH}`)
    );
    const added = baselineAdditions(before, baseline);
    if (added.length)
        failures.push(
            `✗ ${added.length} key(s) added to ${ISSUE_LOG_BASELINE_PATH}: the baseline only shrinks — rewrite the block instead.`
        );
} catch {
    // baseline absent at the merge base (this guard's own first PR): nothing to compare
}

if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log(
    `✓ check:issue-log-comments: ${found.length} legacy block(s) in ${files.length} files, none new`
);
