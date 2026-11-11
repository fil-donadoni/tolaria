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
 * Trigger: `ui-batch.yml` — on a `ui-owed` label event, with a slow cron as
 * the fallback — or by hand, no arguments. Exit: the batch's own code.
 */
import { spawnSync } from "node:child_process";
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
    for (const pr of outcome.dropped) {
        actions.push({
            kind: "hold",
            pr,
            comment: `check:ui batch walk: #${pr} was DROPPED (not open against the base, a merge conflict with the batch, or a FULL / undecided scope). It stays \`${UI_OWED_LABEL}\`; rebase it, or walk it alone with \`bun run check:ui\`.`,
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
    const r = spawnSync("bun", ["run", "land:ready", pr], {
        stdio: "inherit",
    });
    if (r.status !== 0) {
        // Refused: the receipt or another gate says no. Put the marker back so
        // the PR is visible, and say why in the log (the refusal is above).
        gh(["pr", "edit", pr, "--add-label", UI_OWED_LABEL]);
        log(
            `collect: land:ready ${pr} exited ${r.status} — #${pr} stays ui-owed`
        );
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
