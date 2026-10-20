#!/usr/bin/env bun
// `bun run queue:churn --since <date> [--until <date>] [--json]` — merge-queue
// churn over a window (issue #6171): `queue-lane` runs per merged PR by
// conclusion, `pr-refresh` runs per merged PR, Mergify dequeues by cause.
// Read-only. The arithmetic is `lib/queue-churn.ts`; this file is the I/O.

import { gh } from "./lib/gh";
import {
    churnMarkdown,
    queueChurn,
    type QueueComment,
    type WorkflowRun,
} from "./lib/queue-churn";

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

/** `2026-10-20` → UTC midnight; a full ISO instant passes through. */
function instant(s: string): string {
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
    if (Number.isNaN(t)) throw new Error(`not a date: ${s}`);
    return new Date(t).toISOString();
}

const LIMIT = 1000;

/** A list that filled its limit was cut: the ratios would be silently low. */
function notTruncated<T>(rows: T[], what: string): T[] {
    if (rows.length >= LIMIT)
        throw new Error(
            `${what}: ${LIMIT} rows is the cap — narrow the window`
        );
    return rows;
}

const day = (iso: string) => iso.slice(0, 10);

function runs(workflow: string, from: string, to: string): WorkflowRun[] {
    return notTruncated(
        JSON.parse(
            gh([
                "run",
                "list",
                "--workflow",
                workflow,
                "--created",
                `${day(from)}..${day(to)}`,
                "--limit",
                String(LIMIT),
                "--json",
                "displayTitle,conclusion,createdAt",
            ])
        ) as WorkflowRun[],
        `${workflow} runs`
    );
}

function mergedPrs(from: string, to: string): number[] {
    return notTruncated(
        JSON.parse(
            gh([
                "pr",
                "list",
                "--state",
                "merged",
                "--search",
                `merged:${day(from)}..${day(to)}`,
                "--limit",
                String(LIMIT),
                "--json",
                "number,mergedAt",
            ])
        ) as { number: number; mergedAt: string }[],
        "merged PRs"
    )
        .filter(
            (p) =>
                Date.parse(p.mergedAt) >= Date.parse(from) &&
                Date.parse(p.mergedAt) < Date.parse(to)
        )
        .map((p) => p.number);
}

const COMMENTS_QUERY = `query($q:String!,$endCursor:String){search(type:ISSUE,query:$q,first:20,after:$endCursor){pageInfo{hasNextPage endCursor} issueCount nodes{... on PullRequest{number comments(last:50){totalCount nodes{createdAt body}}}}}}`;

function repoName(): string {
    return gh([
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
    ]).trim();
}

function comments(from: string): QueueComment[] {
    type Page = {
        data: {
            search: {
                issueCount: number;
                nodes: {
                    number?: number;
                    comments?: { totalCount: number; nodes: QueueComment[] };
                }[];
            };
        };
    };
    const pages = JSON.parse(
        gh([
            "api",
            "graphql",
            "--paginate",
            "--slurp",
            "-f",
            `query=${COMMENTS_QUERY}`,
            "-F",
            `q=repo:${repoName()} is:pr updated:${day(from)}..*`,
        ])
    ) as Page[];
    if (pages[0] && pages[0].data.search.issueCount >= LIMIT)
        throw new Error(
            `PR search: ${LIMIT} results is the cap — narrow the window`
        );
    return pages.flatMap((p) =>
        p.data.search.nodes.flatMap((n) => {
            if (n.comments && n.comments.totalCount > n.comments.nodes.length)
                console.error(
                    `warning: PR #${n.number} has ${n.comments.totalCount} comments, read the last ${n.comments.nodes.length}`
                );
            return n.comments?.nodes ?? [];
        })
    );
}

function main(): void {
    const since = arg("--since");
    if (!since) {
        console.error(
            "usage: bun run queue:churn --since <date> [--until <date>] [--json]"
        );
        process.exit(2);
    }
    const from = instant(since);
    const to = instant(arg("--until") ?? new Date().toISOString());
    const churn = queueChurn({
        window: { from, to },
        mergedPrs: mergedPrs(from, to),
        queueLaneRuns: runs("queue-lane.yml", from, to),
        prRefreshRuns: runs("pr-refresh.yml", from, to),
        comments: comments(from),
    });
    console.log(
        process.argv.includes("--json")
            ? JSON.stringify(churn, null, 2)
            : churnMarkdown(churn, { from, to })
    );
}

if (import.meta.main) {
    try {
        main();
    } catch (err) {
        console.error(`✗ queue:churn: ${(err as Error).message}`);
        process.exit(1);
    }
}
