/**
 * Publish a run's failure shots where the owner reads them (issue #6145).
 *
 * WHY. The shots used to stay in the worktree's telemetry folder and die with
 * it — attended worktrees are removed at merge, an AFK runner's temp by its
 * job — and the path was printed only in the diagnostic block. The owner had
 * never seen one. A run with at least one failing cell now ends with ONE
 * comment: a table (surface, viewport, floor, reading) and the outlined shots
 * inline, uploaded with `gh … comment --attach` (gh ≥ 2.99).
 *
 * WHERE. The branch's open PR; else the issue the branch is named for
 * (`feat|fix/issue-N`, `issueOfBranch`); else nowhere — the local paths are
 * printed and said so. Batch health walks the base branch, which has neither.
 *
 * WHICH TOKEN. The keyring login. `GITHUB_TOKEN` is the bug-report PAT bun
 * auto-loads from `.env.local` (`lib/gh.ts`), and on an Actions runner a
 * `GH_TOKEN` is the job's Actions token, which the attachment upload rejects —
 * both are dropped from the child's environment there.
 *
 * NEVER A VERDICT. The walk's exit code is the receipt's; a comment that
 * could not be posted prints the local paths and why, and nothing else
 * changes. Nothing here throws.
 *
 * THE REPO IS PUBLIC. The body is the table and the images — lane test
 * accounts and card art — and nothing about the machine: no path, no host, no
 * load. Image references are `./<file>` relative to the run's directory, which
 * is the cwd `gh` runs in, so `--attach` rewrites them to the uploaded asset.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { netEnv } from "../lib/gh.ts";
import { issueOfBranch } from "../lib/issue-worktree.ts";
import type { FailedCell } from "./failure-shot.ts";

/** `gh … comment` takes at most this many `--attach` flags per call. */
export const MAX_ATTACHMENTS = 50;

/** Table rows past this are summarised: a comment body caps at 65,536
 *  characters, and a run that broke every cell says so in one line. */
export const MAX_TABLE_ROWS = 300;

/** Where the comment goes. */
export type ShotTarget =
    | { kind: "pr"; number: number }
    | { kind: "issue"; number: number }
    | { kind: "local"; why: string };

/** One `gh` invocation. Injected so the publish is testable with a fake. */
export type GhRunner = (
    args: readonly string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv }
) => { status: number | null; stdout: string; stderr: string };

export const spawnGh: GhRunner = (args, opts) => {
    const r = spawnSync("gh", args, {
        cwd: opts.cwd,
        env: opts.env,
        encoding: "utf8",
        timeout: 120_000,
    });
    return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? (r.error ? r.error.message : ""),
    };
};

/** The environment `gh` runs in: the keyring login, never the bug-report
 *  PAT nor an Actions token (see the header). */
export function publishEnv(
    base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env = netEnv(base);
    if (base.GITHUB_ACTIONS === "true") delete env.GH_TOKEN;
    return env;
}

/** Failing cells in Viewport Matrix order, then surface order: the order
 *  every receipt prints, whatever order the parallel viewports finished in. */
export function orderCells(
    cells: readonly FailedCell[],
    viewportIds: readonly string[],
    surfaceIds: readonly string[]
): FailedCell[] {
    const rank = (ids: readonly string[], id: string) => {
        const i = ids.indexOf(id);
        return i < 0 ? ids.length : i;
    };
    return [...cells].sort(
        (a, b) =>
            rank(viewportIds, a.viewport) - rank(viewportIds, b.viewport) ||
            rank(surfaceIds, a.surface) - rank(surfaceIds, b.surface)
    );
}

const cellText = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The comment: a heading, the table, one image per failing cell (the first
 *  `MAX_ATTACHMENTS`). `head` is the commit walked, when known. */
export function commentBody(
    cells: readonly FailedCell[],
    head: string | null
): string {
    const rows: string[] = [];
    for (const c of cells) {
        for (const f of c.floors)
            rows.push(
                `| ${cellText(c.surface)} | ${c.viewport} | ${f.floor} | ${f.reading} |`
            );
        for (const a of c.asserts)
            rows.push(
                `| ${cellText(c.surface)} | ${c.viewport} | assert ${cellText(a)} | failed |`
            );
    }
    const shown = rows.slice(0, MAX_TABLE_ROWS);
    const lines = [
        `### check:ui — ${cells.length} failing cell(s)${head ? ` at ${head}` : ""}`,
        "",
        "Each shot outlines the boxes that broke a Floor; the banner names the readings and any failed assertion.",
        "",
        "| surface | viewport | floor | reading |",
        "| --- | --- | --- | --- |",
        ...shown,
    ];
    if (rows.length > shown.length)
        lines.push("", `…and ${rows.length - shown.length} more row(s).`);
    const attached = cells.slice(0, MAX_ATTACHMENTS);
    for (const c of attached) {
        const alt = `${c.surface} @ ${c.viewport}`;
        lines.push("", `**${alt}**`, "", `![${alt}](./${c.file})`);
    }
    if (cells.length > attached.length)
        lines.push(
            "",
            `${cells.length - attached.length} more shot(s) not attached (${MAX_ATTACHMENTS} per comment).`
        );
    return lines.join("\n") + "\n";
}

/** The branch's open PR, else the issue it is named for, else nowhere. */
export function pickTarget(
    branch: string | null,
    gh: GhRunner,
    opts: { cwd: string; env: NodeJS.ProcessEnv }
): ShotTarget {
    if (!branch || branch === "HEAD")
        return { kind: "local", why: "no branch checked out" };
    const pr = gh(
        [
            "pr",
            "list",
            "--head",
            branch,
            "--state",
            "open",
            "--json",
            "number",
            "--jq",
            ".[0].number // empty",
        ],
        opts
    );
    const number = Number(pr.stdout.trim());
    if (pr.status === 0 && Number.isInteger(number) && number > 0)
        return { kind: "pr", number };
    const issue = issueOfBranch(branch);
    if (issue !== null) return { kind: "issue", number: issue };
    return {
        kind: "local",
        why: `branch ${branch} has no open PR and names no issue`,
    };
}

/**
 * Post the run's failing cells as one comment, or print where they are.
 * Returns what happened, for the caller's log; never throws.
 */
export function publishFailedShots(
    cells: readonly FailedCell[],
    deps: {
        dir: string;
        branch: string | null;
        head: string | null;
        gh: GhRunner;
        env: NodeJS.ProcessEnv;
        log: (line: string) => void;
        /** `--no-publish`: keep the shots local. */
        disabled?: boolean;
    }
): "none" | "posted" | "local" | "failed" {
    if (cells.length === 0) return "none";
    const printLocal = () => {
        for (const c of cells) deps.log(`  ${path.join(deps.dir, c.file)}`);
    };
    try {
        if (deps.disabled) {
            deps.log(
                `ui-gate: ${cells.length} failure shot(s) kept local (--no-publish):`
            );
            printLocal();
            return "local";
        }
        const opts = { cwd: deps.dir, env: deps.env };
        const target = pickTarget(deps.branch, deps.gh, opts);
        if (target.kind === "local") {
            deps.log(
                `ui-gate: ${cells.length} failure shot(s) not posted — ${target.why}:`
            );
            printLocal();
            return "local";
        }
        const bodyFile = "check-ui-comment.md";
        fs.writeFileSync(
            path.join(deps.dir, bodyFile),
            commentBody(cells, deps.head)
        );
        const attach = cells
            .slice(0, MAX_ATTACHMENTS)
            // The body's `![alt](./<file>)` keeps its alt text (gh's rule).
            .flatMap((c) => ["--attach", `./${c.file}`]);
        const r = deps.gh(
            [
                target.kind,
                "comment",
                String(target.number),
                "--body-file",
                bodyFile,
                ...attach,
            ],
            opts
        );
        const where = `${target.kind === "pr" ? "PR" : "issue"} #${target.number}`;
        if (r.status !== 0) {
            const why =
                (r.stderr || r.stdout).trim().split("\n")[0] ||
                `gh exited ${r.status}`;
            deps.log(
                `ui-gate: could not post ${cells.length} failure shot(s) on ${where} (${why}) — they are at:`
            );
            printLocal();
            return "failed";
        }
        const url = r.stdout.trim().split("\n").pop() ?? "";
        deps.log(
            `ui-gate: ${cells.length} failure shot(s) posted on ${where}${url ? ` — ${url}` : ""}`
        );
        return "posted";
    } catch (err) {
        deps.log(
            `ui-gate: could not post the failure shots (${(err as Error).message.split("\n")[0]}) — they are at:`
        );
        printLocal();
        return "failed";
    }
}
