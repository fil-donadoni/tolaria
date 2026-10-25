#!/usr/bin/env bun
/**
 * `bun run issue:workflow-band <N>` — a workflow bug is `P0` (issue #6902).
 *
 * A bug in the pipeline itself holds every issue behind it, so it must not
 * wait at an inherited or missing band. The owner's ruling (2026-10-25,
 * ADR 0143 Amendment VII has the history): every OPEN issue labelled
 * both `bug` and `area:workflow` carries board `Priority` `P0`, set the moment
 * it is filed or labelled (`.github/workflows/issue-band.yml`).
 *
 * The second script that may write `P0` (ADR 0143, Amendment VII; the first
 * is `issue:inherit-band`, which only copies one). It overwrites a lower band
 * — the ruling ranks a workflow bug above whatever band it was born with — and
 * never clears or lowers one. Exit 0 with nothing written when the rule does
 * not apply; exit 1 on a failed read, write or read-back; exit 2 on bad
 * arguments.
 */

import {
    fetchBoardPriority,
    setBoardPriority,
    type BoardPriority,
} from "./lib/board-priority";
import { gh } from "./lib/gh";

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";

/** The two labels that make an issue a workflow bug. */
export const WORKFLOW_BUG_LABELS = ["bug", "area:workflow"] as const;

export type WorkflowBandPlan =
    | { kind: "write" }
    | { kind: "none"; reason: string };

/** What `issue:workflow-band` does for one issue. Pure. */
export function planWorkflowBand(issue: {
    state: string;
    labels: readonly string[];
    priority: BoardPriority | null;
}): WorkflowBandPlan {
    if (issue.state !== "OPEN") return { kind: "none", reason: "closed" };
    const missing = WORKFLOW_BUG_LABELS.filter(
        (l) => !issue.labels.includes(l)
    );
    if (missing.length > 0)
        return {
            kind: "none",
            reason: `not a workflow bug (no ${missing.map((l) => `\`${l}\``).join(", ")})`,
        };
    if (issue.priority === "P0") return { kind: "none", reason: "already P0" };
    return { kind: "write" };
}

function main(): void {
    const n = Number((process.argv[2] ?? "").replace(/^#/, ""));
    if (!Number.isInteger(n) || n <= 0) {
        console.error("usage: bun run issue:workflow-band <issue>");
        process.exit(2);
    }
    const target = {
        owner: PROJECT_OWNER,
        projectNumber: PROJECT_NUMBER,
        repo: PROJECT_REPO,
    };
    const readBand = (): BoardPriority | null =>
        fetchBoardPriority({
            ...target,
            onError: (message) => {
                throw new Error(message.split("\n")[0]);
            },
        })[n] ?? null;
    let plan: WorkflowBandPlan;
    try {
        const view = JSON.parse(
            gh([
                "issue",
                "view",
                String(n),
                "--repo",
                PROJECT_REPO,
                "--json",
                "state,labels",
            ])
        ) as { state: string; labels: { name: string }[] };
        plan = planWorkflowBand({
            state: view.state,
            labels: view.labels.map((l) => l.name),
            priority: readBand(),
        });
    } catch (err) {
        console.error(
            `issue:workflow-band: could not read issue #${n}: ${(err as Error).message}`
        );
        process.exit(1);
    }
    if (plan.kind === "none") {
        console.log(`issue:workflow-band: issue #${n} — ${plan.reason}`);
        return;
    }
    setBoardPriority(n, "P0", target);
    // Read back: the board can lag a write by a moment.
    let after: BoardPriority | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        after = readBand();
        if (after === "P0") break;
        Bun.sleepSync(1500);
    }
    if (after !== "P0") {
        console.error(
            `issue:workflow-band: wrote P0 on issue #${n} but the board reads ${after ?? "nothing"}`
        );
        process.exit(1);
    }
    console.log(`issue:workflow-band: issue #${n} ← P0 (workflow bug)`);
}

if (import.meta.main) main();
