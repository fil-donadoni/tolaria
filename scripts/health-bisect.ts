#!/usr/bin/env bun
/**
 * The RED ladder's first rungs (issue #5645, PRD #5620 story 57): the flake
 * check and the culprit bisect. Decisions: `lib/health-bisect.ts`.
 *
 *   bun run health:bisect ladder [--sha <sha>] [--dry-run]
 *       The RED at <sha> (default: this machine's last health run, when it
 *       was RED) re-runs fresh at the same sha. Not reproduced → the RED
 *       closes as GREEN and the flaky test is filed. Reproduced → bisect.
 *       Exit 0: no RED stands (none, or closed GREEN); 1: the RED stands
 *       (or the last run was INFRA); 2: usage.
 *   bun run health:bisect bisect --sha <sha> [--good <sha>] [--files a,b] [--dry-run]
 *       The bisect alone: the RED's failing files between the last GREEN
 *       (or <good>) and <sha>; prints the culprit line and, unless
 *       --dry-run, adds it to the RED's published evidence.
 *
 * Runs from the primary checkout or a job's worktree of it (`health.yml`);
 * each probe is a throwaway worktree beside the primary, bootstrapped with
 * `worktree:init`. Its log: `.claude/telemetry/health/<sha12>.ladder.log`.
 * docs/guides/github-pipeline.md § health.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
import {
    bisectFirstRed,
    culpritLine,
    flakeVerdict,
    flakyIssueBody,
    flakyIssueTitle,
    flakySubjects,
    freshRunPlan,
    lastGreenOf,
    vitestCommands,
    type FreshRun,
    type ProbeOutcome,
} from "./lib/health-bisect";
import { evidenceFiles, withEvidenceLine } from "./lib/health-evidence";
import {
    healthGateEnv,
    healthStepArgs,
    HEALTH_SCRIPTS,
} from "./lib/health-step";
import {
    evidenceStore,
    HEALTH_DIR_REL,
    HISTORY_DEPTH,
    machineName,
    verdictStore,
    type Verdict,
} from "./lib/health-verdict-store";
import { primaryCheckout } from "./lib/primary-checkout";

type Plan = Exclude<FreshRun, { kind: "none" }>;

const SHA = /^[0-9a-f]{40}$/;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

function git(root: string, args: string[]): string {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0)
        throw new Error(
            `git ${args.join(" ")} failed: ${(r.stderr ?? "").trim()}`
        );
    return (r.stdout ?? "").trim();
}

interface Ctx {
    root: string;
    sha: string;
    log: string;
    dryRun: boolean;
}

function note(ctx: Ctx, line: string): void {
    console.log(`health-bisect: ${line}`);
    appendFileSync(ctx.log, `[${new Date().toISOString()}] ${line}\n`);
}

let worktrees = 0;

/** `fn` in a throwaway worktree at `sha`, bootstrapped; `infra` when the
 *  worktree or its bootstrap could not be made. */
function inWorktree(
    ctx: Ctx,
    sha: string,
    fn: (wt: string) => ProbeOutcome
): ProbeOutcome {
    const wt = join(
        ctx.root,
        "..",
        `tolaria-bisect-${process.pid}-${++worktrees}`
    );
    try {
        git(ctx.root, ["worktree", "add", "--detach", wt, sha]);
    } catch (e) {
        note(
            ctx,
            `worktree at ${sha.slice(0, 8)} failed — ${(e as Error).message}`
        );
        return "infra";
    }
    try {
        const init = run(ctx, wt, "bun", ["run", "worktree:init"], {});
        if (init !== 0) {
            note(ctx, `worktree:init at ${sha.slice(0, 8)} exited ${init}`);
            return "infra";
        }
        return fn(wt);
    } finally {
        spawnSync("git", ["worktree", "remove", "--force", wt], {
            cwd: ctx.root,
        });
    }
}

/** Runs one command in `cwd`, its output appended to the ladder log. */
function run(
    ctx: Ctx,
    cwd: string,
    cmd: string,
    args: string[],
    env: Record<string, string>
): number | null {
    appendFileSync(ctx.log, `$ ${cmd} ${args.join(" ")}\n`);
    const r = spawnSync(cmd, args, {
        cwd,
        env: { ...healthGateEnv(process.env), ...env },
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });
    appendFileSync(
        ctx.log,
        `${r.stdout ?? ""}${r.stderr ?? ""}\nexit ${r.status}\n`
    );
    return r.status;
}

/** The failing files at one commit: `green` when every one passes, or when
 *  the commit does not have any of them yet. */
function probeTests(
    ctx: Ctx,
    wt: string,
    files: readonly string[]
): ProbeOutcome {
    const present = files.filter((f) => existsSync(join(wt, f)));
    if (present.length === 0) return "green";
    for (const c of vitestCommands(present))
        if (run(ctx, wt, "bunx", c.args, c.env) !== 0) return "red";
    return "green";
}

function freshRun(ctx: Ctx, plan: Plan): ProbeOutcome {
    return inWorktree(ctx, ctx.sha, (wt) =>
        plan.kind === "tests"
            ? probeTests(ctx, wt, plan.files)
            : run(ctx, wt, "bun", healthStepArgs(plan.step), {}) === 0
              ? "green"
              : "red"
    );
}

function runUrl(): string | undefined {
    const {
        GITHUB_SERVER_URL: s,
        GITHUB_REPOSITORY: r,
        GITHUB_RUN_ID: id,
    } = process.env;
    return s && r && id ? `${s}/${r}/actions/runs/${id}` : undefined;
}

/** Files the flake, once per subject: an open issue of the same title gets
 *  a comment instead. Never fatal — the GREEN is already written. */
function fileFlake(ctx: Ctx, plan: Plan, evidence: string | undefined): void {
    for (const subject of flakySubjects(plan)) {
        const title = flakyIssueTitle(plan, subject);
        const body = flakyIssueBody({
            subject,
            sha: ctx.sha,
            step: plan.step,
            evidence,
            runUrl: runUrl(),
        });
        if (ctx.dryRun) {
            note(ctx, `(dry run) would file "${title}"`);
            continue;
        }
        const found = spawnSync(
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
            { cwd: ctx.root, encoding: "utf8" }
        );
        let existing: number | undefined;
        try {
            existing = (
                JSON.parse(found.stdout || "[]") as {
                    number: number;
                    title: string;
                }[]
            ).find((i) => i.title === title)?.number;
        } catch {
            existing = undefined;
        }
        const r =
            existing !== undefined
                ? spawnSync(
                      "gh",
                      ["issue", "comment", String(existing), "--body", body],
                      { cwd: ctx.root, encoding: "utf8" }
                  )
                : spawnSync(
                      "gh",
                      [
                          "issue",
                          "create",
                          "--title",
                          title,
                          "--body",
                          body,
                          "--label",
                          "bug",
                          "--label",
                          "area:workflow",
                          "--label",
                          "needs-triage",
                      ],
                      { cwd: ctx.root, encoding: "utf8" }
                  );
        note(
            ctx,
            r.status === 0
                ? `${existing !== undefined ? `commented on issue #${existing}` : "filed"} "${title}" ${(r.stdout ?? "").trim()}`
                : `could not file "${title}" — ${(r.stderr ?? "").trim()}`
        );
    }
}

/** The bisect over the base's first-parent commits after the last GREEN. */
function bisect(ctx: Ctx, files: readonly string[], goodArg?: string): string {
    const store = verdictStore(ctx.root);
    let good = goodArg ?? null;
    if (good === null) {
        const ancestors = git(ctx.root, [
            "rev-list",
            "--first-parent",
            `--max-count=${HISTORY_DEPTH}`,
            `${ctx.sha}^`,
        ])
            .split("\n")
            .filter(Boolean);
        good = lastGreenOf(ancestors, (sha) => {
            try {
                return store.read(sha);
            } catch {
                return null;
            }
        });
    }
    if (good === null)
        return `- **culprit:** not named — no GREEN in the ${HISTORY_DEPTH} commits before \`${ctx.sha.slice(0, 12)}\``;
    const commits = git(ctx.root, [
        "rev-list",
        "--first-parent",
        "--reverse",
        `${good}..${ctx.sha}`,
    ])
        .split("\n")
        .filter(Boolean);
    note(
        ctx,
        `bisecting ${commits.length} commit(s) from GREEN ${good.slice(0, 8)} on ${files.length} file(s)`
    );
    const result = bisectFirstRed(commits, (sha) => {
        const outcome = inWorktree(ctx, sha, (wt) =>
            probeTests(ctx, wt, files)
        );
        note(ctx, `probe ${sha.slice(0, 8)}: ${outcome}`);
        return outcome;
    });
    const subject = result.culprit
        ? git(ctx.root, ["log", "-1", "--format=%s", result.culprit])
        : undefined;
    return culpritLine({ result, good, commits: commits.length, subject });
}

/** Adds `line` to the RED's published evidence. Never fatal. */
function publishCulprit(ctx: Ctx, line: string): void {
    if (ctx.dryRun) return;
    try {
        const ev = evidenceStore(ctx.root);
        const body = ev.read(ctx.sha);
        if (body === null) {
            note(ctx, "no published evidence to carry the culprit");
            return;
        }
        note(
            ctx,
            `evidence updated — ${ev.publish(ctx.sha, withEvidenceLine(body, line))}`
        );
    } catch (e) {
        note(
            ctx,
            `the culprit could not be published — ${(e as Error).message}`
        );
    }
}

function readEvidence(root: string, sha: string): string | null {
    try {
        return evidenceStore(root).read(sha);
    } catch {
        return null;
    }
}

/** The sha `ladder` acts on when none is given: this machine's last run's. */
function lastRunSha(root: string): { sha: string; status: string } | null {
    try {
        const last = JSON.parse(
            readFileSync(join(root, HEALTH_DIR_REL, "last.json"), "utf8")
        ) as {
            sha: string;
            status: string;
        };
        return SHA.test(last.sha) ? last : null;
    } catch {
        return null;
    }
}

function ladder(ctx: Ctx): number {
    const store = verdictStore(ctx.root);
    let verdict: Verdict | null;
    try {
        verdict = store.read(ctx.sha);
    } catch (e) {
        note(
            ctx,
            `the verdict store could not be read — ${(e as Error).message}`
        );
        return 1;
    }
    const evidence = readEvidence(ctx.root, ctx.sha);
    const plan = freshRunPlan(
        verdict,
        evidence ? evidenceFiles(evidence) : [],
        HEALTH_SCRIPTS
    );
    if (plan.kind === "none") {
        note(ctx, `${ctx.sha.slice(0, 8)}: ${plan.reason}`);
        return verdict?.status === "red" ? 1 : 0;
    }
    note(
        ctx,
        `fresh run of ${ctx.sha.slice(0, 8)}: ${plan.kind === "tests" ? plan.files.join(", ") : `bun run ${plan.step}`}`
    );
    const outcome = freshRun(ctx, plan);
    if (outcome === "infra") {
        note(ctx, "the fresh run could not run — the RED stands, unconfirmed");
        return 1;
    }
    if (outcome === "green") {
        const v = flakeVerdict({
            sha: ctx.sha,
            plan,
            machine: machineName(),
            at: new Date().toISOString(),
            log: runUrl(),
        });
        if (ctx.dryRun) note(ctx, "(dry run) would close the RED as GREEN");
        else {
            const out = store.write(v);
            note(
                ctx,
                out.written
                    ? "not reproduced — the RED closed as GREEN"
                    : `GREEN not written — ${out.reason}`
            );
            if (!out.written) return 1;
        }
        fileFlake(ctx, plan, verdict?.log);
        return 0;
    }
    note(ctx, "reproduced — the RED stands");
    if (plan.kind === "tests") {
        const line = bisect(ctx, plan.files);
        note(ctx, line);
        publishCulprit(ctx, line);
    } else note(ctx, `a failed ${plan.step} names no test file — not bisected`);
    return 1;
}

function main(): number {
    const cmd = process.argv[2];
    const root = primaryCheckout(process.cwd());
    const dryRun = process.argv.includes("--dry-run");
    let sha = arg("--sha");
    if (cmd !== "ladder" && cmd !== "bisect") {
        console.error(
            "usage: health:bisect ladder [--sha <sha>] | bisect --sha <sha> [--good <sha>] [--files a,b] [--dry-run]"
        );
        return 2;
    }
    git(root, [
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--quiet",
        "origin",
        BASE_BRANCH,
    ]);
    if (sha === undefined && cmd === "ladder") {
        const last = lastRunSha(root);
        if (last === null || last.status === "green") {
            console.log(
                "health-bisect: the last health run on this machine left no RED — nothing to do"
            );
            return 0;
        }
        if (last.status !== "red") {
            console.log(
                `health-bisect: the last health run was ${last.status.toUpperCase()} @ ${last.sha.slice(0, 8)} — nothing to confirm`
            );
            return 1;
        }
        sha = last.sha;
    }
    if (sha === undefined || !SHA.test(sha)) {
        console.error(
            `health-bisect: --sha must be a full 40-hex sha (got ${sha ?? "none"})`
        );
        return 2;
    }
    const dir = join(root, HEALTH_DIR_REL);
    mkdirSync(dir, { recursive: true });
    const ctx: Ctx = {
        root,
        sha,
        log: join(dir, `${sha.slice(0, 12)}.ladder.log`),
        dryRun,
    };
    if (cmd === "ladder") return ladder(ctx);
    const files =
        arg("--files")?.split(",").filter(Boolean) ??
        evidenceFiles(readEvidence(root, sha) ?? "");
    if (files.length === 0) {
        console.error(
            "health-bisect: no failing files (--files, or the RED's evidence)"
        );
        return 2;
    }
    const line = bisect(ctx, files, arg("--good"));
    note(ctx, line);
    publishCulprit(ctx, line);
    return 0;
}

process.exit(main());
