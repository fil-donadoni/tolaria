#!/usr/bin/env bun
/**
 * `bun run base:drift [--rebase] [--pr N] [--no-prs] [--json]` — the
 * base-drift preflight (issue #6647, `lib/base-drift.ts`): fetch the base,
 * print the four answers (behind, overlap, coupled artefacts, queued PRs
 * sharing files) and the verdict, write the receipt under the worktree's git
 * dir (`RECEIPT_FILE`). Seconds, read-only unless `--rebase`.
 *
 * Exit codes — a step reads the verdict, never the prose:
 *   0  CURRENT (or REBASE with `--rebase`: rebased clean, the receipt is the
 *      rebased head's)
 *   3  REBASE — behind, nothing shared; rebase before any verification
 *   4  OVERLAP — behind and the base touched what this branch touches
 *      (`--rebase` never rebases here, nor when the rebase conflicts: it is
 *      aborted and the branch stays where it was)
 *
 * `--pr N` leaves the branch's own PR out of answer 4; `--no-prs` skips the
 * one `gh` read (offline). `--rebase` rebases onto the fetched base; the push
 * stays the caller's (`git push --force-with-lease`).
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    buildReceipt,
    buildReport,
    driftVerdict,
    measureDrift,
    renderReport,
    RECEIPT_FILE,
    type OpenPr,
} from "./lib/base-drift";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { gh } from "./lib/gh";

function git(args: string[]): string {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout;
}

/** The open PRs with their files — one paginated read, [] when it fails. */
export function readOpenPrs(): OpenPr[] {
    try {
        return JSON.parse(
            gh([
                "pr",
                "list",
                "--state",
                "open",
                "--limit",
                "100",
                "--json",
                "number,title,labels,files,headRefName,author",
            ])
        ) as OpenPr[];
    } catch (err) {
        console.error(
            `base:drift: NOTE — open PRs not read (${(err as Error).message.split("\n")[0]}); answer 4 is empty`
        );
        return [];
    }
}

function main(): void {
    const argv = process.argv.slice(2);
    const json = argv.includes("--json");
    const doRebase = argv.includes("--rebase");
    const noPrs = argv.includes("--no-prs");
    const prIdx = argv.indexOf("--pr");
    const ownPr =
        prIdx >= 0 && argv[prIdx + 1] !== undefined
            ? Number(argv[prIdx + 1]!.replace(/^#/, ""))
            : null;
    if (git(["status", "--porcelain"]).trim() !== "" && doRebase) {
        console.error(
            "base:drift: working tree is dirty — commit first; a rebase needs a clean tree"
        );
        process.exit(2);
    }
    git(["fetch", "-q", "origin", BASE_BRANCH]);
    const gitSeam = { run: git };
    const open = noPrs ? [] : readOpenPrs();
    let report = buildReport(measureDrift(gitSeam, ORIGIN_BASE), open, ownPr);
    let verdict = driftVerdict(report);
    let exit =
        verdict.kind === "current" ? 0 : verdict.kind === "rebase" ? 3 : 4;
    if (verdict.kind === "rebase" && doRebase) {
        const r = spawnSync("git", ["rebase", "-q", ORIGIN_BASE], {
            encoding: "utf8",
        });
        if (r.status !== 0) {
            spawnSync("git", ["rebase", "--abort"]);
            console.error(
                `base:drift: the rebase onto ${ORIGIN_BASE} conflicted and was aborted — the branch is where it was; rebase by hand`
            );
            exit = 4;
        } else {
            report = buildReport(
                measureDrift(gitSeam, ORIGIN_BASE),
                open,
                ownPr
            );
            verdict = driftVerdict(report);
            exit = 0;
            console.log(
                `base:drift: rebased onto ${ORIGIN_BASE} @ ${report.baseSha.slice(0, 10)} — push with \`git push --force-with-lease\``
            );
        }
    }
    const receipt = buildReceipt(report, verdict, new Date());
    const gitDir = git(["rev-parse", "--git-dir"]).trim();
    writeFileSync(join(gitDir, RECEIPT_FILE), JSON.stringify(receipt, null, 2));
    if (json) console.log(JSON.stringify({ ...report, verdict }, null, 2));
    else console.log(renderReport(report, verdict));
    process.exit(exit);
}

if (import.meta.main) {
    try {
        main();
    } catch (err) {
        console.error(`✗ base:drift: ${(err as Error).message}`);
        process.exit(1);
    }
}
