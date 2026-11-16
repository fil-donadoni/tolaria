/**
 * `bun run check:ui:batch` — the collector (issue #9122): every open PR
 * wearing `ui-owed` is walked in ONE `check:ui --batch=… --write-receipts`.
 * The decision per PR is pure (`planCollect`); this file is the gh glue.
 *
 *   CLEAN     → `ui-owed` removed, `land:ready <PR#>` run (it carries the
 *               receipt the batch wrote into the body); a refusal there
 *               → `land-failed` added, the refusal commented;
 *   RED       → `ui-owed` removed, `land-failed` added, red lines commented;
 *   DROPPED / UNPROVEN → stays `ui-owed`, a comment says why (cells left
 *               `UNWALKED` / `INFRA` by the batch AND a solo re-walk are
 *               UNPROVEN, never RED);
 *   no outcome (the walk was cut short: infra exit) → nothing touched.
 *
 * Runs on the lane machine (local Convex deployment, ADR 0156 lane slot).
 * Trigger (issue #9264): the `ui-batch` workflow — a hosted `--probe` every
 * 30 min, then this collector on the `lane` runner only when a PR is owed —
 * or by hand. `land:ready` runs in a throwaway worktree of each PR's pushed
 * head. A refusal there — `land:ready`'s own, or the collector's checkout /
 * `worktree:init` (INFRA) — labels the PR `land-failed`, the repair pick's
 * marker, and comments it; `ui-owed` stays off (it would block the very
 * `land:ready` that fixes the cause). Unlabelled, no consumer would ever
 * read the PR again.
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
import { unmeasuredCellsText } from "./batch-receipt.ts";

export type CollectAction =
    | { kind: "land"; pr: number; comment?: string }
    | { kind: "fail"; pr: number; comment: string; partners: number[] }
    | { kind: "hold"; pr: number; comment: string; intrinsic: boolean };

/** The action each PR of a settled batch gets. Pure. */
export function planCollect(outcome: BatchOutcome): CollectAction[] {
    const actions: CollectAction[] = [];
    for (const pr of outcome.clean) {
        // Cells the batch left unmeasured and a solo re-walk passed (issue
        // #9549): the receipt covers them, the comment says how.
        const cells = outcome.rewalked?.get(pr) ?? [];
        actions.push(
            cells.length > 0
                ? {
                      kind: "land",
                      pr,
                      comment: `check:ui batch walk: CLEAN — the batch left ${cells.map((c) => `\`${c}\``).join(", ")} unmeasured (UNWALKED / INFRA); re-walked on #${pr} alone, every cell PASS.`,
                  }
                : { kind: "land", pr }
        );
    }
    const combination = outcome.combination ?? [];
    for (const [pr, red] of outcome.red) {
        // A combination break's culprit (issue #9265): the repair pass reads
        // the neighbours it breaks together with.
        const breaks = combination.filter((c) => c.culprit === pr);
        const partners = [...new Set(breaks.flatMap((c) => c.partners))].sort(
            (a, b) => a - b
        );
        const combo = breaks
            .map(
                (c) =>
                    `\n\n\`${c.surface}\` is red only in combination: green on the batch's merge-order prefix before #${pr}, red once #${pr} is merged${c.partners.length ? ` in combination with ${c.partners.map((p) => `#${p}`).join(", ")}` : ""}. Read ${c.partners.length ? "their diffs" : "the base"} beside this one before repairing.`
            )
            .join("");
        actions.push({
            kind: "fail",
            pr,
            partners,
            comment: `check:ui batch walk: RED${combo}\n\n\`\`\`\n${red.join("\n")}\n\`\`\``,
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
        const behind = combination.filter((c) => c.after.includes(pr));
        if (behind.length > 0) {
            const culprits = [...new Set(behind.map((c) => `#${c.culprit}`))];
            actions.push({
                kind: "hold",
                pr,
                intrinsic: false,
                comment: `check:ui batch walk: #${pr} rides the next batch — it was merged after ${culprits.join(", ")}, which breaks ${behind.map((c) => `\`${c.surface}\``).join(", ")} in combination, so it is unproven against a base that will change. It stays \`${UI_OWED_LABEL}\`.`,
            });
            continue;
        }
        const cells = (outcome.unmeasured ?? []).filter((u) => u.owner === pr);
        if (cells.length > 0) {
            actions.push({
                kind: "hold",
                pr,
                intrinsic: false,
                comment: `check:ui batch walk: #${pr} is UNPROVEN — ${cells.map((u) => `\`${unmeasuredCellsText(u)}\``).join(", ")} measured nothing in the batch (UNWALKED / INFRA) nor in a solo re-walk on #${pr} alone. Nothing failed: it stays \`${UI_OWED_LABEL}\`; the next batch walks it again, or walk it alone with \`bun run check:ui\`.`,
            });
            continue;
        }
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

/** A listed PR a scheduled batch skips: held at its current head. */
export interface HeldPr {
    pr: number;
    head: string;
    /** `push`: the hold is the head's own, a new push releases it; `base`:
     *  a new base releases it. */
    until: "push" | "base";
    /** The hold comment's first line, its `check:ui batch walk:` prefix
     *  dropped — why the batch held it. */
    reason: string;
}

/** Splits the listed `ui-owed` PRs into the ones a scheduled batch owes a
 *  walk and the ones held at their current head — for good, or on the
 *  current base (issue #9264). Both sorted by number. Pure. */
export function partitionOwed(
    prs: readonly OwedPr[],
    base: string
): { owed: number[]; held: HeldPr[] } {
    const owed: number[] = [];
    const held: HeldPr[] = [];
    for (const p of [...prs].sort((a, b) => a.number - b.number)) {
        const markers: [string, HeldPr["until"]][] = [
            [heldMarker(p.headRefOid), "push"],
            [heldMarker(p.headRefOid, base), "base"],
        ];
        const hit = markers
            .map(([m, until]) => ({
                until,
                comment: p.comments.findLast((c) => c.body.includes(m)),
            }))
            .find((h) => h.comment !== undefined);
        if (!hit) {
            owed.push(p.number);
            continue;
        }
        const first = hit.comment!.body.split("\n")[0] ?? "";
        held.push({
            pr: p.number,
            head: p.headRefOid,
            until: hit.until,
            reason: first.replace(/^check:ui batch walk:\s*/, "").trim(),
        });
    }
    return { owed, held };
}

/** The PRs a scheduled batch owes a walk (`partitionOwed`'s `owed`). Pure. */
export function owedFrom(prs: readonly OwedPr[], base: string): number[] {
    return partitionOwed(prs, base).owed;
}

/** The collector's summary of what it found: the owed PRs, then one line
 *  per held PR. With nothing owed it never claims there is no `ui-owed` PR
 *  while one is only held (issue #10059). Pure. */
export function collectSummary(
    owed: readonly number[],
    held: readonly HeldPr[]
): string[] {
    const refs = (ns: readonly number[]) => ns.map((n) => `#${n}`).join(" ");
    const heldPart =
        held.length > 0
            ? ` — ${held.length} ui-owed PR(s) held: ${refs(held.map((h) => h.pr))}`
            : "";
    const head =
        owed.length > 0
            ? `collect: ${owed.length} PR(s) owed: ${refs(owed)}${heldPart}`
            : held.length > 0
              ? `collect: no PR owed${heldPart}`
              : "collect: no open ui-owed PR";
    return [
        head,
        ...held.map(
            (h) =>
                `  · #${h.pr} held at ${h.head.slice(0, 12)} until ${h.until === "push" ? "a new push" : "the base moves"}: ${h.reason}`
        ),
    ];
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

/** Why `land:ready` did not hand a CLEAN PR off: its own refusal, or an
 *  INFRA failure of the collector's checkout / bootstrap of the PR head. */
export interface LandRefusal {
    output: string;
    infra: boolean;
}

/** The side effects `applyAction` performs — `gh`, and `land:ready` on a
 *  PR's pushed head — injectable so a test stubs them. */
export interface CollectIo {
    gh: (args: string[]) => string;
    land: (pr: number) => LandRefusal | null;
}

const defaultIo: CollectIo = { gh, land: landFromPrHead };

/** The comment a CLEAN PR whose hand-off refused gets (issue #10010). Pure. */
export function refusalComment(pr: number, refusal: LandRefusal): string {
    const run = `run \`bun run land:ready ${pr}\` from the PR's worktree`;
    const cause = refusal.infra
        ? `the collector could not run \`land:ready\` (INFRA: ${refusal.output}). Nothing in the PR needs fixing: ${run}.`
        : `\`land:ready\` refused:\n\n\`\`\`\n${refusal.output}\n\`\`\`\nFix the cause, then ${run}.`;
    return `check:ui batch walk: CLEAN, receipt written, but ${cause} Labelled \`${FAILED_LABEL}\` (a repair pick); \`${UI_OWED_LABEL}\` stays off — it would block that \`land:ready\`.`;
}

/** Applies one action to its PR. Exported for its test (issue #10010). */
export function applyAction(
    action: CollectAction,
    heads: ReadonlyMap<number, string>,
    base: string,
    log: (m: string) => void,
    io: CollectIo = defaultIo
): void {
    const pr = String(action.pr);
    const comment = (n: number, body: string) =>
        io.gh(["pr", "comment", String(n), "--body", body]);
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
    io.gh(["pr", "edit", pr, "--remove-label", UI_OWED_LABEL]);
    if (action.kind === "fail") {
        io.gh(["pr", "edit", pr, "--add-label", FAILED_LABEL]);
        comment(action.pr, action.comment);
        return;
    }
    if (action.comment) comment(action.pr, action.comment);
    const refusal = io.land(action.pr);
    if (refusal !== null) {
        // The walk is done and its receipt is in the body. `ui-owed` stays
        // off (it would block the very `land:ready` that fixes the cause);
        // `land-failed` makes it the next pass's repair pick (issue #10010).
        io.gh(["pr", "edit", pr, "--add-label", FAILED_LABEL]);
        comment(action.pr, refusalComment(action.pr, refusal));
        log(
            `collect: land:ready ${pr} refused${refusal.infra ? " (INFRA)" : ""} — \`${FAILED_LABEL}\`, commented, #${pr} not queued`
        );
    }
}

/** `land:ready` must run in a checkout of the PR's pushed head: a throwaway
 *  detached worktree, bootstrapped. Returns the refusal, or null. */
function landFromPrHead(pr: number): LandRefusal | null {
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
        if (add.status !== 0)
            return {
                output: `could not check out pull/${pr}/head`,
                infra: true,
            };
        const init = run("bun", ["run", "worktree:init"], dir);
        if (init.status !== 0)
            return { output: "worktree:init failed", infra: true };
        const r = run("bun", ["run", "land:ready", String(pr)], dir);
        if (r.status === 0) return null;
        return {
            output: `${r.stdout}${r.stderr}`
                .trim()
                .split("\n")
                .slice(-15)
                .join("\n"),
            infra: false,
        };
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
    const split =
        named.length > 0
            ? { owed: named, held: [] }
            : partitionOwed(listed, baseTip());
    const prs = split.owed;
    if (args.includes("--probe")) {
        for (const line of collectSummary(prs, split.held)) log(line);
        writeTo("GITHUB_OUTPUT", `owed=${prs.length}\n`);
        return 0;
    }
    if (prs.length === 0) {
        for (const line of collectSummary(prs, split.held)) log(line);
        return 0;
    }
    for (const line of collectSummary(prs, split.held).slice(1)) log(line);
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
        applyAction(action, heads, settled.base, log);
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
