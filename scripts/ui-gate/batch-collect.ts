/**
 * `bun run check:ui:batch` — the collector (issue #9122): every open PR
 * wearing `ui-owed` is walked in ONE `check:ui --batch=… --write-receipts`.
 * The decision per PR is pure (`planCollect`); this file is the gh glue.
 *
 *   CLEAN     → `ui-owed` removed, `land:ready <PR#>` run (it carries the
 *               receipt the batch wrote into the body);
 *   RED       → `ui-owed` removed, `land-failed` added, red lines commented;
 *   DROPPED / UNPROVEN → stays `ui-owed`, a comment says why;
 *   no outcome (the walk was cut short: infra exit) → nothing touched.
 *
 * Runs on the lane machine (local Convex deployment, ADR 0156 lane slot).
 * Trigger: by hand, no arguments (a workflow is a follow-up). `land:ready`
 * runs in a throwaway worktree of each PR's pushed head. A refusal there is
 * commented and the label stays off. Exit: the batch's own code.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FAILED_LABEL, UI_OWED_LABEL } from "../lib/land-labels.ts";
import { gh } from "../lib/gh.ts";
import { runBatch, type BatchOutcome } from "./batch-run.ts";

export type CollectAction =
    | { kind: "land"; pr: number }
    | { kind: "fail"; pr: number; comment: string }
    | { kind: "hold"; pr: number; comment: string };

/** The action each PR of a settled batch gets. Pure. */
export function planCollect(outcome: BatchOutcome): CollectAction[] {
    const actions: CollectAction[] = [];
    for (const pr of outcome.clean) actions.push({ kind: "land", pr });
    for (const [pr, red] of outcome.red) {
        actions.push({
            kind: "fail",
            pr,
            comment: `check:ui batch walk: RED\n\n\`\`\`\n${red.join("\n")}\n\`\`\``,
        });
    }
    for (const { pr, reason } of outcome.dropped) {
        actions.push({
            kind: "hold",
            pr,
            comment: `check:ui batch walk: #${pr} was DROPPED — ${reason}. It stays \`${UI_OWED_LABEL}\`; rebase it, or walk it alone with \`bun run check:ui\`.`,
        });
    }
    for (const pr of outcome.unproven) {
        actions.push({
            kind: "hold",
            pr,
            comment: `check:ui batch walk: #${pr} is UNPROVEN — a red surface of its scope is owned by no single PR. It stays \`${UI_OWED_LABEL}\`; walk it alone with \`bun run check:ui\`.`,
        });
    }
    return actions;
}

function owedPrs(): number[] {
    return (
        JSON.parse(
            gh([
                "pr",
                "list",
                "--label",
                UI_OWED_LABEL,
                "--state",
                "open",
                "--json",
                "number",
                "--limit",
                "50",
            ])
        ) as { number: number }[]
    )
        .map((p) => p.number)
        .sort((a, b) => a - b);
}

function comment(pr: number, body: string): void {
    gh(["pr", "comment", String(pr), "--body", body]);
}

function apply(action: CollectAction, log: (m: string) => void): void {
    const pr = String(action.pr);
    if (action.kind === "hold") {
        comment(action.pr, action.comment);
        return;
    }
    gh(["pr", "edit", pr, "--remove-label", UI_OWED_LABEL]);
    if (action.kind === "fail") {
        gh(["pr", "edit", pr, "--add-label", FAILED_LABEL]);
        comment(action.pr, action.comment);
        return;
    }
    const refusal = landFromPrHead(action.pr);
    if (refusal !== null) {
        // The walk is done and its receipt is in the body: the label stays
        // off (it would block the very `land:ready` that fixes the cause).
        comment(
            action.pr,
            `check:ui batch walk: CLEAN, receipt written, but \`land:ready\` refused:\n\n\`\`\`\n${refusal}\n\`\`\`\nFix the cause and run \`bun run land:ready ${pr}\` from the PR's worktree.`
        );
        log(`collect: land:ready ${pr} refused — commented, #${pr} not queued`);
    }
}

/** `land:ready` must run in a checkout of the PR's pushed head: a throwaway
 *  detached worktree, bootstrapped. Returns the refusal output, or null. */
function landFromPrHead(pr: number): string | null {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ui-collect-${pr}-`));
    const run = (cmd: string, args: string[], cwd: string) =>
        spawnSync(cmd, args, { cwd, encoding: "utf8" });
    try {
        const fetched = run(
            "git",
            ["fetch", "--quiet", "origin", `pull/${pr}/head`],
            process.cwd()
        );
        const add =
            fetched.status === 0
                ? run(
                      "git",
                      ["worktree", "add", "--detach", dir, "FETCH_HEAD"],
                      process.cwd()
                  )
                : fetched;
        if (add.status !== 0) return `could not check out pull/${pr}/head`;
        const init = run("bun", ["run", "worktree:init"], dir);
        if (init.status !== 0) return "worktree:init failed";
        const r = run("bun", ["run", "land:ready", String(pr)], dir);
        if (r.status === 0) return null;
        return `${r.stdout}${r.stderr}`
            .trim()
            .split("\n")
            .slice(-15)
            .join("\n");
    } finally {
        run("git", ["worktree", "remove", "--force", dir], process.cwd());
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

async function main(): Promise<number> {
    const log = (m: string) => console.log(m);
    const prs = process.argv.slice(2).some((a) => /^\d+$/.test(a))
        ? process.argv
              .slice(2)
              .filter((a) => /^\d+$/.test(a))
              .map(Number)
        : owedPrs();
    if (prs.length === 0) {
        log("collect: no open ui-owed PR");
        return 0;
    }
    log(`collect: walking ${prs.map((p) => `#${p}`).join(" ")} in one batch`);
    let outcome: BatchOutcome | null = null;
    const code = await runBatch(
        prs,
        ["--write-receipts"],
        process.cwd(),
        log,
        (o) => (outcome = o)
    );
    if (outcome === null) {
        log(
            `collect: the walk settled nothing (exit ${code}) — labels untouched`
        );
        return code;
    }
    for (const action of planCollect(outcome)) apply(action, log);
    return code;
}

if (import.meta.main) {
    main().then(
        (code) => process.exit(code),
        (err) => {
            console.error(`✗ check:ui:batch: ${(err as Error).message}`);
            process.exit(1);
        }
    );
}
