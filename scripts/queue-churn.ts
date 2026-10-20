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

function runs(workflow: string, from: string): WorkflowRun[] {
    return JSON.parse(
        gh([
            "run",
            "list",
            "--workflow",
            workflow,
            "--created",
            `>=${from.slice(0, 10)}`,
            "--limit",
            "1000",
            "--json",
            "displayTitle,conclusion,createdAt",
        ])
    ) as WorkflowRun[];
}

function mergedPrs(from: string, to: string): number[] {
    return (
        JSON.parse(
            gh([
                "pr",
                "list",
                "--state",
                "merged",
                "--search",
                `merged:>=${from.slice(0, 10)}`,
                "--limit",
                "1000",
                "--json",
                "number,mergedAt",
            ])
        ) as { number: number; mergedAt: string }[]
    )
        .filter((p) => p.mergedAt >= from && p.mergedAt < to)
        .map((p) => p.number);
}

const COMMENTS_QUERY = `query($q:String!,$endCursor:String){search(type:ISSUE,query:$q,first:50,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{comments(last:30){nodes{createdAt body}}}}}}`;

function comments(from: string): QueueComment[] {
    type Page = {
        data: {
            search: { nodes: { comments?: { nodes: QueueComment[] } }[] };
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
            `q=is:pr updated:>=${from.slice(0, 10)}`,
        ])
    ) as Page[];
    return pages.flatMap((p) =>
        p.data.search.nodes.flatMap((n) => n.comments?.nodes ?? [])
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
        queueLaneRuns: runs("queue-lane.yml", from),
        prRefreshRuns: runs("pr-refresh.yml", from),
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
