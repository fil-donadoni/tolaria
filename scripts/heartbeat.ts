// heartbeat — the pipeline's fallback clock (issue #7445, ADR 0156 Amendment
// IV): dispatch `afk-dispatch.yml` and health's `gate` when GitHub dropped
// their schedules. Run every ten minutes by the `com.tolaria.heartbeat`
// launchd agent / `tolaria-heartbeat.timer` (`bun run runner install`); the
// decisions are scripts/lib/heartbeat.ts.
//
//   bun run heartbeat [--dry-run]
//
// Writes the tick to ~/.cache/tolaria/heartbeat/last.json (`bun run runner status`
// prints it). Exits 1 when a read or a dispatch
// failed, so the service manager's status shows it; otherwise 0.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
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
    settlesTip,
    tick,
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
process.exit(state.afkDispatch.error || state.health.error ? 1 : 0);
