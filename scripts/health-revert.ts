#!/usr/bin/env bun
/**
 * The RED ladder's revert rung (issue #5646, ADR 0156 Amendment I rung 5,
 * owner's decision of 2026-10-14): the culprit the bisect named is reverted
 * on a branch off the base tip, and the revert goes through the queue as the
 * standing RED's declared repair.
 *
 *   bun scripts/health-revert.ts --sha <red> --culprit <sha> [--base <sha>] [--why <text>] [--dry-run]
 *
 * In order: the attempt is recorded on the pivot (`health-fix-attempt`,
 * rung `revert`) before anything else, so a second ladder run waits — and
 * when it cannot be, nothing is made (exit 4, no re-dispatch); the revert is
 * made in a throwaway worktree beside the primary checkout — a later commit
 * the culprit's revert conflicts with is reverted together with it, in the
 * same PR (`lib/health-revert-set.ts`); a set past
 * `MAX_REVERT_SET` records the rung `stuck` with a `cap:` note naming every
 * commit (exit 3, the next ladder run stops on it); a conflict no later
 * commit explains records the rung `stuck` and exits 3, which the next
 * ladder run hands to the fixer (ADR 0158 § 3); every card the
 * revert drops from `ready` is acknowledged in the revert commit, `trackedBy`
 * the culprit's reopened issue, so `check:oracle` admits the shrink;
 * then a repair issue is
 * filed and recorded on the pivot (`health-fix`, what `base-health` admits a
 * repair by), the branch (`fix/issue-<repair issue>`, issue #6071) pushed, the PR opened and labelled `ready-to-land`,
 * and every reverted PR's closing issues reopened with the evidence and
 * `ready-for-agent` for a fresh pass, natively blocked by the repair issue
 * until the revert lands. Any other failure is a failed TRY (`transient:`,
 * exit 1): the ladder retries up to `MAX_REVERT_TRIES`, reusing the issue
 * and PR an earlier try made. `--dry-run` makes the revert to prove it
 * applies, and pushes, files and records nothing.
 *
 * Invoked by `health:fix ladder` (`scripts/health-fix.ts`); the decisions
 * and every text it writes are `lib/health-ladder.ts`'s. Exit 0: the revert
 * PR is queued (or the dry run applied); 1: a failed try; 2: usage; 3: the
 * revert does not apply; 4: nothing recorded, nothing made.
 * docs/guides/github-pipeline.md § health-fix.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { CLAIM_LABEL, PR_OPEN_LABEL } from "./lib/claim-labels";
import { prOfSubject } from "./lib/health-bisect";
import { fixAttemptStore, type FixAttempt } from "./lib/health-fix-attempts";
import {
    CAP_NOTE,
    commitRef,
    issuesToReopen,
    REVERT_UNRECORDED,
    TRANSIENT_NOTE,
    reopenComment,
    revertBranch,
    revertIssueBody,
    revertIssueTitle,
    revertAcknowledgements,
    revertPrBody,
    type Culprit,
} from "./lib/health-ladder";
import { recordPivotRepairIssue } from "./lib/health-pivot";
import { planRevertSet } from "./lib/health-revert-set";
import { evidenceStore, machineName } from "./lib/health-verdict-store";
import { READY_LABEL } from "./lib/land-labels";
import { parseLockfile } from "./lib/oracle-lockfile";
import {
    REGRESSION_LEDGER_PATH,
    ledgerTextWith,
    readyRegressions,
} from "./lib/oracle-state-regressions";
import { primaryCheckout } from "./lib/primary-checkout";

const SHA = /^[0-9a-f]{40}$/;
const LOCKFILE = "data/oracle-compiled.json";

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

function run(
    cmd: string,
    args: string[],
    cwd: string
): { ok: boolean; out: string; err: string } {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    return {
        ok: r.status === 0,
        out: (r.stdout ?? "").trim(),
        err: (r.stderr ?? "").trim(),
    };
}

function must(cmd: string, args: string[], cwd: string): string {
    const r = run(cmd, args, cwd);
    if (!r.ok) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.err}`);
    return r.out;
}

/** The PR number a `gh pr create` URL ends with, or null. */
export function prNumberOfUrl(url: string): number | null {
    const m = /\/pull\/(\d+)\s*$/.exec(url.trim());
    return m ? Number(m[1]) : null;
}

function main(): number {
    const red = arg("--sha");
    const culpritArg = arg("--culprit");
    const why = arg("--why") ?? "the RED ladder's last resort";
    const dryRun = process.argv.includes("--dry-run");
    if (red === undefined || !SHA.test(red) || culpritArg === undefined) {
        console.error(
            "usage: health-revert.ts --sha <red full sha> --culprit <sha> [--base <sha>] [--attempt <n>] [--why <text>] [--dry-run]"
        );
        return 2;
    }
    const attemptNo = Number(arg("--attempt") ?? "1");
    const root = primaryCheckout(process.cwd());
    const say = (line: string) => console.log(`health-revert: ${line}`);
    const attempts = fixAttemptStore(root);
    const record = (
        outcome: FixAttempt["outcome"],
        extra: { pr?: number; note?: string } = {}
    ) => {
        if (dryRun) return;
        attempts.write({
            sha: red,
            outcome,
            rung: "revert",
            attempt: attemptNo,
            machine: machineName(),
            at: new Date().toISOString(),
            ...extra,
        });
    };
    // Before anything is made: a second ladder run must see the rung taken.
    // Unrecorded, nothing is made — and the ladder must not re-dispatch.
    try {
        record("attempting", { note: `revert ${culpritArg}` });
    } catch (e) {
        console.error(
            `health-revert: the revert could not be recorded — ${(e as Error).message}`
        );
        return REVERT_UNRECORDED;
    }

    const wt = join(root, "..", `tolaria-revert-${process.pid}`);
    let made = false;
    try {
        must(
            "git",
            ["fetch", "--no-tags", "--quiet", "origin", BASE_BRANCH],
            root
        );
        const full = must(
            "git",
            ["rev-parse", "--verify", `${culpritArg}^{commit}`],
            root
        );
        const subject = must("git", ["log", "-1", "--format=%s", full], root);
        const culprit: Culprit = {
            sha: full.slice(0, 12),
            pr: prOfSubject(subject),
        };
        // Detached: the branch is named after the repair issue, filed only
        // once the revert applies; it is pushed from HEAD, never checked out
        // here, so no local branch can be held by a killed run's worktree.
        run("git", ["worktree", "prune"], root);
        // `--base`: the tip the ladder read its facts on (issue #6766) — a
        // commit landed since was never checked for a declared repair.
        must(
            "git",
            ["worktree", "add", "--detach", wt, arg("--base") ?? ORIGIN_BASE],
            root
        );
        made = true;
        const cardsAt = () =>
            parseLockfile(readFileSync(join(wt, LOCKFILE), "utf8")).cards;
        const baseCards = cardsAt();
        const base = must("git", ["rev-parse", "HEAD"], wt);
        const plan = planRevertSet({ wt, culprit: full, base });
        if (plan.kind === "cap") {
            const names = plan.set.map(commitRef).join(", ");
            say(
                `the revert of ${culprit.sha} needs ${plan.set.length} commits reverted together: ${names}`
            );
            record("stuck", { note: `${CAP_NOTE}${names}` });
            return 3;
        }
        if (plan.kind === "conflict") {
            const note = `the revert of ${culprit.sha} does not apply on ${BASE_BRANCH} — a later commit depends on it`;
            say(`${note} (${plan.paths.join(", ") || "no path named"})`);
            record("stuck", { note });
            return 3;
        }
        // Newest first, the culprit last: the later commits reverted with it.
        const dependents = plan.set.slice(0, -1);
        for (const c of plan.set)
            say(`reverted ${commitRef(c)} \`${c.sha}\` (${c.subject})`);
        // The cards the culprit graduated leave `ready` with the revert:
        // `check:oracle` refuses that shrink unacknowledged (issue #6936).
        const losses = readyRegressions(baseCards, cardsAt());
        if (losses.length > 0)
            say(`the revert drops ${losses.length} card(s) from ready`);
        if (dryRun) {
            say("(dry run) the revert applies — nothing pushed or filed");
            return 0;
        }

        let evidence: string | null = null;
        try {
            evidence = evidenceStore(root).read(red);
        } catch {
            evidence = null;
        }
        // A retry after a failed try reuses what that try made.
        const title = revertIssueTitle(culprit, subject);
        const issue =
            openIssueTitled(root, title) ??
            issueOfUrl(
                must(
                    "gh",
                    [
                        "issue",
                        "create",
                        "--title",
                        title,
                        "--body",
                        revertIssueBody({
                            red,
                            culprit,
                            why,
                            evidence,
                            dependents,
                        }),
                        "--label",
                        "bug",
                        "--label",
                        "area:workflow",
                    ],
                    root
                )
            );
        // What `base-health` admits the revert PR by: the repair issue,
        // recorded against the standing RED. Unrecorded, the queue would
        // hold the PR forever — a failed try instead.
        const recorded = recordPivotRepairIssue(root, issue, { ladder: true });
        if (recorded === null)
            throw new Error(
                `issue #${issue} could not be recorded as the RED's repair`
            );
        say(recorded);

        const closedBy = (pr: number | null): number[] =>
            pr === null
                ? []
                : must(
                      "gh",
                      [
                          "pr",
                          "view",
                          String(pr),
                          "--json",
                          "closingIssuesReferences",
                          "--jq",
                          ".closingIssuesReferences[].number",
                      ],
                      root
                  )
                      .split("\n")
                      .filter(Boolean)
                      .map(Number);
        const reopening = issuesToReopen(culprit, dependents, closedBy);
        const culpritIssues = reopening.map((r) => r.n);

        if (losses.length > 0) {
            const ledger = join(wt, REGRESSION_LEDGER_PATH);
            writeFileSync(
                ledger,
                ledgerTextWith(
                    readFileSync(ledger, "utf8"),
                    revertAcknowledgements(losses, {
                        culprit,
                        culpritIssues,
                        dependents,
                    })
                )
            );
            must("git", ["add", REGRESSION_LEDGER_PATH], wt);
            // No hooks: `git revert` ran none, and a lint-staged run in the
            // throwaway worktree would turn a good revert into a failed try.
            must("git", ["commit", "--amend", "--no-edit", "--no-verify"], wt);
            say(`acknowledged ${losses.length} ready loss(es) in the revert`);
        }

        const branch = revertBranch(issue);
        must(
            "git",
            ["push", "--force", "origin", `HEAD:refs/heads/${branch}`],
            wt
        );
        const open = must(
            "gh",
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
            root
        );
        const pr = open
            ? Number(open)
            : prNumberOfUrl(
                  must(
                      "gh",
                      [
                          "pr",
                          "create",
                          "--base",
                          BASE_BRANCH,
                          "--head",
                          branch,
                          "--title",
                          `${title} (issue #${issue})`,
                          "--body",
                          revertPrBody({
                              issue,
                              red,
                              culprit,
                              revertedSha: full,
                              culpritIssues,
                              dependents,
                          }),
                      ],
                      wt
                  )
              );
        if (pr === null || !Number.isInteger(pr))
            throw new Error("gh pr create named no PR");
        must(
            "gh",
            ["pr", "edit", String(pr), "--add-label", READY_LABEL],
            root
        );
        record("attempting", { pr, note: `revert ${culprit.sha}` });
        say(`PR #${pr} queued as the repair of ${red.slice(0, 8)}`);

        for (const { n, dependent } of reopening)
            reopenForAFreshPass(
                root,
                n,
                dependent === undefined
                    ? [issue]
                    : [
                          issue,
                          ...reopening
                              .filter((r) => r.dependent === undefined)
                              .map((r) => r.n),
                      ],
                {
                    red,
                    culprit,
                    revertPr: pr,
                    evidence,
                    dependent,
                }
            ).forEach(say);
        return 0;
    } catch (e) {
        // Not the revert itself: an API error, a refused push — retried
        // (`MAX_REVERT_TRIES`), never a stop on the first outage.
        const note = (e as Error).message;
        console.error(`health-revert: ${note}`);
        try {
            record("stuck", {
                note: `${TRANSIENT_NOTE}${note}`.slice(0, 100),
            });
        } catch {
            // The next run reads the stale `attempting` as a stop.
        }
        return 1;
    } finally {
        if (made)
            spawnSync("git", ["worktree", "remove", "--force", wt], {
                cwd: root,
            });
    }
}

function issueOfUrl(url: string): number {
    const n = Number(/\/issues\/(\d+)\s*$/.exec(url)?.[1]);
    if (!Number.isInteger(n))
        throw new Error(`no issue number in ${JSON.stringify(url)}`);
    return n;
}

function openIssueTitled(root: string, title: string): number | null {
    const r = run(
        "gh",
        [
            "issue",
            "list",
            "--state",
            "open",
            "--search",
            `"${title}" in:title`,
            "--json",
            "number,title",
            "--limit",
            "20",
        ],
        root
    );
    if (!r.ok) return null;
    try {
        return (
            (
                JSON.parse(r.out || "[]") as { number: number; title: string }[]
            ).find((i) => i.title === title)?.number ?? null
        );
    } catch {
        return null;
    }
}

/**
 * The culprit's issue back in the queue, for a fresh pass — but natively
 * BLOCKED BY the revert's repair issue, which the revert PR closes when it
 * lands: a revert that never lands leaves it blocked, never re-implemented
 * on top of itself. A dependent's issue is blocked by the culprit's issues
 * too (issue #6766): it re-lands on top of the culprit, never before it.
 * Returns one line per act, failures named.
 */
function reopenForAFreshPass(
    root: string,
    n: number,
    blockers: readonly number[],
    comment: Parameters<typeof reopenComment>[0]
): string[] {
    const out: string[] = [];
    const act = (what: string, args: string[]) => {
        const r = run("gh", args, root);
        out.push(
            r.ok
                ? `issue #${n}: ${what}`
                : `issue #${n}: ${what} FAILED — ${r.err}`
        );
        return r;
    };
    for (const blocker of blockers) {
        const id = run(
            "gh",
            ["api", `repos/{owner}/{repo}/issues/${blocker}`, "--jq", ".id"],
            root
        );
        act(`blocked by issue #${blocker}`, [
            "api",
            "-X",
            "POST",
            `repos/{owner}/{repo}/issues/${n}/dependencies/blocked_by`,
            "-F",
            `issue_id=${id.out}`,
        ]);
    }
    act("reopened", [
        "issue",
        "reopen",
        String(n),
        "--comment",
        reopenComment(comment),
    ]);
    // The old claim's labels would hide it from the picker. One call per
    // label: one the issue does not carry fails its own call only.
    act("queued (ready-for-agent)", [
        "issue",
        "edit",
        String(n),
        "--add-label",
        "ready-for-agent",
    ]);
    for (const l of [CLAIM_LABEL, PR_OPEN_LABEL])
        run("gh", ["issue", "edit", String(n), "--remove-label", l], root);
    return out;
}

if (import.meta.main) process.exit(main());
