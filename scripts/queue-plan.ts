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

import {
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "fs";
import { join } from "path";
import { gh } from "./lib/gh";
import {
    buildPlanRecord,
    planBatch,
    planFilename,
    type BoardPriority,
    type IssueDetail,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
} from "./lib/queue-plan";

const DEFAULTS = {
    cap: 4,
    // Deep enough to see the WHOLE queue, not a window of it.
    //
    // The loop's original query used `--limit 60`, and `gh issue list` returns
    // NEWEST first — so with 176 open `ready-for-agent` issues it saw #2077 to
    // #2190 and nothing else: 126 issues, back to #1215, were invisible to
    // every pass. The lineage sort was ordering a window that had already
    // excluded everything old, which is precisely the starvation the lineage
    // sort exists to prevent (issue #2188, measured 2026-08-04).
    //
    // Raising it is free NOW and was not before: the list is consumed inside
    // this process and only the plan crosses into the model's context. At the
    // old shape the same change would have cost ~27k tokens of context per
    // pass. Silent truncation of a `gh` query is a recurring class here — the
    // default `--limit` is 30, and the previous instance of this bug also
    // under-counted a queue.
    limit: 300,
    staleClaimHours: 24,
    // The tier for every issue carrying no `model:*` label — which, since
    // `model:sonnet` was retired as pure noise, is the VAST MAJORITY of the
    // queue rather than a residue. The tracker keeps only the escalation
    // labels (`model:opus`, `model:fable`), so "unlabelled" now means "default
    // tier", not "nobody triaged it".
    //
    // Consequence, and the reason this is spelled out: changing this value
    // silently re-routes the whole unlabelled queue. It is a fleet-wide cost
    // and quality change, not a default tweak — if you change it, review what
    // it re-routes rather than assuming the labelled issues are the affected
    // ones.
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

// ─────────────────────────────────────────────────────────────────────────────
// Board priority — the maintainer's live override.
//
// The `Priority` single-select on the GitHub Project board is the one input
// whose criteria change week to week, so it cannot live on the issues: baking a
// priority into 265 issues means every change of mind is 265 edits. It is read
// here, at pick time, and applied as the planner's zeroth sort key.
//
// Reading it is ONE call for the whole board, which is why `QueuePort.priority`
// is a map rather than a lookup — a per-issue call would invent the round-trip
// the two-stage design exists to avoid.
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";

/** Deep enough for the whole board with room to grow, because `gh project
 *  item-list` DEFAULTS TO 30 and returns the newest first. At the default the
 *  planner would see 30 of 265 items and read every older P0 as unprioritized —
 *  the same silent-truncation class that hid 126 issues from `gh issue list`
 *  (see the `limit` note above). The count is cross-checked below regardless:
 *  a limit is a guess, `totalCount` is the answer. */
const PROJECT_ITEM_LIMIT = 2000;

const VALID_PRIORITIES: readonly string[] = ["P0", "P1", "P2"];

interface ProjectItem {
    content?: { type?: string; number?: number; repository?: string };
    priority?: string;
}

function die(message: string): never {
    console.error(`✗ ${message}`);
    process.exit(2);
}

/**
 * Read the board's `Priority` column.
 *
 * FAIL-LOUD on every degraded read. Producing a plan without the priorities is
 * strictly worse than producing no plan: the batch looks completely normal, the
 * loop implements four issues in the wrong order, and nothing anywhere is red.
 * A stopped loop is a five-second fix; a silently mis-ordered one is invisible.
 * `--no-priority` is the explicit escape, and it announces itself.
 */
function fetchBoardPriority(): Record<number, BoardPriority> {
    if (process.argv.includes("--no-priority")) {
        console.error(
            "⚠ --no-priority: board priorities NOT applied; this plan uses the default order only"
        );
        return {};
    }

    let raw: string;
    try {
        raw = gh([
            "project",
            "item-list",
            PROJECT_NUMBER,
            "--owner",
            PROJECT_OWNER,
            "--format",
            "json",
            "--limit",
            String(PROJECT_ITEM_LIMIT),
        ]);
    } catch (err) {
        die(
            `cannot read project ${PROJECT_OWNER}/${PROJECT_NUMBER}: ${(err as Error).message}\n` +
                `  The board carries the Priority field the queue sorts on, so this plan would be\n` +
                `  silently mis-ordered. Fix the access — \`gh auth refresh -s read:project\` — or\n` +
                `  re-run with --no-priority to plan on the default order deliberately.`
        );
    }

    const items = (JSON.parse(raw) as { items?: ProjectItem[] }).items;
    if (!Array.isArray(items)) {
        die(
            "project item-list returned no `items` array — the CLI shape changed"
        );
    }

    // A limit is a guess; `totalCount` is the answer. If the board has grown
    // past the limit, say so rather than plan on the newest slice of it.
    const total = JSON.parse(
        gh([
            "project",
            "view",
            PROJECT_NUMBER,
            "--owner",
            PROJECT_OWNER,
            "--format",
            "json",
        ])
    ) as { items?: { totalCount?: number } };
    const expected = total.items?.totalCount;
    if (typeof expected === "number" && items.length < expected) {
        die(
            `project item-list returned ${items.length} of ${expected} items — truncated.\n` +
                `  Raise PROJECT_ITEM_LIMIT in scripts/queue-plan.ts.`
        );
    }

    const priority: Record<number, BoardPriority> = {};
    for (const item of items) {
        if (item.priority === undefined) continue;
        if (item.content?.type !== "Issue") continue;
        // Issue numbers are unique per REPO, not per board. A board that ever
        // gains a second repo would otherwise map #42 of one onto #42 of the
        // other — wrong, and silent.
        if (item.content.repository !== PROJECT_REPO) continue;
        const number = item.content.number;
        if (typeof number !== "number") continue;
        if (!VALID_PRIORITIES.includes(item.priority)) {
            die(
                `issue #${number} has Priority "${item.priority}", which the planner does not rank.\n` +
                    `  Known values: ${VALID_PRIORITIES.join(", ")}. Treating an unknown value as\n` +
                    `  "unprioritized" would DEMOTE the issue someone deliberately flagged, so add the\n` +
                    `  value to VALID_PRIORITIES and PRIORITY_RANK, or fix it on the board.`
            );
        }
        priority[number] = item.priority as BoardPriority;
    }
    return priority;
}

const detailCache = new Map<number, IssueDetail>();

const port: QueuePort = {
    issuesWithOpenPr: issuesWithOpenPr(),
    priority: fetchBoardPriority(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Plan artefact (issue #2518) — durable record of what THIS run produced, so
// a later audit can tell "planned batch" from "hand-picked claim". Written to
// `.claude/telemetry/plans/`, gitignored wholesale under `.claude/telemetry/`
// and pruned like the sibling `pass-markers` directory (deny-guard.sh §5).
//
// The session id is the join key `claim-ledger.sh` needs: it reads
// `.session_id` off its own hook payload for every claim, and that is the
// SAME id Claude Code exposes to a Bash tool call as `CLAUDE_CODE_SESSION_ID`
// — confirmed against this very run (the orchestrator's session id IS the
// `BATCH_ID` every subagent receipt is keyed by, see `scripts/lib/receipt.ts`
// "Batch-scoped, keyed by the orchestrator's SESSION id"). Falling back to
// empty string when the env var is absent (a manual, non-Claude-Code
// invocation) is deliberate — `planFilename` turns that into `"unknown"`
// rather than a guessed id that would falsely join to some other session's
// claims.
// ─────────────────────────────────────────────────────────────────────────────

const PLANS_RETENTION_DAYS = 7;

function pruneOldPlans(dir: string): void {
    const cutoff = Date.now() - PLANS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        const full = join(dir, name);
        try {
            if (statSync(full).mtimeMs < cutoff) {
                unlinkSync(full);
            }
        } catch {
            // best-effort — a prune failure must never fail the plan itself
        }
    }
}

/**
 * Write the durable plan artefact. Best-effort and never fatal: the plan
 * this process prints to stdout is the contract every caller relies on, and
 * a telemetry write failing must not take that down with it.
 */
function writePlanArtefact(plan: ReturnType<typeof planBatch>): void {
    try {
        const dir = join(process.cwd(), ".claude/telemetry/plans");
        mkdirSync(dir, { recursive: true });
        pruneOldPlans(dir);
        const session = process.env.CLAUDE_CODE_SESSION_ID ?? "";
        const noPriority = process.argv.includes("--no-priority");
        const record = buildPlanRecord(plan, session, config.now, noPriority);
        const file = join(dir, planFilename(session, config.now));
        writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
    } catch (err) {
        console.error(
            `⚠ could not write plan artefact: ${(err as Error).message}`
        );
    }
}

const plan = planBatch(issues, config, port);

writePlanArtefact(plan);

process.stdout.write(
    JSON.stringify(plan, null, process.argv.includes("--pretty") ? 2 : 0) + "\n"
);
