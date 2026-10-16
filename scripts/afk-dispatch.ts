#!/usr/bin/env bun
// `bun run afk:dispatch [--dry-run]` — the AFK dispatcher (issue #5649, PRD
// #5620, ADR 0156 Amendment I § The pass is dispatched, not just triggered).
//
// Run by `.github/workflows/afk-dispatch.yml`, one run at a time (its
// concurrency group), on a `pass` runner as the owner's user. It gathers the
// facts — the queue, the runners, the `afk-pass` and `afk-dispatch` runs, the
// passes' records, this machine's transcripts, the health verdict — and
// `lib/afk-dispatch.ts` decides; this file only reads and acts:
//
//   1. a HOLD (no pass workflow, failure streak, RED, usage limit, budget, no
//      free runner) dispatches nothing and exits 0 — "nothing to do"; the
//      first run that sees a failure streak exits 1, once, for the email;
//   2. orphan claims (a dead pass that pushed nothing) are released;
//   3. dead passes' pushed work is dispatched as `resume`, then fresh picks
//      are claimed (`in-progress`, re-read just before) and dispatched to
//      `afk-pass.yml` with their issue and model tier.
//
// `--dry-run` reads everything and prints the plan; it claims, releases and
// dispatches nothing. Nothing here prints Claude output or an issue body:
// the job log is public.

import { mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gh } from "./lib/gh";
import { primaryCheckout } from "./lib/primary-checkout";
import { sanitizeHost } from "./lib/github-runner";
import { releaseEditArgs, CLAIM_LABEL } from "./lib/claim-labels";
import { pick, type IssueProvenance } from "./lib/picker";
import type { PlanConfig } from "./lib/queue-plan";
import {
    DEFAULTS,
    liveQueuePort,
    readHealthMarker,
    readReadyQueue,
} from "./queue-plan";
import { readUsageWindow, DEFAULT_PROJECTS_DIR } from "./usage-window";
import {
    ACK_MARKER,
    PASS_RECORD_ARTIFACT,
    PASS_WORKFLOW,
    budgetReading,
    claimFacts,
    failureStreak,
    holdFor,
    hostOfRunnerName,
    lastPassRun,
    mayClaim,
    parsePassRecord,
    parseTrustedAuthors,
    passSlots,
    planDispatch,
    usageLimitResetAt,
    type BudgetConfig,
    type Dispatch,
    type OpenPr,
    type PassRecord,
    type RunnerRow,
    type WorkflowRun,
} from "./lib/afk-dispatch";

const DISPATCH_WORKFLOW = "afk-dispatch.yml";
const DRY_RUN = process.argv.includes("--dry-run");

function say(line: string): void {
    console.log(`afk-dispatch: ${line}`);
}

/** The job summary carries the decision, numbers only. */
function summary(lines: string[]): void {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (!file) return;
    try {
        appendFileSync(file, ["### afk-dispatch", "", ...lines, ""].join("\n"));
    } catch {
        // A summary that cannot be written is not a reason to fail the run.
    }
}

function repo(): string {
    const env = process.env.GITHUB_REPOSITORY;
    if (env) return env;
    return gh([
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
    ]).trim();
}

function envNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function workflowRuns(
    workflow: string,
    limit: number,
    filter: string[] = []
): WorkflowRun[] {
    const rows = JSON.parse(
        gh([
            "run",
            "list",
            "--workflow",
            workflow,
            ...filter,
            "--limit",
            String(limit),
            "--json",
            "databaseId,displayTitle,status,conclusion,createdAt,updatedAt",
        ])
    ) as {
        databaseId: number;
        displayTitle: string;
        status: string;
        conclusion: string | null;
        createdAt: string;
        updatedAt: string;
    }[];
    return rows.map((r) => ({
        id: r.databaseId,
        title: r.displayTitle,
        status: r.status,
        conclusion: r.conclusion || null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    }));
}

/** `afk-pass.yml` exists on the default branch and is enabled. */
function passWorkflowActive(slug: string): boolean {
    try {
        const state = gh([
            "api",
            `repos/${slug}/actions/workflows/${PASS_WORKFLOW}`,
            "--jq",
            ".state",
        ]).trim();
        return state === "active";
    } catch {
        return false;
    }
}

/** The records of the pass runs that ended inside the window. A run with no
 *  artifact (it died before writing one) or a torn one is skipped. */
function passRecords(
    runs: readonly WorkflowRun[],
    sinceMs: number
): PassRecord[] {
    const dir = mkdtempSync(join(tmpdir(), "afk-dispatch-"));
    try {
        const out: PassRecord[] = [];
        for (const r of runs) {
            if (r.status !== "completed" || Date.parse(r.updatedAt) < sinceMs)
                continue;
            const into = join(dir, String(r.id));
            try {
                execFileSync(
                    "gh",
                    [
                        "run",
                        "download",
                        String(r.id),
                        "--name",
                        PASS_RECORD_ARTIFACT,
                        "--dir",
                        into,
                    ],
                    { stdio: "ignore" }
                );
                const rec = parsePassRecord(
                    readFileSync(join(into, "record.json"), "utf8")
                );
                if (rec) out.push(rec);
            } catch {
                // No artifact: nothing to add.
            }
        }
        return out;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function runners(slug: string): RunnerRow[] {
    const lines = gh([
        "api",
        "--paginate",
        `repos/${slug}/actions/runners`,
        "--jq",
        ".runners[] | {name, status, busy, labels: [.labels[].name]} | @json",
    ]);
    return lines
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as RunnerRow);
}

function pushedBranches(): string[] {
    const out = execFileSync("git", ["ls-remote", "--heads", "origin"], {
        encoding: "utf8",
    });
    return out
        .split("\n")
        .map((l) => l.split("\t")[1] ?? "")
        .filter((r) => r.startsWith("refs/heads/"))
        .map((r) => r.slice("refs/heads/".length));
}

function openPrs(): OpenPr[] {
    const rows = JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            "200",
            "--json",
            "number,headRefName,labels",
        ])
    ) as { number: number; headRefName: string; labels: { name: string }[] }[];
    return rows.map((r) => ({
        number: r.number,
        headRefName: r.headRefName,
        labels: r.labels.map((l) => l.name),
    }));
}

/** Who opened each queued issue; who applied `ready-for-agent` is read only
 *  for an issue whose author the policy does not already trust. */
function provenance(
    slug: string,
    numbers: readonly number[],
    trusted: (login: string) => boolean
): Record<number, IssueProvenance> {
    const authors = new Map<number, string | null>();
    const rows = JSON.parse(
        gh([
            "issue",
            "list",
            "--label",
            "ready-for-agent",
            "--state",
            "open",
            "--limit",
            String(Math.max(DEFAULTS.limit, numbers.length + 50)),
            "--json",
            "number,author",
        ])
    ) as { number: number; author: { login: string } | null }[];
    for (const r of rows) authors.set(r.number, r.author?.login ?? null);
    const out: Record<number, IssueProvenance> = {};
    for (const n of numbers) {
        const author = authors.get(n) ?? null;
        let readyBy: string | null = null;
        if (author === null || !trusted(author)) {
            try {
                const actors = gh([
                    "api",
                    "--paginate",
                    `repos/${slug}/issues/${n}/events`,
                    "--jq",
                    '.[] | select(.event == "labeled" and .label.name == "ready-for-agent") | .actor.login',
                ])
                    .split("\n")
                    .filter((l) => l.trim() !== "");
                readyBy = actors.length ? actors[actors.length - 1] : null;
            } catch {
                readyBy = null;
            }
        }
        out[n] = { author, readyBy };
    }
    return out;
}

/** The host of a dead pass's last run, from the runner that ran its job. */
function hostOfRun(slug: string, runId: number): string | null {
    try {
        const name = gh([
            "api",
            `repos/${slug}/actions/runs/${runId}/jobs`,
            "--jq",
            ".jobs[0].runner_name // empty",
        ]).trim();
        return name ? hostOfRunnerName(name) : null;
    } catch {
        return null;
    }
}

function labelsOf(issue: number): string[] {
    const raw = JSON.parse(
        gh(["issue", "view", String(issue), "--json", "labels"])
    ) as {
        labels: { name: string }[];
    };
    return raw.labels.map((l) => l.name);
}

function dispatchPass(d: Dispatch): void {
    gh([
        "workflow",
        "run",
        PASS_WORKFLOW,
        "-f",
        `issue=${d.issue}`,
        "-f",
        `model=${d.model}`,
        "-f",
        `resume=${d.resume}`,
        "-f",
        `host=${d.host ?? ""}`,
    ]);
}

async function main(): Promise<void> {
    const slug = repo();
    const owner = process.env.GITHUB_REPOSITORY_OWNER ?? slug.split("/")[0];
    const now = Date.now();
    const budget: BudgetConfig = {
        budget: envNumber("AFK_TOKEN_BUDGET", 0),
        maxPct: envNumber("AFK_BUDGET_MAX_PCT", 80),
        hours: envNumber("AFK_BUDGET_HOURS", 5),
    };
    const sinceMs = now - budget.hours * 3_600_000;
    const selfRunner = process.env.RUNNER_NAME ?? null;
    const thisHost =
        (selfRunner && hostOfRunnerName(selfRunner)) ||
        sanitizeHost(hostname());

    // ── holds: everything below is cheap next to a queue read ──
    const active = passWorkflowActive(slug);
    const passRuns = active ? workflowRuns(PASS_WORKFLOW, 200) : [];
    // Only two kinds of dispatcher run matter to the streak: the owner's acks
    // (always a dispatch) and the failed runs (the email already sent). Read
    // by filter, so a burst of skipped label-event runs never pushes either
    // out of the window.
    const dispatchRuns = [
        ...workflowRuns(DISPATCH_WORKFLOW, 100, [
            "--event",
            "workflow_dispatch",
        ]),
        ...workflowRuns(DISPATCH_WORKFLOW, 20, ["--status", "failure"]),
    ];
    const records = active ? passRecords(passRuns, sinceMs) : [];
    const local = active
        ? (await readUsageWindow(DEFAULT_PROJECTS_DIR, sinceMs)).models
        : {};
    const reading = budgetReading(
        local,
        records,
        thisHost,
        sinceMs,
        budget.budget
    );
    const hold = holdFor({
        passWorkflowActive: active,
        streak: failureStreak(passRuns, dispatchRuns),
        red: readHealthMarker(primaryCheckout()),
        usageLimitResetAt: usageLimitResetAt(records, now),
        budget,
        reading,
    });
    const budgetLine = `budget ${reading.pct.toFixed(1)}% of ${budget.budget} over ${budget.hours} h (other machines ${Math.round(reading.remote)})`;
    if (hold) {
        say(`hold (${hold.kind}): ${hold.message}`);
        summary([`**hold** \`${hold.kind}\`: ${hold.message}`, "", budgetLine]);
        if (hold.kind === "failure-streak" && hold.notify) {
            say(
                `failing this run once so GitHub emails the owner; acknowledge with "${ACK_MARKER}" (ack_failures=true)`
            );
            process.exit(1);
        }
        return;
    }

    const slots = passSlots(runners(slug), selfRunner, passRuns);
    if (slots.free.length === 0) {
        say("nothing to do: no free pass runner");
        summary(["nothing to do: no free `pass` runner", "", budgetLine]);
        return;
    }

    // ── pick ──
    const issues = readReadyQueue();
    const trust = {
        owner,
        trustedAuthors: parseTrustedAuthors(process.env.TRUSTED_AUTHORS),
    };
    const trusted = (login: string) =>
        login === trust.owner || trust.trustedAuthors.includes(login);
    const claimed = issues
        .filter((i) => i.labels.some((l) => l.name === CLAIM_LABEL))
        .map((i) => i.number);
    const config: PlanConfig = {
        batchCap: slots.free.length,
        staleClaimHours: DEFAULTS.staleClaimHours,
        defaultImplModel: DEFAULTS.defaultImplModel,
        now: new Date(now).toISOString(),
        excludeHitl: true,
    };
    const picked = pick({
        issues,
        config,
        port: liveQueuePort(),
        trust,
        provenance: provenance(
            slug,
            issues.map((i) => i.number),
            trusted
        ),
        claims: claimFacts(claimed, passRuns, pushedBranches(), openPrs()),
    });
    const plan = planDispatch(picked, slots, (issue) => {
        const last = lastPassRun(passRuns, issue);
        return last ? hostOfRun(slug, last.id) : null;
    });

    const lines = [
        `free pass slots: ${slots.free.length} (${slots.free.join(", ")})`,
        `release: ${plan.release.map((n) => `#${n}`).join(", ") || "none"}`,
        `dispatch: ${plan.dispatch.map((d) => `#${d.issue} ${d.model}${d.resume ? " resume" : ""}${d.host ? ` @${d.host}` : ""}`).join(", ") || "none"}`,
        `resume waiting for its host: ${plan.waiting.map((n) => `#${n}`).join(", ") || "none"}`,
        `untrusted, skipped: ${picked.untrusted.length}`,
        budgetLine,
    ];
    for (const l of lines) say(l);
    if (DRY_RUN) {
        say("dry run — nothing claimed, released or dispatched");
        return;
    }

    // ── act ──
    const done: string[] = [];
    for (const n of plan.release) {
        gh(releaseEditArgs(n));
        done.push(`released #${n}`);
    }
    for (const d of plan.dispatch) {
        if (!d.resume) {
            if (!mayClaim(labelsOf(d.issue))) {
                done.push(`#${d.issue} claimed meanwhile — skipped`);
                continue;
            }
            gh([
                "issue",
                "edit",
                String(d.issue),
                "--add-label",
                CLAIM_LABEL,
                "--add-assignee",
                "@me",
            ]);
        }
        try {
            dispatchPass(d);
            done.push(
                `dispatched #${d.issue} (${d.model}${d.resume ? ", resume" : ""})`
            );
        } catch (err) {
            // A claim with no run behind it would read as an orphan next
            // time anyway; undo it now rather than leave it a sweep long.
            if (!d.resume) gh(releaseEditArgs(d.issue));
            done.push(
                `#${d.issue} dispatch failed: ${(err as Error).message.split("\n")[0]}`
            );
        }
    }
    for (const l of done) say(l);
    summary([...lines.map((l) => `- ${l}`), "", ...done.map((l) => `- ${l}`)]);
}

if (import.meta.main) {
    main().catch((err: unknown) => {
        console.error(
            `afk-dispatch: ${(err as Error)?.message ?? String(err)}`
        );
        process.exit(1);
    });
}
