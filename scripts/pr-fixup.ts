#!/usr/bin/env bun
// `bun run pr:fixup <classify|run>` — regenerate a stale generated artefact
// instead of spending a session on it (PRD issue #5620, issue #5640; ADR 0156
// Amendment I § Duties).
//
//   classify --lane <lane.json> [--pr <N>]
//       Reads the JSON `check:lane --json --retry-flaky` wrote. Prints the fix
//       keys (`oracle`, `blade-index`, `format`) when EVERY failed step is one
//       a regeneration cures, nothing and exit 1 otherwise. With `--pr N` it
//       also dispatches `pr-fixup.yml` for that PR (`gh workflow run`).
//   flakes --lane <lane.json>
//       The flakes the lane recorded, as job-summary markdown (empty if none).
//   run --pr <N> --fixes <k,k>
//       The fixup job: in the job worktree, check out the PR head, regenerate
//       the named artefacts, commit, push to the PR's branch.
//
// WHAT COUNTS AS REGENERABLE is the table below and nothing else: a lane step
// whose red is "the committed file is not what its generator writes today".
// Fail-fast means the lane's first red is its only red — a second stale
// artefact surfaces on the re-run the push triggers. Any other failing step
// (a type error, a real test) leaves the PR untouched: the fixup never
// guesses. The dispatch input only SELECTS rows of this table; it can never
// carry a command.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BLADE_INDEX_DRIFT_TEST } from "./lib/blade-card-index";
import { REGENERATED_ARTIFACTS } from "./lib/generated-artifacts";

export type FixKey = "oracle" | "blade-index" | "format";

export interface FixRow {
    /** The lane step id whose failure this row cures. */
    stepId: string;
    /** For a vitest step: the ONLY test files whose failure it cures. */
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
        stepId: "check:oracle",
        script: ORACLE.script,
        args: ORACLE.args ?? [],
    },
    "blade-index": {
        // The drift test is a `bot-node` file no related run selects: the
        // lane runs it as its own admitted guard (issue #5940) and names it
        // in `failedFiles` — a red with no file named (a crash) is not drift.
        stepId: "blade-index",
        onlyFiles: [BLADE_INDEX_DRIFT_TEST],
        script: "blade:card-index",
        args: [],
    },
    format: {
        stepId: "format(diff)",
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
    if (o.id !== row.stepId) return false;
    if (!row.onlyFiles) return true;
    // A vitest red with no named file, or any file the row does not own, is a
    // real failure.
    const files = o.failedFiles ?? [];
    return files.length > 0 && files.every((f) => row.onlyFiles?.includes(f));
}

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
    if (
        pr.subjects.slice(-2).filter((s) => s === FIXUP_COMMIT_SUBJECT)
            .length === 2
    ) {
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
    const keys = classifyLane(lane as Parameters<typeof classifyLane>[0]);
    if (keys === null) {
        console.log("pr:fixup: not regenerable — a failing step has no row");
        process.exit(1);
    }
    console.log(keys.join(","));
    const pr = argOf(argv, "--pr");
    if (pr === undefined) return;
    if (!/^\d+$/.test(pr)) die(`--pr ${pr} is not a number`);
    const ref = argOf(argv, "--ref");
    const r = run("gh", [
        "workflow",
        "run",
        "pr-fixup.yml",
        ...(ref ? ["--ref", ref] : []),
        "-f",
        `pr=${pr}`,
        "-f",
        `fixes=${keys.join(",")}`,
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

    const view = ghJson([
        "pr",
        "view",
        pr,
        "--json",
        "state,author,headRefName,isCrossRepository,commits",
    ]) as {
        state: string;
        author: { login: string };
        headRefName: string;
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

    for (const step of [
        ["git", "fetch", "--no-tags", "origin", `pull/${pr}/head`],
        ["git", "checkout", "--detach", "FETCH_HEAD"],
        ["bun", "run", "worktree:init"],
    ]) {
        const r = run(step[0], step.slice(1));
        if (!r.ok) die(`${step.join(" ")} failed: ${r.out.slice(-400)}`);
    }

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
        ["git", "push", "origin", `HEAD:refs/heads/${facts.headRefName}`],
    ];
    for (const step of steps) {
        const r = run(step[0], step.slice(1));
        if (!r.ok)
            die(`${step.slice(0, 2).join(" ")} failed: ${r.out.slice(-400)}`);
    }
    console.log(`pr:fixup: PR #${pr} fixed (${fixes.join(", ")}) and pushed`);
}

if (import.meta.main) {
    const [sub, ...rest] = process.argv.slice(2);
    if (sub === "classify") classifyMain(rest);
    else if (sub === "run") runMain(rest);
    else if (sub === "flakes") flakesMain(rest);
    else die("usage: bun run pr:fixup <classify|run|flakes> …");
}
