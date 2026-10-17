#!/usr/bin/env bun
// `bun run pr:checks <name|all>` — the refusals `land` applies before a merge,
// as PR checks (PRD issue #5620, issue #5639; ADR 0156 Amendment I).
//
// Each check is the SAME pure function `land` calls, fed the same facts, and
// answers with the same refusal string — one reading, two callers
// (`.github/workflows/pr-check.yml` runs one job per check, `land` keeps its
// copy until the migration retires it, `docs/guides/github-pipeline.md`).
//
//   ui-receipt          the `check:ui` receipt, re-derived from the diff's scope
//   scenario            the `## Preset scenario` block (ADR 0044)
//   retired-rows        the `## Retired rows` line (ADR 0114 §1)
//   robustness-baseline a PR that closes a baseline row's owner leaves the row
//   repair-proof        a declared repair of the standing RED re-runs the
//                       verdict's failing tests green (issue #5462)
//
// Inputs: the PR body in `PR_BODY` (a workflow passes it through `env:`, never
// interpolated into a shell line), or `--pr <N>` read with `gh`. The diff is
// `origin/<base>...HEAD` of the working tree — on a runner, the merge ref.
// Exit 0 = every named check passed, 1 = at least one refused (one line each).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROBUSTNESS_BASELINE } from "../convex/gre/ai/blade/robustnessBaseline";
import { ORIGIN_BASE } from "./lib/branches";
import { gh } from "./lib/gh";
import {
    closingIssueRefs,
    redLandGate,
    type LandingKind,
} from "./lib/red-land-gate";
import {
    lineageBlocks,
    verdictStore,
    type Lineage,
    type VerdictStore,
} from "./lib/health-verdict-store";
import { robustnessBaselineRefusal } from "./lib/robustness-baseline-refusal";
import {
    SKIN_RECEIPT_REFUSAL,
    landHealthLineage,
    readRepairIssues,
    repairProofOf,
    safeRetirementRefusal,
    safeScenarioRefusal,
    safeSkinReceiptInvalid,
    type RepairProof,
} from "./land";

export const PR_CHECK_NAMES = [
    "ui-receipt",
    "scenario",
    "retired-rows",
    "robustness-baseline",
    "repair-proof",
] as const;
export type PrCheckName = (typeof PR_CHECK_NAMES)[number];

/** What a check needs besides the tree: the PR body and, for the repair
 *  proof, the two impure reads and the test runner (injected in tests). */
export interface PrCheckContext {
    cwd: string;
    prBody: string;
    baseline?: typeof ROBUSTNESS_BASELINE;
    lineage?: () => Lineage & { error?: string };
    repairIssues?: () => number[];
    runTests?: (tests: readonly string[], cwd: string) => number;
}

/** A check's answer: null = pass, a string = the refusal, `note` = passed but
 *  could not decide (printed, never silent). */
export interface PrCheckResult {
    refusal: string | null;
    note?: string;
}

/** Runs the failing tests of a repaired RED; the exit code is vitest's. The
 *  ones the repair deleted or moved are skipped, as `repairProofStep` does. */
function vitestRun(tests: readonly string[], cwd: string): number {
    return (
        spawnSync("bunx", ["vitest", "run", ...tests], {
            cwd,
            stdio: "inherit",
        }).status ?? 1
    );
}

/** The repair proof (issue #5639, `land`'s `repairProofStep`): a PR that
 *  closes a `/health-fix` issue of the standing RED must make the verdict's
 *  failing test files pass. Not a repair, or no RED standing → passes. An
 *  unreadable verdict store passes WITH a note — the check cannot decide. */
export function repairProofCheck(ctx: PrCheckContext): PrCheckResult {
    const lineage = (ctx.lineage ?? defaultLineage(ctx.cwd))();
    if (lineage.error)
        return {
            refusal: null,
            note: `repair proof: the health verdict store could not be read (${lineage.error}) — not provable here`,
        };
    const red = lineageBlocks(lineage.kind);
    const gate = redLandGate({
        red,
        prBody: ctx.prBody,
        repairIssues: red
            ? (ctx.repairIssues ?? (() => readRepairIssues(ctx.cwd)))()
            : [],
        repairFlag: false,
        redOkFlag: false,
    });
    const kind: LandingKind | undefined =
        gate.kind === "proceed" ? gate.landing : undefined;
    const proof: RepairProof | undefined = repairProofOf(lineage, kind);
    if (!proof) return { refusal: null };
    const tests = proof.tests.filter((t) => existsSync(resolve(ctx.cwd, t)));
    if (tests.length === 0)
        return {
            refusal: null,
            note: `repair proof: no failing test the RED verdict names exists here — unproved, the RED stands until health`,
        };
    const status = (ctx.runTests ?? vitestRun)(tests, ctx.cwd);
    return status === 0
        ? { refusal: null }
        : {
              refusal: `repair of RED @ ${proof.redSha.slice(0, 8)}: its failing tests still fail on this PR (${tests.join(", ")}) — a repair that leaves them red repairs nothing`,
          };
}

function defaultLineage(cwd: string): () => Lineage & { error?: string } {
    return () => landHealthLineage((): VerdictStore => verdictStore(cwd));
}

/** One check by name. Pure but for the git/gh/vitest reads each reaches. */
export function runPrCheck(
    name: PrCheckName,
    ctx: PrCheckContext
): PrCheckResult {
    switch (name) {
        case "ui-receipt":
            return {
                refusal: safeSkinReceiptInvalid(ctx.cwd, ctx.prBody)
                    ? SKIN_RECEIPT_REFUSAL
                    : null,
            };
        case "scenario":
            return { refusal: safeScenarioRefusal(ctx.cwd, ctx.prBody) };
        case "retired-rows":
            return { refusal: safeRetirementRefusal(ctx.cwd, ctx.prBody) };
        case "robustness-baseline":
            return {
                refusal: robustnessBaselineRefusal(
                    ctx.baseline ?? ROBUSTNESS_BASELINE,
                    closingIssueRefs(ctx.prBody)
                ),
            };
        case "repair-proof":
            return repairProofCheck(ctx);
    }
}

function parseNames(args: string[]): PrCheckName[] | string {
    const named = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
    if (named.length === 0 || named.includes("all")) return [...PR_CHECK_NAMES];
    const bad = named.filter(
        (n) => !(PR_CHECK_NAMES as readonly string[]).includes(n)
    );
    return bad.length > 0
        ? `unknown check ${bad.join(", ")} — one of ${PR_CHECK_NAMES.join(", ")}, all`
        : (named as PrCheckName[]);
}

function prBodyOf(args: string[]): string {
    const i = args.indexOf("--pr");
    if (i >= 0 && args[i + 1])
        return (
            JSON.parse(gh(["pr", "view", args[i + 1], "--json", "body"])) as {
                body: string;
            }
        ).body;
    return process.env.PR_BODY ?? "";
}

function main(): number {
    const args = process.argv.slice(2);
    const names = parseNames(args);
    if (typeof names === "string") {
        console.error(`pr:checks: ${names}`);
        return 2;
    }
    const ctx: PrCheckContext = {
        cwd: process.cwd(),
        prBody: prBodyOf(args),
    };
    let failed = 0;
    for (const name of names) {
        const r = runPrCheck(name, ctx);
        if (r.note) console.warn(`pr:checks ${name}: NOTE — ${r.note}`);
        if (r.refusal) {
            failed++;
            console.error(`pr:checks ${name}: REFUSED — ${r.refusal}`);
        } else console.log(`pr:checks ${name}: ok (base ${ORIGIN_BASE})`);
    }
    return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
