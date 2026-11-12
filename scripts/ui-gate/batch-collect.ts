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
 * Trigger (issue #9264): the `ui-batch` workflow — a hosted `--probe` every
 * 30 min, then this collector on the `lane` runner only when a PR is owed —
 * or by hand. `land:ready` runs in a throwaway worktree of each PR's pushed
 * head. A refusal there is commented and the label stays off.
 *
 * A held PR (DROPPED / UNPROVEN) keeps `ui-owed`; its comment carries the
 * head it was judged at (`heldMarker`), so a scheduled run never re-walks the
 * same facts forever. A hold that is the head's own (not open, a FULL /
 * undecided scope) waits for a new push; any other (a conflict with a
 * sibling, a fetch error, UNPROVEN) also names the base and is retried once
 * the base moves. Naming PRs on the command line bypasses that filter.
 *
 *   --probe  print the owed PRs, write `owed=<N>` to $GITHUB_OUTPUT; no walk
 *   --ci     an infra exit (`INFRA_EXITS`) that settled nothing exits 0 as
 *            INFRA — labels untouched, the next tick retries; the per-PR
 *            summary goes to $GITHUB_STEP_SUMMARY
 *
 * Exit: the batch's own code (`--ci`: 0 on INFRA).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FAILED_LABEL, UI_OWED_LABEL } from "../lib/land-labels.ts";
import { gh } from "../lib/gh.ts";
import { BASE_BRANCH } from "../lib/branches.ts";
import { INFRA_EXIT } from "../lib/infra-exit.ts";
import { DEPLOYMENT_DOWN_EXIT } from "../lib/convex-reachable.ts";
import { DEPLOYMENT_SKEW_EXIT } from "../lib/deployment-skew.ts";
import { runBatch, type BatchOutcome } from "./batch-run.ts";

export type CollectAction =
    | { kind: "land"; pr: number }
    | { kind: "fail"; pr: number; comment: string }
    | { kind: "hold"; pr: number; comment: string; intrinsic: boolean };

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
    for (const { pr, reason, intrinsic } of outcome.dropped) {
        actions.push({
            kind: "hold",
            pr,
            intrinsic: intrinsic === true,
            comment: `check:ui batch walk: #${pr} was DROPPED — ${reason}. It stays \`${UI_OWED_LABEL}\`; rebase it, or walk it alone with \`bun run check:ui\`.`,
        });
    }
    for (const pr of outcome.unproven) {
        actions.push({
            kind: "hold",
            pr,
            intrinsic: false,
            comment: `check:ui batch walk: #${pr} is UNPROVEN — a red surface of its scope is owned by no single PR. It stays \`${UI_OWED_LABEL}\`; walk it alone with \`bun run check:ui\`.`,
        });
    }
    return actions;
}

/** The marker a hold comment carries: the head the batch judged, and the
 *  base for a hold that is not the head's own (a new base retries it). */
export function heldMarker(head: string, base?: string): string {
    return `<!-- check-ui-batch-held: ${head}${base ? ` base ${base}` : ""} -->`;
}

/** An open `ui-owed` PR as `gh pr list` returns it. */
export interface OwedPr {
    number: number;
    headRefOid: string;
    comments: { body: string }[];
}

/** The PRs a scheduled batch owes a walk: every listed PR except one held
 *  at its current head — for good, or on the current base (issue #9264).
 *  Pure. */
export function owedFrom(prs: readonly OwedPr[], base: string): number[] {
    const held = (p: OwedPr) =>
        [heldMarker(p.headRefOid), heldMarker(p.headRefOid, base)].some((m) =>
            p.comments.some((c) => c.body.includes(m))
        );
    return prs
        .filter((p) => !held(p))
        .map((p) => p.number)
        .sort((a, b) => a - b);
}

/** Exit codes of a walk the machine cut short: deployment down, deployment
 *  skew, a gate that never started. */
export const INFRA_EXITS: ReadonlySet<number> = new Set([
    DEPLOYMENT_DOWN_EXIT,
    DEPLOYMENT_SKEW_EXIT,
    INFRA_EXIT,
]);

/** The workflow's exit: an infra exit that settled nothing is INFRA, never
 *  a red batch (the next tick retries). Pure. */
export function ciExit(code: number, settled: boolean): number {
    return !settled && INFRA_EXITS.has(code) ? 0 : code;
}

/** The per-PR summary of a settled batch, one Markdown row each. Pure. */
export function summaryRows(outcome: BatchOutcome): string[] {
    return [
        "| PR | Batch verdict |",
        "| --- | --- |",
        ...outcome.clean.map((pr) => `| #${pr} | CLEAN |`),
        ...[...outcome.red.keys()].map((pr) => `| #${pr} | RED |`),
        ...outcome.dropped.map(
            ({ pr, reason }) => `| #${pr} | DROPPED — ${reason} |`
        ),
        ...outcome.unproven.map((pr) => `| #${pr} | UNPROVEN |`),
    ];
}

function baseTip(): string {
    return gh([
        "api",
        `repos/{owner}/{repo}/branches/${BASE_BRANCH}`,
        "--jq",
        ".commit.sha",
    ]).trim();
}

function listOwed(): OwedPr[] {
    return JSON.parse(
        gh([
            "pr",
            "list",
            "--label",
            UI_OWED_LABEL,
            "--state",
            "open",
            "--json",
            "number,headRefOid,comments",
            "--limit",
            "50",
        ])
    ) as OwedPr[];
}

function comment(pr: number, body: string): void {
    gh(["pr", "comment", String(pr), "--body", body]);
}

function apply(
    action: CollectAction,
    heads: ReadonlyMap<number, string>,
    base: string,
    log: (m: string) => void
): void {
    const pr = String(action.pr);
    if (action.kind === "hold") {
        const head = heads.get(action.pr);
        const marker = action.intrinsic
            ? heldMarker(head ?? "")
            : heldMarker(head ?? "", base);
        comment(
            action.pr,
            head ? `${action.comment}\n\n${marker}` : action.comment
        );
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

function writeTo(envVar: string, text: string): void {
    const file = process.env[envVar];
    if (file) fs.appendFileSync(file, text);
}

async function main(): Promise<number> {
    const log = (m: string) => console.log(m);
    const args = process.argv.slice(2);
    const ci = args.includes("--ci");
    const named = args.filter((a) => /^\d+$/.test(a)).map(Number);
    const listed = named.length > 0 ? [] : listOwed();
    const heads = new Map(listed.map((p) => [p.number, p.headRefOid]));
    const prs = named.length > 0 ? named : owedFrom(listed, baseTip());
    if (args.includes("--probe")) {
        log(
            `collect: ${prs.length} PR(s) owed${prs.length ? `: ${prs.map((p) => `#${p}`).join(" ")}` : ""}`
        );
        writeTo("GITHUB_OUTPUT", `owed=${prs.length}\n`);
        return 0;
    }
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
        const infra = INFRA_EXITS.has(code);
        log(
            `collect: the walk settled nothing (exit ${code}${infra ? ", INFRA" : ""}) — labels untouched`
        );
        if (ci)
            writeTo(
                "GITHUB_STEP_SUMMARY",
                `check:ui batch: settled nothing (exit ${code}${infra ? ", INFRA — the next tick retries" : ""}); labels untouched\n`
            );
        return ci ? ciExit(code, false) : code;
    }
    const settled: BatchOutcome = outcome;
    if (ci)
        writeTo("GITHUB_STEP_SUMMARY", `${summaryRows(settled).join("\n")}\n`);
    for (const action of planCollect(settled))
        apply(action, heads, settled.base, log);
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
