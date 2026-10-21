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
//       also writes the trends.
//
// `gatherFacts` and `readMachine` are this file's reads as functions:
// `bun run cockpit` (`scripts/cockpit.ts`) calls them for a window ending
// now, with an artifact cache that survives between its runs.
//
// Exit code: 0 on a report, 1 when GitHub could not be read — a reporter,
// never a gate. Nothing here prints Claude output or an issue body: the job
// log is public.

import { execFile, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { promisify } from "node:util";
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
    type TrendWindow,
} from "./lib/workflow-trends";

/** The artifact `queue-lane.yml` uploads its `lane.json` as. */
export const QUEUE_LANE_ARTIFACT = "queue-lane-json";
const QUEUE_WORKFLOW = "queue-lane.yml";
/** The label of the queue the drain forecast counts. */
const READY_FOR_AGENT = "ready-for-agent";
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
        // Explicit: Bun hands a child the environment the process STARTED
        // with, not `process.env` as `bun run cockpit` amended it.
        env: process.env,
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

/** THIS machine's reading of the last seven days. */
export function readMachine(host: string): MachineReading {
    const budget = telemetryJson("scripts/telemetry-budget.ts");
    const latency = telemetryJson("scripts/telemetry-latency.ts");
    return {
        host,
        budget: budget.json,
        latency: latency.json,
        errors: {
            ...(budget.error ? { budget: budget.error } : {}),
            ...(latency.error ? { latency: latency.error } : {}),
        },
    };
}

function machineMain(): void {
    const out = argOf("--out");
    if (!out) die("machine needs --out <file>");
    const reading = readMachine(
        hostOfRunnerName(process.env.RUNNER_NAME ?? "") ??
            sanitizeHost(hostname())
    );
    writeFileSync(out, `${JSON.stringify(reading)}\n`);
    console.log(
        `weekly-report: machine reading written (budget ${reading.errors.budget ? "none" : "ok"}, latency ${reading.errors.latency ? "none" : "ok"})`
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

const PRS_QUERY = `query($q:String!,$endCursor:String){search(type:ISSUE,query:$q,first:50,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{number mergedAt timelineItems(last:100,itemTypes:[LABELED_EVENT,ISSUE_COMMENT,PULL_REQUEST_COMMIT,HEAD_REF_FORCE_PUSHED_EVENT]){nodes{__typename ... on LabeledEvent{createdAt label{name}} ... on IssueComment{createdAt body} ... on PullRequestCommit{commit{committedDate}} ... on HeadRefForcePushedEvent{createdAt}}}}}}}`;

/** The PRs updated since `from`, one search per day: a search answers at
 *  most 1000 results, and a week at the queue's ceiling updates more. A PR
 *  updated on two days is read once — its newest timeline wins. */
function prTimelines(repo: string, from: string, to: string): PrTimeline[] {
    type Page = { data: { search: { nodes: PrTimeline[] } } };
    const byNumber = new Map<number, PrTimeline>();
    const iso = (t: number) =>
        new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
    for (let t = Date.parse(from); t < Date.parse(to); t += 86_400_000) {
        // The last day is open-ended: a PR updated since the window's end
        // still carries the window's events.
        const end =
            t + 86_400_000 >= Date.parse(to) ? "*" : iso(t + 86_400_000);
        for (const page of graphqlPages<Page>(PRS_QUERY, {
            q: `repo:${repo} is:pr updated:${iso(t)}..${end}`,
        }))
            for (const n of page.data.search.nodes)
                if (n.number) byNumber.set(n.number, n);
    }
    return [...byNumber.values()];
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

const execFileAsync = promisify(execFile);

/** How many `gh run download`s run at once: ~1.2 s each, and a week of the
 *  queue's ceiling is hundreds of runs. */
const DOWNLOADS_AT_ONCE = 8;

/** `fn` over `items`, at most `n` at a time, results in `items`' order. */
async function pooled<T, R>(
    items: readonly T[],
    n: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(n, items.length) }, worker)
    );
    return out;
}

/** One file of a run's artifact, or `null` when the run has none. A
 *  completed run's artifact never changes, so a file already under `dir` is
 *  read, not downloaded again. */
async function artifactText(
    dir: string,
    runId: number,
    artifact: string,
    file: string
): Promise<string | null> {
    const into = join(dir, `${artifact}-${runId}`);
    const path = join(into, file);
    if (!existsSync(path)) {
        try {
            await execFileAsync(
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
                { env: netEnv() }
            );
        } catch {
            return null;
        }
    }
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

async function passRecords(
    dir: string,
    rows: readonly RunRow[]
): Promise<{ passes: PassRecord[]; missing: number }> {
    const done = rows.filter((r) => r.status === "completed");
    const texts = await pooled(done, DOWNLOADS_AT_ONCE, (r) =>
        artifactText(dir, r.databaseId, PASS_RECORD_ARTIFACT, "record.json")
    );
    const passes: PassRecord[] = [];
    let missing = 0;
    done.forEach((r, i) => {
        const text = texts[i];
        const rec = text === null ? null : parsePassRecord(text);
        if (rec) passes.push(rec);
        else if (r.conclusion === "success" || r.conclusion === "failure")
            missing++;
    });
    return { passes, missing };
}

async function queueRuns(
    dir: string,
    rows: readonly RunRow[]
): Promise<QueueRun[]> {
    // A cancelled draft was superseded (issue #6020): no verdict.
    const done = rows.filter(
        (r) => r.status === "completed" && r.conclusion !== "cancelled"
    );
    const texts = await pooled(done, DOWNLOADS_AT_ONCE, (r) =>
        artifactText(dir, r.databaseId, QUEUE_LANE_ARTIFACT, "lane.json")
    );
    return done.map((r, i) => {
        const m = /Merge of #(\d+)/.exec(r.displayTitle);
        return {
            pr: m ? Number(m[1]) : null,
            conclusion: r.conclusion || null,
            updatedAt: r.updatedAt,
            ...laneRecord(texts[i]),
        };
    });
}

/** Each issue's `area:*` label, the prefix cut — one aliased read per 50
 *  issues. A batch GitHub cannot answer leaves its issues without an area. */
function issueAreas(
    repo: string,
    issues: readonly number[]
): Record<number, string> {
    const [owner, name] = repo.split("/");
    const out: Record<number, string> = {};
    const unique = [...new Set(issues)];
    for (let i = 0; i < unique.length; i += 50) {
        const batch = unique.slice(i, i + 50);
        const fields = batch
            .map(
                (n) =>
                    `i${n}: issue(number:${n}){labels(first:30){nodes{name}}}`
            )
            .join(" ");
        type Answer = {
            data: {
                repository: Record<
                    string,
                    { labels: { nodes: { name: string }[] } } | null
                >;
            };
        };
        let answer: Answer;
        try {
            answer = JSON.parse(
                gh([
                    "api",
                    "graphql",
                    "-f",
                    `query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${fields}}}`,
                    "-F",
                    `owner=${owner}`,
                    "-F",
                    `name=${name}`,
                ])
            ) as Answer;
        } catch {
            continue;
        }
        for (const n of batch) {
            const area = answer.data.repository[`i${n}`]?.labels.nodes
                .map((l) => l.name)
                .filter((l) => l.startsWith("area:"))
                .sort()[0];
            if (area) out[n] = area.slice("area:".length);
        }
    }
    return out;
}

/** Every `machine.json` under `dir` (`gh run download` nests each artifact
 *  in its own directory). */
export function machineReadings(dir: string | undefined): MachineReading[] {
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

/** The `days` before `toMs`, in whole seconds — GitHub's search reads
 *  `2026-10-13T06:00:00Z`. */
export function windowEnding(toMs: number, days: number): TrendWindow {
    const iso = (t: number) =>
        new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
    return { from: iso(toMs - days * 86_400_000), to: iso(toMs) };
}

export interface GatherOptions {
    window: TrendWindow;
    machines: MachineReading[];
    /** Where run artifacts are kept between calls; without it, a temporary
     *  directory removed on return. */
    artifactCache?: string;
}

/** Every fact the trends read, from GitHub. Throws when GitHub cannot be
 *  read. */
export async function gatherFacts(opts: GatherOptions): Promise<TrendFacts> {
    const { window } = opts;
    const range = `${window.from}..${window.to}`;
    // A RED episode open when the window starts must be seen opening.
    const before = new Date(Date.parse(window.from) - 7 * 86_400_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z");
    const repo = originRepo(primaryCheckout());
    const dir =
        opts.artifactCache ?? mkdtempSync(join(tmpdir(), "weekly-report-"));
    try {
        const fromDay = window.from.slice(0, 10);
        const [pass, queue] = await Promise.all([
            passRecords(dir, runs(PASS_WORKFLOW, fromDay)),
            queueRuns(dir, runs(QUEUE_WORKFLOW, fromDay)),
        ]);
        return {
            window,
            prs: prTimelines(repo, window.from, window.to),
            issuesOpened: issueCount(`repo:${repo} is:issue created:${range}`),
            issuesClosed: issueCount(`repo:${repo} is:issue closed:${range}`),
            history: baseHistory(repo, before),
            escalations: issueTitles(
                `repo:${repo} is:issue in:title "RED ladder stopped" created:>=${before}`
            ),
            flakyIssues: issueTitles(
                `repo:${repo} is:issue in:title "Flaky" created:${range}`
            ).filter((t) => /^Flaky (test|health step): /.test(t)),
            queueRuns: queue,
            passes: pass.passes,
            passRecordsMissing: pass.missing,
            machines: opts.machines,
            readyForAgent: issueCount(
                `repo:${repo} is:issue is:open label:${READY_FOR_AGENT}`
            ),
            issueAreas: issueAreas(
                repo,
                pass.passes.map((p) => p.issue)
            ),
        };
    } finally {
        if (opts.artifactCache === undefined)
            rmSync(dir, { recursive: true, force: true });
    }
}

async function reportMain(): Promise<void> {
    const days = Number(argOf("--days") ?? 7);
    if (!Number.isFinite(days) || days <= 0)
        die("--days is not a positive number");
    const toMs = argOf("--to") ? Date.parse(argOf("--to")!) : Date.now();
    if (!Number.isFinite(toMs)) die("--to is not a date");
    let facts: TrendFacts;
    try {
        facts = await gatherFacts({
            window: windowEnding(toMs, days),
            machines: machineReadings(argOf("--machines")),
        });
    } catch (e) {
        die(`GitHub could not be read: ${(e as Error).message.split("\n")[0]}`);
    }
    const trends = weeklyTrends(facts);
    const json = argOf("--json");
    if (json) writeFileSync(json, `${JSON.stringify(trends, null, 2)}\n`);
    process.stdout.write(summaryMarkdown(trends));
}

if (import.meta.main) {
    if (process.argv[2] === "machine") machineMain();
    else
        reportMain().catch((e: unknown) =>
            die((e as Error).message.split("\n")[0])
        );
}
