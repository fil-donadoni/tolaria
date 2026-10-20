#!/usr/bin/env bun
// `bun run weekly-report` — the week's workflow trends as a job summary
// (issue #5651, PRD #5620, ADR 0156 Amendment I § The dashboard is
// simplified, not removed). Run by `.github/workflows/weekly-report.yml`.
//
//   bun run weekly-report machine --out <file>
//       THIS machine's reading: `telemetry:budget --json` and
//       `telemetry:latency --json` over their default window (the last seven
//       days), with the host. A reader that exits non-zero (an empty window,
//       no store) leaves its field null and its first stderr line as the
//       error — a machine with nothing to say is a row, not a failed job.
//
//   bun run weekly-report [--days 7] [--to <iso>] [--machines <dir>] [--json <file>]
//       Reads GitHub — the PRs' label and comment timelines, the base's
//       `health` statuses, issue counts, the `afk-pass` records, the
//       `queue-lane` JSON — plus every `machine.json` under `--machines`,
//       and prints the summary markdown (`lib/workflow-trends.ts`). `--json`
//       also writes the trends, the artifact the cockpit can read.
//
// Exit code: 0 on a report, 1 when GitHub could not be read — a reporter,
// never a gate. Nothing here prints Claude output or an issue body: the job
// log is public.

import { spawnSync, execFileSync } from "node:child_process";
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { gh, netEnv } from "./lib/gh";
import { sanitizeHost } from "./lib/github-runner";
import { BASE_BRANCH } from "./lib/branches";
import { originRepo } from "./lib/health-verdict-store";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    PASS_RECORD_ARTIFACT,
    PASS_WORKFLOW,
    hostOfRunnerName,
    parsePassRecord,
    type PassRecord,
} from "./lib/afk-dispatch";
import {
    laneRecord,
    parseMachineReading,
    summaryMarkdown,
    weeklyTrends,
    type HistoryNode,
    type MachineReading,
    type PrTimeline,
    type QueueRun,
    type TrendFacts,
} from "./lib/workflow-trends";

/** The artifact `queue-lane.yml` uploads its `lane.json` as. */
export const QUEUE_LANE_ARTIFACT = "queue-lane-json";
const QUEUE_WORKFLOW = "queue-lane.yml";
/** The file each machine job writes and uploads. */
const MACHINE_FILE = "machine.json";

function argOf(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function die(msg: string): never {
    console.error(`weekly-report: ${msg}`);
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// machine
// ─────────────────────────────────────────────────────────────────────────

function telemetryJson(script: string): { json: unknown; error?: string } {
    const r = spawnSync("bun", [script, "--json"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });
    if (r.status === 0) {
        try {
            return { json: JSON.parse(r.stdout) };
        } catch {
            return { json: null, error: `${script}: output is not JSON` };
        }
    }
    const line =
        (r.stderr ?? "")
            .split("\n")
            .map((l) => l.trim())
            .find(Boolean) ?? `exit ${r.status ?? "on a signal"}`;
    return { json: null, error: line.slice(0, 200) };
}

function machineMain(): void {
    const out = argOf("--out");
    if (!out) die("machine needs --out <file>");
    const host =
        hostOfRunnerName(process.env.RUNNER_NAME ?? "") ??
        sanitizeHost(hostname());
    const budget = telemetryJson("scripts/telemetry-budget.ts");
    const latency = telemetryJson("scripts/telemetry-latency.ts");
    const reading: MachineReading = {
        host,
        budget: budget.json,
        latency: latency.json,
        errors: {
            ...(budget.error ? { budget: budget.error } : {}),
            ...(latency.error ? { latency: latency.error } : {}),
        },
    };
    writeFileSync(out, `${JSON.stringify(reading)}\n`);
    console.log(
        `weekly-report: machine reading written (budget ${budget.error ? "none" : "ok"}, latency ${latency.error ? "none" : "ok"})`
    );
}

// ─────────────────────────────────────────────────────────────────────────
// report: the GitHub reads
// ─────────────────────────────────────────────────────────────────────────

function graphqlPages<T>(query: string, vars: Record<string, string>): T[] {
    const args = [
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "-f",
        `query=${query}`,
    ];
    for (const [k, v] of Object.entries(vars)) args.push("-F", `${k}=${v}`);
    return JSON.parse(gh(args)) as T[];
}

const PRS_QUERY = `query($q:String!,$endCursor:String){search(type:ISSUE,query:$q,first:50,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{number mergedAt timelineItems(first:100,itemTypes:[LABELED_EVENT,ISSUE_COMMENT,PULL_REQUEST_COMMIT,HEAD_REF_FORCE_PUSHED_EVENT]){nodes{__typename ... on LabeledEvent{createdAt label{name}} ... on IssueComment{createdAt body} ... on PullRequestCommit{commit{committedDate}} ... on HeadRefForcePushedEvent{createdAt}}}}}}}`;

function prTimelines(repo: string, from: string): PrTimeline[] {
    type Page = { data: { search: { nodes: PrTimeline[] } } };
    return graphqlPages<Page>(PRS_QUERY, {
        q: `repo:${repo} is:pr updated:>=${from}`,
    }).flatMap((p) => p.data.search.nodes.filter((n) => n.number));
}

function issueCount(q: string): number {
    return Number(
        gh([
            "api",
            "graphql",
            "-f",
            "query=query($q:String!){search(type:ISSUE,query:$q,first:1){issueCount}}",
            "-F",
            `q=${q}`,
            "--jq",
            ".data.search.issueCount",
        ]).trim()
    );
}

function issueTitles(q: string): string[] {
    type Page = { data: { search: { nodes: { title?: string }[] } } };
    return graphqlPages<Page>(
        `query($q:String!,$endCursor:String){search(type:ISSUE,query:$q,first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{... on Issue{title}}}}`,
        { q }
    )
        .flatMap((p) => p.data.search.nodes)
        .map((n) => n.title ?? "")
        .filter(Boolean);
}

const HISTORY_QUERY = `query($owner:String!,$name:String!,$ref:String!,$since:GitTimestamp!,$endCursor:String){repository(owner:$owner,name:$name){ref(qualifiedName:$ref){target{... on Commit{history(first:100,since:$since,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{oid committedDate status{context(name:"health"){state description createdAt}}}}}}}}}`;

function baseHistory(repo: string, since: string): HistoryNode[] {
    const [owner, name] = repo.split("/");
    type Page = {
        data: {
            repository: {
                ref: { target: { history: { nodes: HistoryNode[] } } } | null;
            };
        };
    };
    return graphqlPages<Page>(HISTORY_QUERY, {
        owner,
        name,
        ref: `refs/heads/${BASE_BRANCH}`,
        since,
    }).flatMap((p) => p.data.repository.ref?.target.history.nodes ?? []);
}

interface RunRow {
    databaseId: number;
    displayTitle: string;
    status: string;
    conclusion: string;
    updatedAt: string;
}

function runs(workflow: string, fromDay: string): RunRow[] {
    return JSON.parse(
        gh([
            "run",
            "list",
            "--workflow",
            workflow,
            "--created",
            `>=${fromDay}`,
            "--limit",
            "1000",
            "--json",
            "databaseId,displayTitle,status,conclusion,updatedAt",
        ])
    ) as RunRow[];
}

/** One file of a run's artifact, or `null` when the run has none. */
function artifactText(
    dir: string,
    runId: number,
    artifact: string,
    file: string
): string | null {
    const into = join(dir, `${artifact}-${runId}`);
    try {
        execFileSync(
            "gh",
            [
                "run",
                "download",
                String(runId),
                "--name",
                artifact,
                "--dir",
                into,
            ],
            { stdio: "ignore", env: netEnv() }
        );
        return readFileSync(join(into, file), "utf8");
    } catch {
        return null;
    }
}

function passRecords(
    dir: string,
    rows: readonly RunRow[]
): { passes: PassRecord[]; missing: number } {
    const passes: PassRecord[] = [];
    let missing = 0;
    for (const r of rows) {
        if (r.status !== "completed") continue;
        const text = artifactText(
            dir,
            r.databaseId,
            PASS_RECORD_ARTIFACT,
            "record.json"
        );
        const rec = text === null ? null : parsePassRecord(text);
        if (rec) passes.push(rec);
        else if (r.conclusion === "success" || r.conclusion === "failure")
            missing++;
    }
    return { passes, missing };
}

function queueRuns(dir: string, rows: readonly RunRow[]): QueueRun[] {
    const out: QueueRun[] = [];
    for (const r of rows) {
        // A cancelled draft was superseded (issue #6020): no verdict.
        if (r.status !== "completed" || r.conclusion === "cancelled") continue;
        const m = /Merge of #(\d+)/.exec(r.displayTitle);
        const rec = laneRecord(
            artifactText(dir, r.databaseId, QUEUE_LANE_ARTIFACT, "lane.json")
        );
        out.push({
            pr: m ? Number(m[1]) : null,
            conclusion: r.conclusion || null,
            updatedAt: r.updatedAt,
            ...rec,
        });
    }
    return out;
}

/** Every `machine.json` under `dir` (`gh run download` nests each artifact
 *  in its own directory). */
function machineReadings(dir: string | undefined): MachineReading[] {
    if (!dir) return [];
    const out: MachineReading[] = [];
    const walk = (d: string) => {
        let names: string[];
        try {
            names = readdirSync(d);
        } catch {
            return;
        }
        for (const n of names) {
            const p = join(d, n);
            if (statSync(p).isDirectory()) walk(p);
            else if (n === MACHINE_FILE) {
                const m = parseMachineReading(readFileSync(p, "utf8"));
                if (m) out.push(m);
            }
        }
    };
    walk(dir);
    return out;
}

function reportMain(): void {
    const days = Number(argOf("--days") ?? 7);
    if (!Number.isFinite(days) || days <= 0)
        die("--days is not a positive number");
    const toMs = argOf("--to") ? Date.parse(argOf("--to")!) : Date.now();
    if (!Number.isFinite(toMs)) die("--to is not a date");
    // Whole seconds: GitHub's search reads `2026-10-13T06:00:00Z`.
    const iso = (t: number) =>
        new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
    const window = { from: iso(toMs - days * 86_400_000), to: iso(toMs) };
    const range = `${window.from}..${window.to}`;
    // A RED episode open when the window starts must be seen opening.
    const before = iso(Date.parse(window.from) - 7 * 86_400_000);
    const repo = originRepo(primaryCheckout());
    const dir = mkdtempSync(join(tmpdir(), "weekly-report-"));
    let facts: TrendFacts;
    try {
        const pass = passRecords(
            dir,
            runs(PASS_WORKFLOW, window.from.slice(0, 10))
        );
        facts = {
            window,
            prs: prTimelines(repo, window.from),
            issuesOpened: issueCount(`repo:${repo} is:issue created:${range}`),
            issuesClosed: issueCount(`repo:${repo} is:issue closed:${range}`),
            history: baseHistory(repo, before),
            escalations: issueTitles(
                `repo:${repo} is:issue in:title "RED ladder stopped" created:>=${before}`
            ),
            flakyIssues: issueTitles(
                `repo:${repo} is:issue in:title "Flaky" created:${range}`
            ).filter((t) => /^Flaky (test|health step): /.test(t)),
            queueRuns: queueRuns(
                dir,
                runs(QUEUE_WORKFLOW, window.from.slice(0, 10))
            ),
            passes: pass.passes,
            passRecordsMissing: pass.missing,
            machines: machineReadings(argOf("--machines")),
        };
    } catch (e) {
        die(`GitHub could not be read: ${(e as Error).message.split("\n")[0]}`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
    const trends = weeklyTrends(facts);
    const json = argOf("--json");
    if (json) writeFileSync(json, `${JSON.stringify(trends, null, 2)}\n`);
    process.stdout.write(summaryMarkdown(trends));
}

if (import.meta.main) {
    if (process.argv[2] === "machine") machineMain();
    else reportMain();
}
