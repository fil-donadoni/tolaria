#!/usr/bin/env bun
/**
 * `bun run gaps:sync` — idempotent Grammar Gap / Bot Gap → issue filing
 * (ADR 0137, PRD issue #3820, issue #3829). One issue per allowlist row of
 * `data/grammar-gaps.json`, a child of the Op-gap umbrella (issue #3972),
 * with its number written back into the row. A second run against unchanged
 * inputs writes nothing — see `lib/gap-issues.ts`'s header for the
 * idempotency contract, the scope, and why the umbrella is not PRD #3820.
 *
 * `land` runs this post-merge, non-gating, from the PRIMARY checkout — like
 * this command run by hand. It commits + pushes the allowlist update
 * straight to the base branch when it wrote one: the write is a single
 * `issue` field per row, at the same trust tier ADR 0137 already grants the
 * issue creation itself ("a deliberate exception to the loop drains the
 * queue, never fills it… these issues come from a computed gate… never a
 * subagent's judgement").
 *
 * ── Why a direct push, not a PR ───────────────────────────────────────────
 *
 * This is the one place in the repo a script commits a TRACKED file straight
 * to the base branch outside `land`'s gated merge. A gitignored ledger (like
 * `.claude/telemetry/board-priority.json`) was rejected: `check-gaps.ts`
 * quotes `row.issue` as "the open issue that closes the gap", so a session
 * picking up an Op gap reads THAT field, and a private cache the committed
 * file never saw would drift from what the allowlist claims. The write is
 * narrow: one `issue` integer per row, never the shrink-only `ops[]`
 * membership `check-gaps.ts` guards — a bad value can only point a reader at
 * the wrong issue, which the next run re-checks against the tracker.
 *
 * The tracker talks to GitHub through `lib/gh.ts`, which strips
 * `GITHUB_TOKEN` so it authenticates as the developer, never as the app's
 * bug-report PAT (same rule `queue:plan` follows). It reads every Op-gap
 * issue in ONE list call, not one `gh issue view` per row — this runs on
 * every landing.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALLOWLIST_PATH, parseAllowlist } from "./check-gaps";
import { BASE_BRANCH } from "./lib/branches";
import { gh } from "./lib/gh";
import {
    applyUpdatedIssues,
    buildGrammarGapFilings,
    GRAMMAR_GAP_LABELS,
    OP_GAP_UMBRELLA,
    syncGaps,
    type GapTracker,
    type TrackedIssue,
} from "./lib/gap-issues";

/** The `gh`-backed `GapTracker` — the one place this module touches the
 *  network. */
export class GhGapTracker implements GapTracker {
    private cache: Map<number, TrackedIssue> | null = null;

    /** Every `Grammar Gap:` issue, open and closed, in one call. A number the
     *  list misses falls back to a single `view`. */
    private prefetch(): Map<number, TrackedIssue> {
        if (this.cache !== null) return this.cache;
        const out = gh([
            "issue",
            "list",
            "--search",
            'in:title "Grammar Gap:"',
            "--state",
            "all",
            "--limit",
            "500",
            "--json",
            "number,state,body",
        ]);
        const rows = JSON.parse(out) as {
            number: number;
            state: string;
            body: string;
        }[];
        this.cache = new Map(
            rows.map((r) => [
                r.number,
                {
                    state: r.state === "CLOSED" ? "CLOSED" : "OPEN",
                    body: r.body,
                },
            ])
        );
        return this.cache;
    }

    getIssue(number: number): TrackedIssue | null {
        const hit = this.prefetch().get(number);
        if (hit !== undefined) return hit;
        try {
            const out = gh([
                "issue",
                "view",
                String(number),
                "--json",
                "state,body",
            ]);
            const parsed = JSON.parse(out) as { state: string; body: string };
            return {
                state: parsed.state === "CLOSED" ? "CLOSED" : "OPEN",
                body: parsed.body,
            };
        } catch {
            return null;
        }
    }

    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
        parent: number;
    }): number {
        const args = [
            "issue",
            "create",
            "--title",
            input.title,
            "--body",
            input.body,
        ];
        for (const label of input.labels) args.push("--label", label);
        const url = gh(args).trim();
        const m = /\/issues\/(\d+)\s*$/.exec(url);
        if (m === null) {
            throw new Error(
                `gh issue create: could not read an issue number back from ${JSON.stringify(url)}`
            );
        }
        const number = Number(m[1]);
        this.setParent(number, input.parent);
        return number;
    }

    updateBody(number: number, body: string): void {
        gh(["issue", "edit", String(number), "--body", body]);
    }

    subIssueCount(parent: number): number {
        const out = gh([
            "api",
            `repos/{owner}/{repo}/issues/${parent}`,
            "--jq",
            ".sub_issues_summary.total // 0",
        ]);
        return Number(out.trim());
    }

    /**
     * `gh issue edit --parent` is unreliable under rapid fire (issue-tracker
     * doc): it can exit non-zero on success or no-op silently. Read the edge
     * back and retry rather than trust the exit code.
     */
    private setParent(child: number, parent: number): void {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                gh([
                    "issue",
                    "edit",
                    String(child),
                    "--parent",
                    String(parent),
                ]);
            } catch {
                // Read-back below is the real check either way.
            }
            const out = gh([
                "issue",
                "view",
                String(child),
                "--json",
                "parent",
            ]);
            const got = (JSON.parse(out) as { parent?: { number?: number } })
                .parent?.number;
            if (got === parent) return;
        }
        console.error(
            `gaps:sync: could not confirm issue #${child}'s parent is #${parent} after 3 attempts`
        );
    }
}

/** Commit + push the allowlist update straight to `origin/<base>`, from a
 *  clean primary checkout already on that branch. Never throws: `land`
 *  treats this whole script as non-gating — but it prints, so a human
 *  notices the file drifted from the remote. */
export function commitAndPushAllowlist(root: string): void {
    const git = (args: string[]) =>
        spawnSync("git", args, { cwd: root, encoding: "utf8" });
    const add = git(["add", ALLOWLIST_PATH]);
    if (add.status !== 0) {
        console.error(
            `gaps:sync: could not stage ${ALLOWLIST_PATH}: ${add.stderr}`
        );
        return;
    }
    const commit = git([
        "commit",
        "-q",
        "-m",
        "gaps:sync — file per-gap issues, record them in the allowlist",
    ]);
    if (commit.status !== 0) {
        console.error(
            `gaps:sync: could not commit ${ALLOWLIST_PATH}: ${commit.stderr}`
        );
        return;
    }
    const push = git(["push", "origin", `HEAD:${BASE_BRANCH}`]);
    if (push.status !== 0) {
        console.error(
            `gaps:sync: could not push the allowlist update to ${BASE_BRANCH}: ${push.stderr}`
        );
    }
}

function main(): void {
    const root = resolve(".");
    const allowlist = parseAllowlist(
        readFileSync(join(root, ALLOWLIST_PATH), "utf8")
    );
    const result = syncGaps(
        buildGrammarGapFilings(allowlist),
        new GhGapTracker(),
        GRAMMAR_GAP_LABELS,
        OP_GAP_UMBRELLA
    );

    const counts = new Map<string, number>();
    for (const action of result.actions) {
        counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
        if (action.kind !== "noop") {
            console.log(
                `${action.kind.padEnd(11)} ${action.key} -> issue #${action.issue}`
            );
        }
    }
    console.log(
        `gaps:sync: ${[...counts].map(([k, n]) => `${n} ${k}`).join(", ") || "no gaps"}`
    );

    if (result.updatedRows.size === 0) return;
    const updated = applyUpdatedIssues(allowlist, result.updatedRows);
    writeFileSync(
        join(root, ALLOWLIST_PATH),
        `${JSON.stringify(updated, null, 4)}\n`
    );
    console.log(
        `gaps:sync: ${result.updatedRows.size} allowlist row(s) updated in ${ALLOWLIST_PATH}`
    );
    commitAndPushAllowlist(root);
}

if (import.meta.main) main();
