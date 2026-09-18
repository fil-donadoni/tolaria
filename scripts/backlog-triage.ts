#!/usr/bin/env bun
/**
 * `bun run backlog:triage` — the band rule of issue #3851 decision 3, as a
 * re-runnable script (issue #4054). The rule itself is the pure `triage` in
 * `lib/backlog-triage.ts`; this file only gathers its three inputs and prints
 * the per-class diff.
 *
 * **Dry run, always.** This ticket builds the computation and the read side;
 * the mass write is the next ticket's. There is no write path here at all, so
 * a run with no flags — or with `--dry-run`, accepted for the habit — performs
 * zero mutations; `--write` is refused by name rather than ignored.
 *
 * Reads, and their budget (~470 items against a 5000-point/hour GraphQL pool
 * shared with `queue:plan`):
 *
 *   - the board's `Priority` field through `fetchBoardPriority` — the shared
 *     single-field query (8 points against `gh project item-list`'s 766,
 *     `docs/agents/issue-tracker.md`), never a whole-board item list;
 *   - the open issues with their parent and the issues they block, one
 *     paginated GraphQL query at 1 point a page;
 *   - the lockfile, the Target registry and `data/grammar-gaps.json`'s claims,
 *     all local.
 *
 * Runs from the primary checkout with `GITHUB_TOKEN` stripped (`lib/gh.ts`),
 * like `queue:plan` and `gaps:sync`.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALLOWLIST_PATH, LOCKFILE_PATH, parseAllowlist } from "./check-gaps";
import {
    cardBandIndex,
    claimedCards,
    issueCards,
    renderReport,
    summarize,
    triage,
    type TriageIssue,
} from "./lib/backlog-triage";
import { fetchBoardPriority } from "./lib/board-priority";
import { gh } from "./lib/gh";
import { parseLockfile } from "./lib/oracle-lockfile";
import {
    gapIndex,
    parseClaimRows,
    readTargetRegistry,
    resolveContext,
    resolveTarget,
} from "./lib/targets";

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";

/** Per issue, how many blocked issues one page reads. An issue blocking more
 *  fails closed rather than dropping an edge. */
const BLOCKING_PAGE = 50;

/**
 * `$endCursor` is named exactly that because `gh api graphql --paginate` keys
 * its walk to it — renamed, the read silently returns page one only.
 */
export const OPEN_ISSUES_QUERY = `
query($owner: String!, $name: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
        issues(states: OPEN, first: 100, after: $endCursor) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
                number
                title
                parent { number }
                blocking(first: ${BLOCKING_PAGE}) {
                    totalCount
                    nodes { number }
                }
            }
        }
    }
}`;

interface IssuePage {
    data?: {
        repository?: {
            issues?: {
                totalCount?: number;
                pageInfo?: { hasNextPage?: boolean };
                nodes?: {
                    number: number;
                    title: string;
                    parent: { number: number } | null;
                    blocking: {
                        totalCount: number;
                        nodes: { number: number }[];
                    };
                }[];
            };
        };
    };
}

export interface OpenIssue {
    readonly number: number;
    readonly title: string;
    readonly parent: number | null;
    readonly blocks: readonly number[];
}

/** Every open issue with its parent and the issues it blocks. Fails closed on
 *  a truncated walk or a truncated edge list — a missing edge is a wrong band. */
export function fetchOpenIssues(
    run: (args: string[]) => string,
    repo: string = PROJECT_REPO
): OpenIssue[] {
    const [owner, name] = repo.split("/");
    const raw = run([
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-f",
        `query=${OPEN_ISSUES_QUERY}`,
    ]);
    const pages = JSON.parse(raw) as IssuePage[];
    const conns = Array.isArray(pages)
        ? pages.map((p) => p.data?.repository?.issues)
        : [];
    if (conns.length === 0 || conns.some((c) => !Array.isArray(c?.nodes)))
        throw new Error(
            `backlog:triage: the open-issue query for ${repo} returned no issues — the repo does not resolve or the shape changed`
        );
    if (conns[conns.length - 1]!.pageInfo?.hasNextPage === true)
        throw new Error(
            "backlog:triage: the open-issue walk stopped with pages outstanding — re-run"
        );
    const out: OpenIssue[] = [];
    for (const node of conns.flatMap((c) => c!.nodes!)) {
        if (node.blocking.totalCount > node.blocking.nodes.length)
            throw new Error(
                `backlog:triage: issue #${node.number} blocks ${node.blocking.totalCount} issues, more than one page (${BLOCKING_PAGE}) — paginate before trusting its band`
            );
        out.push({
            number: node.number,
            title: node.title,
            parent: node.parent?.number ?? null,
            blocks: node.blocking.nodes.map((n) => n.number),
        });
    }
    return out;
}

/** The whole run, minus printing — the seam the tests drive with a recording
 *  `ghClient`. */
export function runTriage(opts: {
    root: string;
    argv: readonly string[];
    ghClient: (args: string[]) => string;
}): string {
    if (opts.argv.includes("--write"))
        throw new Error(
            "backlog:triage: `--write` is not built — this command is dry-run only; the mass write is the follow-up ticket of issue #4054"
        );
    const lock = parseLockfile(
        readFileSync(join(opts.root, LOCKFILE_PATH), "utf8")
    );
    const allowlist = parseAllowlist(
        readFileSync(join(opts.root, ALLOWLIST_PATH), "utf8")
    );
    const registry = readTargetRegistry(opts.root);
    const ctx = resolveContext(opts.root, lock);
    const byName = (name: string): string | undefined =>
        ctx.byName.get(name)?.oracleId;

    const index = cardBandIndex(
        registry.targets.map((row) => ({
            id: row.id,
            ids: resolveTarget(row, ctx).cards.map((c) => c.oracleId),
        }))
    );
    const claimed = claimedCards(
        parseClaimRows(allowlist, ALLOWLIST_PATH),
        lock,
        gapIndex(lock).gapKeys,
        byName
    );

    const errors: string[] = [];
    const board = fetchBoardPriority({
        owner: PROJECT_OWNER,
        projectNumber: PROJECT_NUMBER,
        repo: PROJECT_REPO,
        onError: (message) => errors.push(message),
        ghClient: opts.ghClient,
    });
    // A degraded board read would report every hand-set P0 as a band to
    // write over — fail closed, never triage against a partial board.
    if (errors.length > 0)
        throw new Error(
            `backlog:triage: board read failed:\n${errors.join("\n")}`
        );

    const issues: TriageIssue[] = fetchOpenIssues(opts.ghClient).map((i) => ({
        ...i,
        cards: issueCards(i, claimed, byName),
    }));
    const verdicts = triage(issues, index, board);
    return renderReport(summarize(issues, verdicts, board));
}

function main(): void {
    try {
        console.log(
            runTriage({
                root: resolve("."),
                argv: process.argv.slice(2),
                ghClient: gh,
            })
        );
    } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
    }
}

if (import.meta.main) main();
