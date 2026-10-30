#!/usr/bin/env bun
/**
 * The RED ladder's first rungs (issue #5645, PRD #5620 story 57): the flake
 * check and the culprit bisect. Decisions: `lib/health-bisect.ts`.
 *
 *   bun run health:bisect ladder [--sha <sha>] [--dry-run]
 *       The RED at <sha> (default: this machine's last health run, when it
 *       was RED) re-runs fresh at the same sha. Not reproduced → the RED
 *       closes as GREEN and the flaky test is filed — on the RED's runner
 *       class only; on another, the RED stands as environment-dependent
 *       (issue #5858). Reproduced → bisect.
 *       Exit 0: no RED stands (none, or closed GREEN); 1: the RED stands
 *       (or the last run was INFRA); 2: usage.
 *       A fresh run passing the failing files alone in a shared-worker
 *       project re-runs that project whole first (issue #7584).
 *   bun run health:bisect bisect --sha <sha> [--good <sha>] [--files a,b] [--projects p,q] [--dry-run]
 *       The bisect alone: the RED's failing tests (its evidence's FAIL
 *       lines, or the whole --files; inside the whole --projects when
 *       given) between the last GREEN (or <good>) and
 *       <sha>; prints the culprit lines and, unless --dry-run, adds them to
 *       the RED's published evidence.
 *
 * Runs from the primary checkout or a job's worktree of it (`health.yml`);
 * each probe is a throwaway worktree beside the primary, bootstrapped with
 * `worktree:init` — a bisect probe's then regenerated as the queue draft
 * (`derive:regenerate`, `draft` role). Its log: `.claude/telemetry/health/<sha12>.ladder.log`.
 * docs/guides/github-pipeline.md § health.
 */
import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
import {
    attributeMaintenance,
    bisectCulprits,
    bisectTests,
    culpritLines,
    failedTests,
    flakyIssueBody,
    flakyIssueTitle,
    flakySubjects,
    bisectWorktreePid,
    freshRunPlan,
    LADDER_MARK,
    ladderRed,
    laddered,
    lastGreenOf,
    PROBE_BOOTSTRAP,
    settleFreshPass,
    settleHeldRed,
    remainingGates,
    freshRunSteps,
    probeCommands,
    scopeLabel,
    sharedWorkerProjects,
    testFileFilter,
    type FreshOutcome,
    type FreshRun,
    type ProbeOutcome,
    type ProbeScope,
    type VitestCommand,
} from "./lib/health-bisect";
import {
    evidenceFiles,
    withEvidenceLine,
    type FailingTest,
} from "./lib/health-evidence";
import {
    healthGateEnv,
    healthStepArgs,
    HEALTH_SCRIPTS,
    splitHealthGates,
} from "./lib/health-step";
import {
    evidenceStore,
    HEALTH_DIR_REL,
    HISTORY_DEPTH,
    lineageBlocks,
    machineName,
    readVerdictLineage,
    verdictStore,
    type Verdict,
} from "./lib/health-verdict-store";
import { clearDeferredRed, readDeferredRed } from "./lib/health-verdict-job";
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

/** `fn` in a throwaway worktree at `sha`, bootstrapped — a bisect probe's
 *  as the queue draft (`PROBE_BOOTSTRAP`, `draft`); `infra` when the
 *  worktree or its bootstrap could not be made. */
function inWorktree(
    ctx: Ctx,
    sha: string,
    fn: (wt: string) => ProbeOutcome,
    opts: { draft?: boolean } = {}
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
        const steps = opts.draft
            ? PROBE_BOOTSTRAP.steps
            : [["run", "worktree:init"]];
        const env = opts.draft ? { ...PROBE_BOOTSTRAP.env } : {};
        for (const step of steps) {
            const status = run(ctx, wt, "bun", [...step], env).status;
            if (status !== 0) {
                note(
                    ctx,
                    `${step.join(" ")} at ${sha.slice(0, 8)} exited ${status}`
                );
                return "infra";
            }
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
): { status: number | null; output: string } {
    appendFileSync(ctx.log, `$ ${cmd} ${args.join(" ")}\n`);
    const r = spawnSync(cmd, args, {
        cwd,
        env: { ...healthGateEnv(process.env), ...env },
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    appendFileSync(ctx.log, `${output}\nexit ${r.status}\n`);
    return { status: r.status, output };
}

/** Whether the commit checked out at `wt` has `t`'s file — in a sharded
 *  family, any shard file of it. */
function hasTestFile(wt: string, t: FailingTest): boolean {
    const filter = testFileFilter(t);
    if (filter === t.file) return existsSync(join(wt, t.file));
    try {
        return readdirSync(join(wt, dirname(filter))).some((n) =>
            n.startsWith(basename(filter))
        );
    } catch {
        return false;
    }
}

/** The failing tests that fail at one commit, looked for in `scope`: none
 *  when every one passes, or when the commit does not have it yet (no file,
 *  or no test of that name — vitest skips it). */
function probeTests(
    ctx: Ctx,
    wt: string,
    tests: readonly FailingTest[],
    scope: ProbeScope,
    opts: { exactFiles?: boolean; env?: Readonly<Record<string, string>> } = {}
): FailingTest[] {
    const present = tests.filter((t) =>
        opts.exactFiles ? existsSync(join(wt, t.file)) : hasTestFile(wt, t)
    );
    if (present.length === 0) return [];
    return runCommands(ctx, wt, probeCommands(present, scope, opts), opts.env);
}

/** The failing tests among `cmds`' that their runs in `wt` failed. */
function runCommands(
    ctx: Ctx,
    wt: string,
    cmds: readonly VitestCommand[],
    env: Readonly<Record<string, string>> = {}
): FailingTest[] {
    const red: FailingTest[] = [];
    for (const c of cmds)
        red.push(
            ...failedTests(
                c,
                run(ctx, wt, "bunx", c.args, { ...env, ...c.env })
            )
        );
    return red;
}

/** The RED's failure re-run at its sha (`freshRunSteps`): the failing files
 *  alone, then their shared-worker projects whole, then every gate its run
 *  never reached — only all of them green close the RED as GREEN. */
function freshRun(
    ctx: Ctx,
    plan: Plan,
    tests: readonly FailingTest[],
    projects: readonly string[]
): FreshOutcome {
    let fresh: FreshOutcome = { outcome: "infra", scope: { kind: "files" } };
    const outcome = inWorktree(ctx, ctx.sha, (wt) => {
        fresh = freshRunSteps(
            {
                // A file the RED sha does not have is not re-run.
                plan:
                    plan.kind === "tests"
                        ? {
                              ...plan,
                              files: plan.files.filter((f) =>
                                  existsSync(join(wt, f))
                              ),
                          }
                        : plan,
                tests,
                projects,
                remaining: remainingGates(
                    plan,
                    splitHealthGates(HEALTH_SCRIPTS).offline
                ),
            },
            {
                note: (line) => note(ctx, line),
                runTests: (cmds) => runCommands(ctx, wt, cmds),
                runStep: (step) =>
                    run(ctx, wt, "bun", healthStepArgs(step), {}).status === 0,
            }
        );
        return fresh.outcome;
    });
    return outcome === "infra" ? { ...fresh, outcome } : fresh;
}

/** Drops the probe worktrees a killed ladder left beside the primary. */
function sweepStaleWorktrees(root: string): void {
    spawnSync("git", ["worktree", "prune"], { cwd: root });
    const out = spawnSync("git", ["worktree", "list", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
    });
    for (const line of (out.stdout ?? "").split("\n")) {
        if (!line.startsWith("worktree ")) continue;
        const path = line.slice("worktree ".length);
        const pid = bisectWorktreePid(path);
        if (pid === null || pid === process.pid) continue;
        let alive = false;
        try {
            process.kill(pid, 0);
            alive = true;
        } catch {
            alive = false;
        }
        if (!alive)
            spawnSync("git", ["worktree", "remove", "--force", path], {
                cwd: root,
            });
    }
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

/** The bisect over the base's first-parent commits after the last GREEN:
 *  its culprit lines, oldest culprit first. */
function bisect(
    ctx: Ctx,
    tests: readonly FailingTest[],
    scope: ProbeScope,
    goodArg?: string
): string[] {
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
        return [
            `- **culprit:** not named — no GREEN in the ${HISTORY_DEPTH} commits before \`${ctx.sha.slice(0, 12)}\``,
        ];
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
        `bisecting ${commits.length} commit(s) from GREEN ${good.slice(0, 8)} on ${tests.length} failing test(s)${scope.kind === "projects" ? `, each probe running ${scope.projects.join(", ")} whole` : ""}`
    );
    const subjectOf = (sha: string) =>
        git(ctx.root, ["log", "-1", "--format=%s", sha]);
    const bisected = bisectCulprits(commits, tests, (sha, pending) => {
        let red: FailingTest[] = [];
        const outcome = inWorktree(
            ctx,
            sha,
            (wt) => {
                red = probeTests(ctx, wt, pending, scope, {
                    env: PROBE_BOOTSTRAP.env,
                });
                return red.length > 0 ? "red" : "green";
            },
            { draft: true }
        );
        note(
            ctx,
            `probe ${sha.slice(0, 8)}: ${outcome}${outcome === "red" ? ` (${red.length} of ${pending.length})` : ""}`
        );
        return outcome === "infra" ? "infra" : red;
    });
    const report = attributeMaintenance(bisected, commits, subjectOf);
    return culpritLines({
        report,
        total: tests.length,
        good,
        commits: commits.length,
        subjectOf,
    });
}

/** Adds `lines` to the RED's published evidence. Never fatal. */
function publishCulprit(ctx: Ctx, lines: readonly string[]): void {
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
            `evidence updated — ${ev.publish(
                ctx.sha,
                lines.reduce((b, line) => withEvidenceLine(b, line), body)
            )}`
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
    let stored: Verdict | null;
    try {
        stored = store.read(ctx.sha);
    } catch (e) {
        note(
            ctx,
            `the verdict store could not be read — ${(e as Error).message}`
        );
        return 1;
    }
    const dir = join(ctx.root, HEALTH_DIR_REL);
    const { verdict, held } = ladderRed(
        stored,
        readDeferredRed(dir) as Verdict | null,
        ctx.sha
    );
    if (held)
        note(
            ctx,
            `${ctx.sha.slice(0, 8)}: the scheduled run's RED is held off the store until this fresh run (issue #6986)`
        );
    // A held RED reaches the store only once it stands.
    const settle = (code: number): number =>
        settleHeldRed(
            { held, verdict, code, dryRun: ctx.dryRun },
            {
                note: (line) => note(ctx, line),
                writeRed: (v) => store.write(v),
                clear: () => clearDeferredRed(dir),
            }
        );
    const evidence = readEvidence(ctx.root, ctx.sha);
    if (verdict?.status === "red" && laddered(evidence)) {
        note(
            ctx,
            `${ctx.sha.slice(0, 8)}: the ladder already confirmed this RED — reported once`
        );
        // A held one confirmed by a ladder whose write failed: write it now.
        return held ? settle(1) : 0;
    }
    const plan = freshRunPlan(
        verdict,
        evidence ? evidenceFiles(evidence) : [],
        HEALTH_SCRIPTS
    );
    if (plan.kind === "none") {
        note(ctx, `${ctx.sha.slice(0, 8)}: ${plan.reason}`);
        // Only a GREEN on the store means nothing stands: a missing verdict
        // (a store write that failed) or an INFRA is not one.
        return settle(verdict?.status === "green" ? 0 : 1);
    }
    note(
        ctx,
        `fresh run of ${ctx.sha.slice(0, 8)}: ${plan.kind === "tests" ? plan.files.join(", ") : `bun run ${plan.step}`}`
    );
    const tests =
        plan.kind === "tests" ? bisectTests(evidence, plan.files) : [];
    const projects =
        plan.kind === "tests" ? sharedWorkerProjects(evidence, plan.files) : [];
    const { outcome, elsewhere, scope } = freshRun(ctx, plan, tests, projects);
    if (outcome === "infra") {
        note(ctx, "the fresh run could not run — the RED stands, unconfirmed");
        return settle(1);
    }
    if (outcome === "green")
        return settle(
            settleFreshPass(
                {
                    red: verdict,
                    sha: ctx.sha,
                    plan,
                    freshMachine: machineName(),
                    ran: scopeLabel(plan, scope),
                    at: new Date().toISOString(),
                    log: runUrl(),
                    dryRun: ctx.dryRun,
                },
                {
                    note: (line) => note(ctx, line),
                    writeGreen: (v) => store.write(v),
                    fileFlake: () => fileFlake(ctx, plan, verdict?.log),
                    publish: (line) => publishCulprit(ctx, [line]),
                }
            )
        );
    // Reproduced: the RED is written before the bisect, which can take long.
    settle(1);
    let lines: string[];
    if (elsewhere !== undefined) {
        note(
            ctx,
            `the failing part passed, ${elsewhere} failed — the RED stands`
        );
        lines = [
            `${LADDER_MARK}not bisected — the fresh run passed the failing part, but \`${elsewhere}\` (never reached by the RED's run) failed`,
        ];
    } else {
        note(ctx, "reproduced — the RED stands");
        lines =
            plan.kind === "tests"
                ? bisect(ctx, tests, scope)
                : [
                      `${LADDER_MARK}not bisected — a failed \`${plan.step}\` names no test file`,
                  ];
    }
    for (const line of lines) note(ctx, line);
    publishCulprit(ctx, lines);
    return 1;
}

function main(): number {
    const cmd = process.argv[2];
    const root = primaryCheckout(process.cwd());
    const dryRun = process.argv.includes("--dry-run");
    let sha = arg("--sha");
    if (cmd !== "ladder" && cmd !== "bisect") {
        console.error(
            "usage: health:bisect ladder [--sha <sha>] | bisect --sha <sha> [--good <sha>] [--files a,b] [--projects p,q] [--dry-run]"
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
    // No sha: the RED standing on the store's lineage — whoever found it,
    // so a ladder dispatch that was lost is climbed by the next run — else
    // this machine's last run, when the store never took its RED.
    if (sha === undefined && cmd === "ladder") {
        const last = lastRunSha(root);
        if (last?.status === "infra") {
            console.log(
                `health-bisect: the last health run was INFRA @ ${last.sha.slice(0, 8)} — nothing to confirm`
            );
            return 1;
        }
        const lineage = readVerdictLineage(() => verdictStore(root));
        if (lineage.error) {
            console.error(
                `health-bisect: the verdict store could not be read — ${lineage.error}`
            );
            return 1;
        }
        // This job's held RED first (issue #6986): no other RED is on the
        // store for it, and an older one standing would leave it unwritten.
        const held = readDeferredRed(join(root, HEALTH_DIR_REL));
        if (last?.status === "red" && held?.sha === last.sha) sha = held.sha;
        else if (lineageBlocks(lineage.kind) && lineage.verdict)
            sha = lineage.verdict.sha;
        else if (last?.status === "red") sha = last.sha;
        else {
            console.log("health-bisect: no RED stands — nothing to do");
            return 0;
        }
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
    sweepStaleWorktrees(root);
    if (cmd === "ladder") return ladder(ctx);
    const files = arg("--files")?.split(",").filter(Boolean);
    const tests = files
        ? files.map((file) => ({ file }))
        : bisectTests(readEvidence(root, sha), []);
    if (tests.length === 0) {
        console.error(
            "health-bisect: no failing tests (--files, or the RED's evidence)"
        );
        return 2;
    }
    // `--projects a,b`: probe inside those shared-worker projects, whole
    // (issue #7584) — a failure that reproduces only beside its polluter.
    const projects = arg("--projects")?.split(",").filter(Boolean);
    const lines = bisect(
        ctx,
        tests,
        projects ? { kind: "projects", projects } : { kind: "files" },
        arg("--good")
    );
    for (const line of lines) note(ctx, line);
    publishCulprit(ctx, lines);
    return 0;
}

process.exit(main());
