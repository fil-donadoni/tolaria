// heartbeat — the pipeline's fallback clock (issue #7445, ADR 0156 Amendment
// IV): dispatch `afk-dispatch.yml` and health's `gate` when GitHub dropped
// their schedules. Run every ten minutes by the `com.tolaria.heartbeat`
// launchd agent / `tolaria-heartbeat.timer` (`bun run runner install`); the
// decisions are scripts/lib/heartbeat.ts.
//
//   bun run heartbeat [--dry-run]
//
// Also flags a silent queue stall (issue #9065): a pr-gate / owner-merge
// `startup_failure`, or a queued PR with no `trusted-author` status.
//
// Writes the tick to ~/.cache/tolaria/heartbeat/last.json (`bun run runner status`
// prints it). Exits 1 when a read or a dispatch
// failed, so the service manager's status shows it; otherwise 0.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
import { deploymentSizes, WEDGE_THRESHOLD_MS } from "./lib/convex-wedge";
import { gh } from "./lib/gh";
import { RUN_IN_FLIGHT_MAX_MS } from "./lib/health-batch-due";
import { pivotRunInFlight } from "./lib/health-pivot";
import {
    machineName,
    originRepo,
    verdictStore,
} from "./lib/health-verdict-store";
import {
    HEARTBEAT_STATE,
    heartbeatLines,
    type ConvexOutcome,
    QUEUE_GATE_WORKFLOWS,
    settlesTip,
    tick,
    type QueuedPrFact,
    type RunFact,
    type WorkflowClock,
} from "./lib/heartbeat";
import { primaryCheckout } from "./lib/primary-checkout";

const root = primaryCheckout();
const repo = originRepo(root);
const dryRun = process.argv.includes("--dry-run");

function clock(workflow: string): WorkflowClock {
    const state = gh([
        "api",
        `repos/${repo}/actions/workflows/${workflow}`,
        "--jq",
        ".state",
    ]).trim();
    const runs = JSON.parse(
        gh([
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            workflow,
            "--limit",
            // Skipped label runs crowd the list (several an hour).
            "20",
            "--json",
            "createdAt,status,conclusion",
        ])
    ) as RunFact[];
    return { active: state === "active", runs };
}

/** Per tick: 2 run lists + 1 PR list + 1 status read per queued PR. */
function queueGateFacts() {
    const workflows = QUEUE_GATE_WORKFLOWS.map((workflow) => ({
        workflow,
        runs: JSON.parse(
            gh([
                "run",
                "list",
                "--repo",
                repo,
                "--workflow",
                workflow,
                "--limit",
                "30",
                "--json",
                "createdAt,status,conclusion,url",
            ])
        ) as RunFact[],
    }));
    const open = JSON.parse(
        gh([
            "pr",
            "list",
            "--repo",
            repo,
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,headRefName,headRefOid,labels,updatedAt",
        ])
    ) as {
        number: number;
        headRefName: string;
        headRefOid: string;
        labels: { name: string }[];
        updatedAt: string;
    }[];
    const prs: QueuedPrFact[] = open
        .filter(
            (p) =>
                p.headRefName.startsWith("mergify/merge-queue/") ||
                p.labels.some((l) => l.name === "ready-to-land")
        )
        .map((p) => {
            const contexts = gh([
                "api",
                `repos/${repo}/commits/${p.headRefOid}/statuses?per_page=100`,
                "--jq",
                '[.[].context] | join("\\n")',
            ])
                .trim()
                .split("\n");
            return {
                number: p.number,
                sha: p.headRefOid.slice(0, 8),
                hasTrustedAuthor: contexts.includes("trusted-author"),
                updatedAt: p.updatedAt,
            };
        });
    return { workflows, prs };
}

/** Issue #9227: `convex:ensure` with the wedge probe restarts an answering
 *  but wedged service (a down one is its ordinary job, so it starts that too);
 *  the sizes are stat calls. A machine with no local deployment is `skipped`. */
function convexTick(): ConvexOutcome {
    if (!process.env.CONVEX_DEPLOYMENT?.startsWith("local:") && !localEnv()) {
        return { probe: "skipped", detail: "no local deployment" };
    }
    const sizes = deploymentSizes(root, Date.now());
    if (dryRun) return { probe: "skipped", detail: "dry run", sizes };
    const r = spawnSync(
        "bun",
        [
            "scripts/convex-ensure.ts",
            "--start-timeout-ms",
            "60000",
            "--wedge-threshold-ms",
            String(WEDGE_THRESHOLD_MS),
        ],
        { cwd: root, encoding: "utf8", timeout: 5 * 60_000 }
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").pop();
    if (r.status !== 0) {
        return { probe: "failed", detail: out || r.error?.message, sizes };
    }
    return {
        probe: /was wedged/.test(r.stdout ?? "") ? "restarted" : "ok",
        detail: /was wedged/.test(r.stdout ?? "") ? out : undefined,
        sizes,
    };
}

function readEnvText(dir: string): string {
    try {
        return readFileSync(`${dir}/.env.local`, "utf8");
    } catch {
        return "";
    }
}

function localEnv(): boolean {
    return /^\s*CONVEX_DEPLOYMENT\s*=\s*["']?local:/m.test(readEnvText(root));
}

const state = tick({
    host: machineName(),
    now: Date.now,
    dryRun,
    afkDispatchClock: () => clock("afk-dispatch.yml"),
    healthFacts: () => {
        const tip = gh([
            "api",
            `repos/${repo}/commits/${BASE_BRANCH}`,
            "--jq",
            ".sha",
        ]).trim();
        return {
            ...clock("health.yml"),
            tip: tip.slice(0, 8),
            tipHasVerdict: settlesTip(verdictStore(root).read(tip)?.status),
            pivotInFlight:
                pivotRunInFlight(root, Date.now(), RUN_IN_FLIGHT_MAX_MS) !==
                null,
        };
    },
    queueGateFacts,
    convexTick,
    // No `--ref`: the default branch, as afk-pass.yml dispatches it.
    dispatchAfk: () =>
        void gh(["workflow", "run", "afk-dispatch.yml", "--repo", repo]),
    dispatchHealthGate: () =>
        void gh([
            "workflow",
            "run",
            "health.yml",
            "--repo",
            repo,
            "--ref",
            BASE_BRANCH,
            "-f",
            "job=gate",
        ]),
});

const text = `${JSON.stringify(state, null, 4)}\n`;
if (!dryRun) {
    mkdirSync(dirname(HEARTBEAT_STATE), { recursive: true });
    writeFileSync(HEARTBEAT_STATE, text);
}
for (const line of heartbeatLines(text, Date.parse(state.at)))
    console.log(line.trimStart());
// A flag is a failure too (issue #9065): the service status shows a stalled queue.
process.exit(
    state.convex?.probe === "failed" ||
        state.afkDispatch.error ||
        state.health.error ||
        state.queueGate?.error ||
        state.queueGate?.flags.length
        ? 1
        : 0
);
