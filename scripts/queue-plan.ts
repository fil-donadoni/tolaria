#!/usr/bin/env bun
// `bun run queue:plan` — print the next `/process-gh-issues` fan-out batch as JSON.
//
// This wrapper holds NO decisions. It fetches, calls `planBatch`, and prints.
// Everything the loop used to derive from prose lives in `lib/queue-plan.ts`,
// where it is pure and tested; keeping the wrapper decision-free is what makes
// that true (a rule quietly re-implemented here would be untested again).
//
// Usage:
//   bun run queue:plan                 # default batch cap
//   bun run queue:plan --cap 2
//   bun run queue:plan --limit 100     # how deep to read the queue
//   bun run queue:plan --pretty
//   bun run queue:plan --inferred '{"2104":["convex/cards/sets/ice/**"]}'
//
// The `--inferred` map is the fallback for issues predating the `Target files:`
// convention: run once, read which candidates came back with an unknown blast
// radius, infer their file sets, re-run with the map. The planner refuses to
// guess; supplying the guess is the orchestrator's job, and doing it explicitly
// keeps the plan reproducible.
//
// The `gh` round-trips are the only I/O: one list call, then one body fetch per
// candidate the planner actually considers (plus one per dependency it has to
// resolve). Selection cost scales with the batch, not the queue.

import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import {
    planBatch,
    type IssueDetail,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
} from "./lib/queue-plan";

const DEFAULTS = {
    cap: 4,
    limit: 60,
    staleClaimHours: 24,
    defaultImplModel: "sonnet",
};

function arg(name: string, fallback: number): number {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = Number(process.argv[i + 1]);
    if (!Number.isFinite(value)) {
        console.error(`✗ --${name} needs a number`);
        process.exit(2);
    }
    return value;
}

function gh(args: string[]): string {
    return execFileSync("gh", args, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
    });
}

const limit = arg("limit", DEFAULTS.limit);

const issues = JSON.parse(
    gh([
        "issue",
        "list",
        "--label",
        "ready-for-agent",
        "--state",
        "open",
        "--json",
        "number,title,labels,parent,assignees,updatedAt",
        "--limit",
        String(limit),
    ])
) as QueueIssue[];

/** Issues with an open PR — the liveness signal that keeps a long-running claim
 *  from being swept. Derived from the head branch name, because that branch is
 *  the loop's atomic ownership claim (`feat/issue-N` / `fix/issue-N`). */
function issuesWithOpenPr(): number[] {
    const prs = JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--json",
            "headRefName",
            "--limit",
            "100",
        ])
    ) as { headRefName: string }[];
    return prs
        .map((pr) => /^(?:feat|fix)\/issue-(\d+)$/.exec(pr.headRefName)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number);
}

const detailCache = new Map<number, IssueDetail>();

const port: QueuePort = {
    issuesWithOpenPr: issuesWithOpenPr(),
    issueDetail(number: number): IssueDetail {
        const cached = detailCache.get(number);
        if (cached) return cached;
        const raw = JSON.parse(
            gh(["issue", "view", String(number), "--json", "state,labels,body"])
        ) as { state: string; labels: { name: string }[]; body: string };
        const detail: IssueDetail = {
            state: raw.state === "CLOSED" ? "CLOSED" : "OPEN",
            labels: raw.labels.map((l) => l.name),
            body: raw.body ?? "",
        };
        detailCache.set(number, detail);
        return detail;
    },
};

function inferredTargetFiles(): Record<number, string[]> | undefined {
    const i = process.argv.indexOf("--inferred");
    if (i === -1) return undefined;
    const raw = process.argv[i + 1];
    if (!raw) {
        console.error("✗ --inferred needs a JSON object, or a path to one");
        process.exit(2);
    }
    const text = raw.trim().startsWith("{") ? raw : readFileSync(raw, "utf8");
    try {
        return JSON.parse(text) as Record<number, string[]>;
    } catch (err) {
        console.error(
            `✗ --inferred is not valid JSON: ${(err as Error).message}`
        );
        process.exit(2);
    }
}

const config: PlanConfig = {
    batchCap: arg("cap", DEFAULTS.cap),
    staleClaimHours: arg("stale-hours", DEFAULTS.staleClaimHours),
    defaultImplModel: DEFAULTS.defaultImplModel,
    now: new Date().toISOString(),
    inferredTargetFiles: inferredTargetFiles(),
};

const plan = planBatch(issues, config, port);

process.stdout.write(
    JSON.stringify(plan, null, process.argv.includes("--pretty") ? 2 : 0) + "\n"
);
