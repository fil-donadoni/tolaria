#!/usr/bin/env bun
// `bun run pr:fixup <classify|run>` — regenerate a stale generated artefact
// instead of spending a session on it (PRD issue #5620, issue #5640; ADR 0156
// Amendment I § Duties).
//
//   classify --lane <lane.json> [--pr <N> | --draft <branch>] [--ref <base>]
//       Reads the JSON `check:lane --json --retry-flaky` wrote. Prints the fix
//       keys (`oracle`, `blade-index`, `format`) when EVERY failed step is one
//       a regeneration cures, nothing and exit 1 otherwise. With `--pr N` it
//       also dispatches `pr-fixup.yml` for that PR (`gh workflow run`); with
//       `--draft <branch>` (the queue's lane, issue #5955) the PR is the one
//       the Mergify draft on that branch is checking.
//   flakes --lane <lane.json>
//       The flakes the lane recorded, as job-summary markdown (empty if none).
//   run --pr <N> --fixes <k,k> [--requeue] [--in-place --lease <sha>]
//       The fixup job: in the job worktree, check out the PR head, REBASE it
//       onto the base tip (the staleness the queue finds appears only there:
//       a whole-tree artefact regenerated on the old head reproduces the
//       committed file, issue #5955), regenerate the named artefacts, commit,
//       push to the PR's branch under a lease on the head it fetched.
//       `--requeue`: the queue had rejected the PR on this red — after the
//       push, `land-failed` → `ready-to-land`. `--in-place` (the land-runner):
//       the current checkout IS the PR's branch as `land` left it — rebased
//       — so no checkout; `--lease <sha>` is what origin held when the
//       runner reset the worktree, never a shared tracking ref.
//
// WHAT COUNTS AS REGENERABLE is the table below and nothing else: a lane step
// whose red is "the committed file is not what its generator writes today".
// Fail-fast means the lane's first red is its only red — a second stale
// artefact surfaces on the re-run the push triggers. Any other failing step
// (a type error, a real test) leaves the PR untouched: the fixup never
// guesses. The dispatch input only SELECTS rows of this table; it can never
// carry a command.
//
// ONE DECISION FOR EVERY RED (issue #5955): `classifyRed` wraps the table —
// `regenerable` (its keys), `infra` (the outage or the machine, not the PR:
// re-queue), `needs-pass` (everything else: a repair pick). The queue's lane
// and the land-runner both call it; neither re-derives a key.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BLADE_INDEX_DRIFT_TEST } from "./lib/blade-card-index";
import { REGENERATED_ARTIFACTS } from "./lib/generated-artifacts";
import { FAILED_LABEL, READY_LABEL } from "./lib/land-labels";

export type FixKey = "oracle" | "blade-index" | "format";

export interface FixRow {
    /** The lane step ids whose failure this row cures. */
    stepIds: readonly string[];
    /** The ONLY test files whose failure it cures — the step's `failedFiles`
     *  (a vitest step's, or any step's once the lane records its output,
     *  issue #5955) must be exactly these. */
    onlyFiles?: readonly string[];
    /** `bun run <script> <args…>` — re-derives the artefact. */
    script: string;
    args: readonly string[];
}

const ORACLE = REGENERATED_ARTIFACTS.find(
    (a) => a.path === "data/oracle-compiled.json"
);
if (!ORACLE)
    throw new Error("pr-fixup: no oracle row in REGENERATED_ARTIFACTS");

/** The regenerable reds. The oracle row reuses `REGENERATED_ARTIFACTS` — the
 *  resolver `land` runs — so the carried-forward Bot verdicts are the same. */
export const FIXES: Readonly<Record<FixKey, FixRow>> = {
    oracle: {
        stepIds: ["check:oracle"],
        script: ORACLE.script,
        args: ORACLE.args ?? [],
    },
    "blade-index": {
        // The drift test is a `bot-node` file no related run selects: the
        // lane runs it as its own admitted guard (issue #5940) and names it
        // in `failedFiles` — a red with no file named (a crash) is not drift.
        // A `full` lane runs it inside `check:pr` (`check:guards`): the same
        // files rule, read from the captured output (issue #5955, PR #5863
        // sat `land-failed` 7 h on exactly this red).
        stepIds: ["blade-index", "check:pr"],
        onlyFiles: [BLADE_INDEX_DRIFT_TEST],
        script: "blade:card-index",
        args: [],
    },
    format: {
        stepIds: ["format(diff)"],
        script: "format",
        args: [],
    },
};

/** The fixup commit's subject — the loop guard reads it back. */
export const FIXUP_COMMIT_SUBJECT = "Regenerate stale generated artefacts";

interface LaneOutcome {
    id: string;
    status: string;
    failedFiles?: string[];
}

/** The fix keys that cure EVERY failed step of a lane's JSON, or null when
 *  any failed step has no row (or the lane did not fail). */
export function classifyLane(lane: {
    ok?: boolean;
    outcomes?: LaneOutcome[];
}): FixKey[] | null {
    if (lane.ok !== false || !Array.isArray(lane.outcomes)) return null;
    const failed = lane.outcomes.filter((o) => o.status === "fail");
    if (failed.length === 0) return null;
    const keys = new Set<FixKey>();
    for (const o of failed) {
        const hit = (Object.entries(FIXES) as [FixKey, FixRow][]).find(
            ([, row]) => rowCures(row, o)
        );
        if (!hit) return null;
        keys.add(hit[0]);
    }
    return [...keys].sort();
}

function rowCures(row: FixRow, o: LaneOutcome): boolean {
    if (!row.stepIds.includes(o.id)) return false;
    if (!row.onlyFiles) return true;
    // A vitest red with no named file, or any file the row does not own, is a
    // real failure.
    const files = o.failedFiles ?? [];
    return files.length > 0 && files.every((f) => row.onlyFiles?.includes(f));
}

// eslint-disable-next-line no-control-regex -- stripping the ANSI colour codes
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** How a red landing or queue check is handled (issue #5955). */
export type RedClass =
    | { kind: "regenerable"; fixes: FixKey[] }
    | { kind: "infra"; reason: string }
    | { kind: "needs-pass"; reason: string };

/** The lane JSON as `check:lane --json` / `TOLARIA_LANE_JSON_OUT` wrote it,
 *  or `null` when the lane wrote none (it never ran, was skipped as already
 *  gated, or died before its receipt). */
export type LaneJson = Parameters<typeof classifyLane>[0];

/**
 * What a line of `land`'s OWN output looks like when the red is the network
 * or GitHub, not the PR: git's transport errors, `gh`'s gateway errors and
 * the retry wrapper's exhausted-outage line. Deliberately narrow — a pattern
 * that also matches a test's wording would turn a real red into an endless
 * re-queue — and never applied to the lane's own output (`outsideLane`).
 */
export const INFRA_LINE =
    /Could not resolve host|unable to access '|Could not read from remote repository|The remote end hung up unexpectedly|RPC failed|Connection (timed out|refused|reset)|Network is unreachable|TLS handshake|SSL_ERROR|E(AI_AGAIN|NOTFOUND|TIMEDOUT|CONNRESET|HOSTUNREACH)\b|HTTP 5\d\d\b|\b50[234] (Bad Gateway|Service Unavailable|Gateway Time-?out)|GraphQL: .*(timed? ?out|unavailable|Something went wrong)|rate limit/i;

/** A rebase that stopped — `land`'s own red, however its lines read: git
 *  echoes the commit SUBJECT (`Could not apply <sha>... retry on HTTP 503`),
 *  which a PR controls and `INFRA_LINE` would match. Checked first. */
export const CONFLICT_LINE = /^(CONFLICT \(|Could not apply [0-9a-f]{7,})/;

/** `land`'s output with the lane's own output cut out: everything between
 *  its `lane: ran` marker and the lane receipt's last line (`PASS|FAIL …
 *  total`) or the script's exit line. A test's stderr quoting an HTTP 504
 *  (`gh-retry.test.ts`, `health-pivot.test.ts`) lives in there, and in PR
 *  #5932's landing log read as an outage; what is left is `land`, git and
 *  `gh` speaking for themselves. */
export function outsideLane(output: string): string[] {
    const lines = output.split("\n");
    const start = lines.findIndex((l) => /^lane: ran\b/.test(l.trim()));
    if (start === -1) return lines;
    const endRel = lines
        .slice(start + 1)
        .findIndex((l) =>
            /^((PASS|FAIL)\s+[\d.]+s total|error: script "check:lane" exited)/.test(
                l.replace(ANSI, "").trim()
            )
        );
    const end = endRel === -1 ? lines.length - 1 : start + 1 + endRel;
    return [...lines.slice(0, start), ...lines.slice(end + 1)];
}

/** Whether the head already ends in two fixup commits — the loop guard
 *  `fixupRefusal` applies, read ahead of time by `classifyRed`. */
export function fixupLimitReached(subjects: readonly string[]): boolean {
    return (
        subjects.slice(-2).filter((s) => s === FIXUP_COMMIT_SUBJECT).length ===
        2
    );
}

/**
 * THE decision on a red (issue #5955). In order:
 *
 * 1. The lane went red (`lane.ok === false`) and every failed step has a
 *    fixup row → `regenerable`, unless the head already carries two fixup
 *    commits (the bound: the regeneration did not cure it) → `needs-pass`.
 * 2. The lane went red otherwise → `needs-pass`, naming the steps: a real
 *    test, a type error, a conflict — the lane's output is never read for
 *    an outage, a test's own wording lives there.
 * 3. The lane did not go red (green, skipped, never reached): a rebase that
 *    stopped (`CONFLICT_LINE`) → `needs-pass`; else a line of `land`'s own
 *    output naming the network or GitHub (`INFRA_LINE`) → `infra`.
 * 4. Else `needs-pass`.
 *
 * `infra` is bounded by the caller: the land-runner turns the N-th
 * consecutive `infra` on one PR into `needs-pass` (`INFRA_MAX_STRIKES`).
 */
export function classifyRed(input: {
    lane: LaneJson | null;
    /** Subjects of the PR's commits, newest last. */
    subjects: readonly string[];
    /** `land`'s whole output (the landing log); `""` for a queue check. */
    output: string;
}): RedClass {
    const lane = input.lane;
    if (lane !== null && lane.ok === false) {
        const fixes = classifyLane(lane);
        if (fixes !== null) {
            if (fixupLimitReached(input.subjects))
                return {
                    kind: "needs-pass",
                    reason: `regenerable (${fixes.join(", ")}) but the head already ends in two fixup commits — the regeneration does not cure it`,
                };
            return { kind: "regenerable", fixes };
        }
        const failed = (lane.outcomes ?? [])
            .filter((o) => o.status === "fail")
            .map((o) =>
                o.failedFiles?.length
                    ? `${o.id} (${o.failedFiles.join(", ")})`
                    : o.id
            );
        return {
            kind: "needs-pass",
            reason: `lane step${failed.length === 1 ? "" : "s"} ${failed.join(", ") || "unknown"} failed with no fixup row`,
        };
    }
    const own = outsideLane(input.output).map((l) =>
        l.replace(ANSI, "").trim()
    );
    const conflict = own.find((l) => CONFLICT_LINE.test(l));
    if (conflict !== undefined)
        return {
            kind: "needs-pass",
            reason: `the rebase stopped: ${conflict.slice(0, 160)}`,
        };
    const outage = own.find((l) => INFRA_LINE.test(l));
    if (outage !== undefined)
        return { kind: "infra", reason: outage.slice(0, 200) };
    return {
        kind: "needs-pass",
        reason:
            lane === null
                ? "red outside the lane, naming no outage"
                : "the lane passed; the red came after it (push, merge) and names no outage",
    };
}

/** The PR a Mergify draft is checking, from the draft's title — `merge queue:
 *  checking #5854 on staging (5173278)` → `{ pr: 5854, base: "staging" }`;
 *  `null` on any other title (a batch of several, `batch_size: 1` never
 *  makes one). */
export function queuedPrOfDraft(
    title: string
): { pr: number; base: string } | null {
    const m = /^merge queue: checking #(\d+) on (\S+)/.exec(title.trim());
    return m ? { pr: Number(m[1]), base: m[2] } : null;
}

/** The line `pr:fixup run` ends on when it pushed — the land-runner reads it
 *  back (`FIXUP_PUSHED_RE`) to tell a fixed-up PR from an untouched one. */
export function fixupPushedLine(
    pr: number | string,
    fixes: readonly string[]
): string {
    return `pr:fixup: PR #${pr} fixed (${fixes.join(", ")}) and pushed`;
}
export const FIXUP_PUSHED_RE = /^pr:fixup: PR #\d+ fixed \(.*\) and pushed$/m;

/** `oracle,format` → the keys; null on anything not in the table. */
export function parseFixes(raw: string): FixKey[] | null {
    const keys = raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    if (keys.length === 0) return null;
    if (!keys.every((k) => k in FIXES)) return null;
    return [...new Set(keys)].sort() as FixKey[];
}

export interface PrFacts {
    state: string;
    author: string;
    headRefName: string;
    isCrossRepository: boolean;
    files: string[];
    /** Subjects of the PR's commits, newest last. */
    subjects: string[];
}

/** Why the fixup must NOT touch this PR, or null when it may. */
export function fixupRefusal(
    pr: PrFacts,
    trusted: readonly string[]
): string | null {
    if (pr.state !== "OPEN") return `the PR is ${pr.state}, not OPEN`;
    if (pr.isCrossRepository) return "a fork's PR — never pushed to";
    if (trusted.length === 0 || !trusted.includes(pr.author)) {
        return `author ${pr.author} is not in TRUSTED_AUTHORS`;
    }
    // ADR 0156 §8.4: no automation edits what gates it.
    if (
        pr.files.some((f) => f.startsWith(".github/") || f === ".mergify.yml")
    ) {
        return "the PR touches .github/ or .mergify.yml";
    }
    // Loop guard: a fixup that did not cure the red must not run again on
    // its own push.
    if (fixupLimitReached(pr.subjects)) {
        return "two fixup commits in a row — the regeneration does not cure it";
    }
    return null;
}

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
    const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function die(msg: string): never {
    console.error(`pr:fixup: ${msg}`);
    process.exit(1);
}

function argOf(argv: string[], flag: string): string | undefined {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
}

/** The job-summary lines for the flakes a lane's JSON recorded (`--retry-flaky`):
 *  empty when it recorded none. Test file names and counts only. */
export function flakeSummary(lane: {
    outcomes?: {
        id: string;
        flake?: { projects: string[]; files: string[]; cause: string };
    }[];
}): string {
    const rows = (lane.outcomes ?? []).filter((o) => o.flake);
    if (rows.length === 0) return "";
    return [
        "### Flaky tests — failed once, green on the re-run",
        ...rows.map(
            (o) =>
                `- \`${o.id}\` (${o.flake?.cause}): ${o.flake?.files.join(", ")}`
        ),
        "",
    ].join("\n");
}

function flakesMain(argv: string[]): void {
    const laneFile = argOf(argv, "--lane");
    if (!laneFile) die("flakes needs --lane <lane.json>");
    try {
        process.stdout.write(
            flakeSummary(JSON.parse(readFileSync(laneFile, "utf8")))
        );
    } catch {
        // No JSON (the lane died before writing it): nothing to summarise.
    }
}

function classifyMain(argv: string[]): void {
    const laneFile = argOf(argv, "--lane");
    if (!laneFile) die("classify needs --lane <lane.json>");
    let lane: unknown;
    try {
        lane = JSON.parse(readFileSync(laneFile, "utf8"));
    } catch (e) {
        die(`cannot read ${laneFile}: ${(e as Error).message}`);
    }
    let pr = argOf(argv, "--pr");
    let ref = argOf(argv, "--ref");
    const draft = argOf(argv, "--draft");
    if (draft !== undefined) {
        // The queue's lane (issue #5955): the checked branch is a Mergify
        // draft; its PR's title names the PR it is checking and the base.
        const titles = ghJson([
            "pr",
            "list",
            "--head",
            draft,
            "--state",
            "all",
            "--limit",
            "1",
            "--json",
            "title",
        ]) as { title: string }[];
        const queued = titles[0] ? queuedPrOfDraft(titles[0].title) : null;
        if (queued === null) {
            console.log(
                `pr:fixup: no single queued PR behind draft ${draft} — nothing dispatched`
            );
            return;
        }
        pr = String(queued.pr);
        ref ??= queued.base;
    }
    if (pr !== undefined && !/^\d+$/.test(pr))
        die(`--pr ${pr} is not a number`);
    // THE decision (issue #5955), the PR's commits bounding it; a check with
    // no PR (a local read) classifies on the lane alone.
    const subjects =
        pr === undefined
            ? []
            : (
                  ghJson(["pr", "view", pr, "--json", "commits"]) as {
                      commits: { messageHeadline: string }[];
                  }
              ).commits.map((c) => c.messageHeadline);
    const cls = classifyRed({ lane: lane as LaneJson, subjects, output: "" });
    if (cls.kind !== "regenerable") {
        console.log(`pr:fixup: ${cls.kind} — ${cls.reason}`);
        process.exit(1);
    }
    const keys = cls.fixes;
    console.log(keys.join(","));
    if (pr === undefined) return;
    const r = run("gh", [
        "workflow",
        "run",
        "pr-fixup.yml",
        ...(ref ? ["--ref", ref] : []),
        "-f",
        `pr=${pr}`,
        "-f",
        `fixes=${keys.join(",")}`,
        // The queue dequeued this PR as `land-failed`: hand it back after
        // the push. A `pr-check` dispatch never re-queues.
        ...(draft !== undefined ? ["-f", "requeue=true"] : []),
    ]);
    if (!r.ok) die(`dispatch failed: ${r.out.trim()}`);
    console.log(`pr:fixup: dispatched pr-fixup for PR #${pr}`);
}

function ghJson(args: string[]): unknown {
    const r = run("gh", args);
    if (!r.ok) die(`gh ${args.slice(0, 2).join(" ")} failed: ${r.out.trim()}`);
    return JSON.parse(r.out);
}

function runMain(argv: string[]): void {
    const pr = argOf(argv, "--pr");
    if (!pr || !/^\d+$/.test(pr)) die("run needs --pr <N>");
    const fixes = parseFixes(argOf(argv, "--fixes") ?? "");
    if (!fixes) die("run needs --fixes naming rows of the FIXES table");

    const inPlace = argv.includes("--in-place");
    const requeue = argv.includes("--requeue");
    const leaseArg = argOf(argv, "--lease");
    if (inPlace && !/^[0-9a-f]{40}$/.test(leaseArg ?? ""))
        die(
            "--in-place needs --lease <full sha> — what origin held when the worktree was reset"
        );
    const view = ghJson([
        "pr",
        "view",
        pr,
        "--json",
        "state,author,headRefName,baseRefName,isCrossRepository,commits",
    ]) as {
        state: string;
        author: { login: string };
        headRefName: string;
        baseRefName: string;
        isCrossRepository: boolean;
        commits: { messageHeadline: string }[];
    };
    const facts: PrFacts = {
        state: view.state,
        author: view.author.login,
        headRefName: view.headRefName,
        isCrossRepository: view.isCrossRepository,
        // `pr view --json files` stops at 100 paths; the diff does not.
        files: run("gh", ["pr", "diff", pr, "--name-only"])
            .out.split("\n")
            .filter(Boolean),
        subjects: view.commits.map((c) => c.messageHeadline),
    };
    const trusted = (process.env.TRUSTED_AUTHORS ?? "")
        .split(/[,\s]+/)
        .filter(Boolean);
    const refusal = fixupRefusal(facts, trusted);
    if (refusal) {
        console.log(`pr:fixup: PR #${pr} untouched — ${refusal}`);
        return;
    }

    // The tree to regenerate on is the PR REBASED onto the base tip — in
    // place, `land` already did that; in the job, done here — and the push
    // is leased on the exact head sha this run started from (in place: the
    // one the runner reset the worktree to; in the job: the head it fetched),
    // never on a tracking ref another worktree's fetch can move: a session's
    // push that crossed this run is refused, never clobbered.
    let lease = leaseArg ?? "";
    if (inPlace) {
        const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
        if (branch.out.trim() !== facts.headRefName)
            die(
                `--in-place: HEAD is ${branch.out.trim() || "detached"}, not ${facts.headRefName}`
            );
    } else {
        for (const step of [
            ["git", "fetch", "--no-tags", "origin", `pull/${pr}/head`],
            ["git", "checkout", "--detach", "FETCH_HEAD"],
        ]) {
            const r = run(step[0], step.slice(1));
            if (!r.ok) die(`${step.join(" ")} failed: ${r.out.slice(-400)}`);
        }
        lease = run("git", ["rev-parse", "HEAD"]).out.trim();
        const rebase = [
            ["git", "fetch", "--no-tags", "origin", view.baseRefName],
            ["git", "rebase", "FETCH_HEAD"],
            ["bun", "run", "worktree:init"],
        ];
        for (const step of rebase) {
            const r = run(step[0], step.slice(1));
            if (!r.ok) {
                if (step[1] === "rebase") run("git", ["rebase", "--abort"]);
                die(`${step.join(" ")} failed: ${r.out.slice(-400)}`);
            }
        }
    }
    const push = [
        "git",
        "push",
        `--force-with-lease=refs/heads/${facts.headRefName}:${lease}`,
        "origin",
        `HEAD:refs/heads/${facts.headRefName}`,
    ];

    for (const key of fixes) {
        const row = FIXES[key];
        const r = run("bun", ["run", row.script, ...row.args]);
        if (!r.ok)
            die(`${key}: bun run ${row.script} failed: ${r.out.slice(-400)}`);
        console.log(`pr:fixup: ${key} regenerated`);
    }

    const status = run("git", ["status", "--porcelain"]);
    if (status.out.trim() === "") {
        console.log(
            `pr:fixup: PR #${pr} — nothing to regenerate, nothing pushed`
        );
        return;
    }
    const steps = [
        ["git", "add", "-A"],
        [
            "git",
            "commit",
            "-m",
            `${FIXUP_COMMIT_SUBJECT}\n\nRegenerated by pr-fixup: ${fixes.join(", ")} (issue #5640).`,
        ],
        push,
    ];
    for (const step of steps) {
        const r = run(step[0], step.slice(1));
        if (!r.ok)
            die(`${step.slice(0, 2).join(" ")} failed: ${r.out.slice(-400)}`);
    }
    // Only when the QUEUE rejected this PR on this red (`--requeue`, set by
    // the queue-lane dispatch) does it re-enter with no pass: `land-failed`
    // → `ready-to-land`, the labels re-read after the push — Mergify's
    // dequeue lands seconds after its check went red, the fixup minutes
    // later. A `pr-check` dispatch never moves a label: a `land-failed` there
    // may be a real red a pass is repairing. Logged, never fatal — the push
    // is the fix; a label write that fails is retried by hand.
    if (requeue) {
        const labels = (
            ghJson(["pr", "view", pr, "--json", "labels"]) as {
                labels: { name: string }[];
            }
        ).labels.map((l) => l.name);
        if (labels.includes(FAILED_LABEL)) {
            const r = run("gh", [
                "pr",
                "edit",
                pr,
                "--add-label",
                READY_LABEL,
                "--remove-label",
                FAILED_LABEL,
            ]);
            console.log(
                r.ok
                    ? `pr:fixup: PR #${pr} re-queued — ${FAILED_LABEL} → ${READY_LABEL}`
                    : `pr:fixup: PR #${pr} label swap failed: ${r.out.trim().slice(-200)}`
            );
        } else
            console.log(
                `pr:fixup: PR #${pr} carries no ${FAILED_LABEL} — nothing to re-queue`
            );
    }
    console.log(fixupPushedLine(pr, fixes));
}

if (import.meta.main) {
    const [sub, ...rest] = process.argv.slice(2);
    if (sub === "classify") classifyMain(rest);
    else if (sub === "run") runMain(rest);
    else if (sub === "flakes") flakesMain(rest);
    else die("usage: bun run pr:fixup <classify|run|flakes> …");
}
