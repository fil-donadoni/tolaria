#!/usr/bin/env bun
/**
 * `bun run pr-refresh` — keep the queued PRs rebased on the base (issue
 * #5638, PRD #5620). GitHub and Mergify do not run our merge drivers, and 37 %
 * of PRs touch a driven file, so a queued PR conflicts on a generated artefact
 * the moment the base moves. On every push to the base, `pr-refresh.yml` runs
 * this on a `lane` runner:
 *
 *   for each `ready-to-land` PR GitHub reports `CONFLICTING`, a `merge:manual`
 *   one whose files the push just touched, or (only while the base lineage is
 *   RED) a `queue:held` one — never one Mergify holds `queued` unless it
 *   conflicts (issue #6957):
 *     rebase onto the base in a worktree of the primary checkout with the SAME
 *     steps `land` runs (`lib/rebase-resolve.ts`: merge drivers, the
 *     `REGENERATED_ARTIFACTS` resolver), then force-push with a lease;
 *     a conflict in a file no driver owns → `land-failed` + the paths as a
 *     comment, which `queue:plan` hands out as a repair pick.
 *
 * The push goes out under the OWNER's credentials (`GITHUB_TOKEN` stripped,
 * like `land`'s): a push made with the workflow token does not trigger other
 * workflows, so the PR's checks would never re-run. The lease on the head sha
 * the PR was read at means a push the land-runner or a session made meanwhile
 * wins, and this one is dropped.
 *
 *   bun run pr-refresh [--before <sha> --after <sha>] [--pr N] [--dry-run]
 *
 * The decisions are `lib/pr-refresh.ts`; this file is the I/O.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
import {
    pinnedSha,
    realCorpusSeedDeps,
    seedPinnedCorpus,
} from "./lib/corpus-cache";
import { gh, netEnv } from "./lib/gh";
import {
    githubVerdictStore,
    lineageBlocks,
    originRepo,
    readVerdictLineage,
} from "./lib/health-verdict-store";
import { issueOfBranch } from "./lib/issue-worktree";
import { labelArgs, READY_LABEL } from "./lib/land-runner";
import {
    conflictComment,
    parseConflictPaths,
    selectRefreshCandidates,
    type RefreshPr,
} from "./lib/pr-refresh";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    rebaseStep,
    resolveGeneratedArtifactsStep,
} from "./lib/rebase-resolve";

export type RefreshOutcome =
    | { kind: "unchanged" }
    | { kind: "pushed"; from: string; to: string }
    | { kind: "conflict"; paths: string[] }
    | { kind: "skipped"; reason: string };

export interface RefreshDeps {
    /**
     * Make the worktree runnable (`convex/_generated`, `node_modules`, the
     * gitignored Card Corpus cache the artefact resolver re-derives from).
     */
    prepare: (dir: string, primary: string) => boolean;
    /** Push the rebased tip (false = a dry run: everything but the push). */
    push: boolean;
}

function run(
    cmd: string,
    args: string[],
    cwd: string
): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(cmd, args, {
        cwd,
        encoding: "utf8",
        env: netEnv(),
    });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const lastLine = (s: string): string => s.trim().split("\n").slice(-1)[0] ?? "";

const fetchCorpus = (dir: string): boolean =>
    spawnSync("bun", ["run", "oracle:corpus"], {
        cwd: dir,
        stdio: "ignore",
        env: netEnv(),
    }).status === 0;

/**
 * Put the gitignored Card Corpus cache (`data/oracle-corpus.json.gz`) in the
 * worktree (issue #6320). `worktree:init` does not, and without it the
 * artefact resolver refuses to re-derive a conflicted lockfile: the PR stays
 * CONFLICTING. The primary's copy is taken only when its sha is the
 * worktree's pin — after a re-pin lands the two differ — else the pinned bulk
 * is downloaded (`lib/corpus-cache.ts`, issue #6381).
 */
export function seedCorpus(
    primary: string,
    dir: string,
    fetch: (dir: string) => boolean = fetchCorpus
): boolean {
    return seedPinnedCorpus(dir, primary, pinnedSha(dir), {
        ...realCorpusSeedDeps,
        fetchPinned: fetch,
    }).ok;
}

export const defaultPrepare = (dir: string, primary: string): boolean =>
    spawnSync("bun", ["run", "worktree:init"], { cwd: dir, stdio: "ignore" })
        .status === 0 && seedCorpus(primary, dir);

/**
 * Rebase ONE PR's head in a throwaway worktree of `primary` and push it. Never
 * touches the primary's own tree, and removes the worktree whatever happens.
 */
export function refreshPr(
    primary: string,
    pr: Pick<RefreshPr, "headRefName" | "headRefOid">,
    deps: RefreshDeps
): RefreshOutcome {
    const branch = pr.headRefName;
    const fetched = run(
        "git",
        [
            "fetch",
            "--no-tags",
            "origin",
            `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
        ],
        primary
    );
    if (fetched.status !== 0) {
        return {
            kind: "skipped",
            reason: `fetch failed: ${lastLine(fetched.stderr)}`,
        };
    }
    const tip = run(
        "git",
        ["rev-parse", `refs/remotes/origin/${branch}`],
        primary
    ).stdout.trim();
    if (tip !== pr.headRefOid) {
        return {
            kind: "skipped",
            reason: `head moved to ${tip.slice(0, 9)} since it was read`,
        };
    }
    const dir = mkdtempSync(join(tmpdir(), "tolaria-pr-refresh-"));
    try {
        const added = run(
            "git",
            ["worktree", "add", "--detach", dir, pr.headRefOid],
            primary
        );
        if (added.status !== 0) {
            return {
                kind: "skipped",
                reason: `worktree add failed: ${lastLine(added.stderr)}`,
            };
        }
        const rebased = run("sh", ["-c", rebaseStep()], dir);
        if (rebased.status !== 0) {
            // Keep only lines naming a file of the PR head or of the base:
            // `git rebase` prints more than the list this step ends on.
            const paths = parseConflictPaths(rebased.stdout).filter((p) =>
                [pr.headRefOid, `origin/${BASE_BRANCH}`].some(
                    (ref) =>
                        run("git", ["cat-file", "-e", `${ref}:${p}`], dir)
                            .status === 0
                )
            );
            return paths.length > 0
                ? { kind: "conflict", paths }
                : {
                      kind: "skipped",
                      reason: `rebase failed: ${lastLine(rebased.stderr)}`,
                  };
        }
        if (!deps.prepare(dir, primary)) {
            return {
                kind: "skipped",
                reason: "worktree prepare failed (worktree:init or Card Corpus cache)",
            };
        }
        const resolved = run(
            "sh",
            ["-c", resolveGeneratedArtifactsStep()],
            dir
        );
        if (resolved.status !== 0) {
            return {
                kind: "skipped",
                reason: `artefact resolver refused: ${lastLine(resolved.stderr)}`,
            };
        }
        const head = run("git", ["rev-parse", "HEAD"], dir).stdout.trim();
        if (head === pr.headRefOid) return { kind: "unchanged" };
        if (deps.push) {
            const pushed = run(
                "git",
                [
                    "push",
                    `--force-with-lease=refs/heads/${branch}:${pr.headRefOid}`,
                    "origin",
                    `HEAD:refs/heads/${branch}`,
                ],
                dir
            );
            if (pushed.status !== 0) {
                return {
                    kind: "skipped",
                    reason: `push refused: ${lastLine(pushed.stderr)}`,
                };
            }
        }
        return { kind: "pushed", from: pr.headRefOid, to: head };
    } finally {
        run("git", ["worktree", "remove", "--force", dir], primary);
        rmSync(dir, { recursive: true, force: true });
    }
}

function flag(argv: string[], name: string): string | null {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
}

/** The paths the push to the base changed; `null` when the range is unknown. */
function baseTouchedPaths(
    primary: string,
    before: string | null,
    after: string | null
): Set<string> | null {
    if (!before || !after || /^0+$/.test(before)) return null;
    const diff = run("git", ["diff", "--name-only", before, after], primary);
    return diff.status === 0
        ? new Set(diff.stdout.split("\n").filter(Boolean))
        : null;
}

function listQueued(): RefreshPr[] {
    const raw = gh([
        "pr",
        "list",
        "--state",
        "open",
        "--label",
        READY_LABEL,
        "--base",
        BASE_BRANCH,
        "--limit",
        "100",
        "--json",
        "number,headRefName,headRefOid,mergeable,isCrossRepository,labels,files",
    ]);
    const rows = JSON.parse(raw) as Array<
        Omit<RefreshPr, "labels" | "files"> & {
            labels: { name: string }[];
            files: { path: string }[];
        }
    >;
    return rows.map((r) => ({
        ...r,
        labels: r.labels.map((l) => l.name),
        files: r.files.map((f) => f.path),
    }));
}

function main(): number {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes("--dry-run");
    const only = flag(argv, "--pr");
    const primary = primaryCheckout();
    const log = (line: string): void => console.error(`pr-refresh: ${line}`);

    const fetched = run(
        "git",
        ["fetch", "--no-tags", "origin", BASE_BRANCH],
        primary
    );
    if (fetched.status !== 0) {
        log(`cannot fetch ${BASE_BRANCH}: ${lastLine(fetched.stderr)}`);
        return 1;
    }
    const touched = baseTouchedPaths(
        primary,
        flag(argv, "--before"),
        flag(argv, "--after")
    );
    // A held PR is rebased only under a RED (issue #6957); an unreadable
    // store reads as no RED, so the doubt costs no push.
    const lineage = readVerdictLineage(() =>
        githubVerdictStore({
            repo: process.env.GITHUB_REPOSITORY || originRepo(primary),
        })
    );
    if (lineage.error) log(`verdict store unreadable (${lineage.error})`);
    const red = lineageBlocks(lineage.kind);
    log(`health lineage ${lineage.kind}`);
    const selected = (pr: RefreshPr) =>
        only === null || String(pr.number) === only;
    const candidates = selectRefreshCandidates(listQueued(), touched, {
        red,
        onSkip: (pr, why) => {
            if (selected(pr)) log(`PR #${pr.number}: ${why}`);
        },
    }).filter((c) => selected(c.pr));
    if (candidates.length === 0) {
        log("no queued PR to refresh");
        return 0;
    }
    for (const { pr, reason } of candidates) {
        const outcome = refreshPr(primary, pr, {
            prepare: defaultPrepare,
            push: !dryRun,
        });
        switch (outcome.kind) {
            case "unchanged":
                log(`PR #${pr.number} (${reason}): already on the base tip`);
                break;
            case "pushed":
                log(
                    `PR #${pr.number} (${reason}): ${dryRun ? "would push" : "pushed"} ${outcome.from.slice(0, 9)} → ${outcome.to.slice(0, 9)}`
                );
                break;
            case "skipped":
                log(
                    `PR #${pr.number} (${reason}): left queued — ${outcome.reason}`
                );
                break;
            case "conflict":
                log(
                    `PR #${pr.number} (${reason}): conflicts in ${outcome.paths.join(", ")} — ${dryRun ? "would label" : "labelling"} land-failed`
                );
                if (!dryRun) {
                    try {
                        gh(labelArgs.failed(pr.number));
                        gh([
                            "pr",
                            "comment",
                            String(pr.number),
                            "--body",
                            conflictComment({
                                paths: outcome.paths,
                                base: BASE_BRANCH,
                                repairable:
                                    issueOfBranch(pr.headRefName) !== null,
                            }),
                        ]);
                    } catch (err) {
                        // One PR's label/comment failure never stops the rest.
                        log(
                            `PR #${pr.number}: labelling failed — ${(err as Error).message.split("\n")[0]}`
                        );
                    }
                }
                break;
        }
    }
    return 0;
}

if (import.meta.main) process.exit(main());
