#!/usr/bin/env bun
// `bun run pr:body-check --body-file <path>` — every line a PR body owes,
// decided BEFORE the PR exists (issue #10394).
//
// The owed lines used to be prose in `/next-ticket` §5, and one of them — the
// `proof: none owed (<reason>)` form — was named nowhere but in `land:ready`'s
// refusal: PR #10392 learned it after seven minutes of pre-queue work, then
// edited the body and paid again. This script asks the same questions
// `land:ready` asks of the body, from the same code, in seconds, and names
// EVERY missing line at once with the line to paste. `deny-guard.sh` § 9 runs
// it on `gh pr create` / `gh pr edit --body-file`, so a body that would be
// refused never becomes a PR.
//
// The diff is `origin/<base>...HEAD` of the working tree (run it in the
// branch's worktree), the proof head is HEAD.
//
//   proof     a code lane's `proof-receipt` block or `proof: none owed (<why>)`
//   docs      the `Docs: <files>` / `Docs: none (<why>)` line (CLAUDE.md step 10)
//   scenario  the `## Preset scenario` block (ADR 0044)
//   ui        the `check:ui` receipt or `check:ui: no walk owed (<why>)`; an
//             OWED walk passes with a note: it is batched (`ui-owed`, issue
//             #9122), never walked before the PR
//   retired-rows / draft-audit / robustness-baseline — the `pr-checks` ones
//
// Not here: `repair-proof` (it runs the RED verdict's tests; `land:ready` and
// the PR check own it).
//
// Exit 0 = the body owes nothing more, 2 = refused (one line per missing
// piece), anything else = could not decide (the hook fails open on it).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    changedPaths,
    classifyLane,
    contentClasses,
    type Lane,
} from "./check-lane";
import { ORIGIN_BASE } from "./lib/branches";
import { safeSkinReceiptInvalid } from "./lib/pr-refusals";
import { proofReceiptRefusal } from "./lib/proof-receipt";
import { pureRevertOf } from "./lib/revert-restores";
import { landingWalkOwed } from "./ui-gate/verify-receipt.ts";
import { runPrCheck, type PrCheckContext, type PrCheckName } from "./pr-checks";

/** The `Docs:` line CLAUDE.md step 10 asks of every PR. */
const DOCS_LINE_RE = /^Docs: \S/m;

/** The `pr-checks` refusals that read only the body and the diff. */
export const BODY_PR_CHECKS: readonly PrCheckName[] = [
    "scenario",
    "retired-rows",
    "draft-audit",
    "robustness-baseline",
];

export interface BodyCheckInput {
    lane: Lane;
    prBody: string;
    head: string;
    /** `pr-checks` refusals, by name (null = pass). */
    prChecks: Partial<Record<PrCheckName, string | null>>;
    /** The `check:ui` receipt refused (`safeSkinReceiptInvalid`). */
    uiInvalid: boolean;
    /** The diff owes a walk — only read when `uiInvalid`. */
    uiOwed: () => boolean;
}

export interface BodyCheckResult {
    refusals: string[];
    notes: string[];
}

/** The decision, pure over its inputs. */
export function bodyCheck(input: BodyCheckInput): BodyCheckResult {
    const refusals: string[] = [];
    const notes: string[] = [];
    const proof = proofReceiptRefusal({
        lane: input.lane,
        prBody: input.prBody,
        heads: [input.head],
    });
    if (proof !== null) refusals.push(`proof — ${proof}`);
    if (!DOCS_LINE_RE.test(input.prBody))
        refusals.push(
            "docs — every PR states `Docs: <files>` or `Docs: none (<why>)` on its own line (CLAUDE.md step 10)"
        );
    for (const name of BODY_PR_CHECKS) {
        const r = input.prChecks[name];
        if (r) refusals.push(`${name} — ${r}`);
    }
    if (input.uiInvalid) {
        if (input.uiOwed())
            notes.push(
                "ui — the diff owes a check:ui walk: label the PR `ui-owed` (the batch walks it, issue #9122); no receipt before the PR"
            );
        else
            refusals.push(
                "ui — the diff reaches src/** but owes no walk: add `check:ui: no walk owed (<reason>)` (`bun run check:ui -- --scope-only` names the reason)"
            );
    }
    return { refusals, notes };
}

function bodyFileOf(args: string[]): string | null {
    const i = args.indexOf("--body-file");
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

function headOf(cwd: string): string {
    const r = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf8",
    });
    if (r.status !== 0)
        throw new Error(`git rev-parse HEAD: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

/** The robustness baseline of the BRANCH's tree: the hook runs this script
 *  from the primary checkout, whose module copy is the base's. */
async function branchBaseline(
    cwd: string
): Promise<PrCheckContext["baseline"]> {
    const file = resolve(cwd, "convex/gre/ai/blade/robustnessBaseline.ts");
    if (!existsSync(file)) return undefined;
    return (
        (await import(file)) as {
            ROBUSTNESS_BASELINE: PrCheckContext["baseline"];
        }
    ).ROBUSTNESS_BASELINE;
}

async function main(): Promise<number> {
    const file = bodyFileOf(process.argv.slice(2));
    if (file === null) {
        console.error("usage: bun run pr:body-check --body-file <path>");
        return 1;
    }
    const cwd = process.cwd();
    const prBody = readFileSync(file, "utf8");
    const all = changedPaths(ORIGIN_BASE, cwd, true);
    const present = changedPaths(ORIGIN_BASE, cwd, false);
    // The lane exactly as `land:ready` plans it (`preQueueGate`).
    const plan = classifyLane(
        all,
        present,
        undefined,
        contentClasses(all, ORIGIN_BASE, cwd),
        undefined,
        undefined,
        undefined,
        pureRevertOf(ORIGIN_BASE, cwd)
    );
    const baseline = await branchBaseline(cwd);
    const prChecks: Partial<Record<PrCheckName, string | null>> = {};
    for (const name of BODY_PR_CHECKS)
        prChecks[name] = runPrCheck(name, {
            cwd,
            prBody,
            ...(baseline ? { baseline } : {}),
        }).refusal;
    const { refusals, notes } = bodyCheck({
        lane: plan.lane,
        prBody,
        head: headOf(cwd),
        prChecks,
        uiInvalid: safeSkinReceiptInvalid(cwd, prBody),
        uiOwed: () => {
            try {
                return landingWalkOwed(all, cwd).owed;
            } catch {
                return true;
            }
        },
    });
    for (const n of notes) console.log(`pr:body-check: NOTE — ${n}`);
    if (refusals.length === 0) {
        console.log(
            `pr:body-check: ok (${plan.lane} lane, base ${ORIGIN_BASE})`
        );
        return 0;
    }
    console.error(
        `pr:body-check: the body (${plan.lane} lane) is missing ${refusals.length} owed line(s):`
    );
    for (const r of refusals) console.error(`  ✗ ${r}`);
    return 2;
}

if (import.meta.main) {
    main().then(
        (code) => process.exit(code),
        (e: unknown) => {
            console.error(
                `pr:body-check: could not decide — ${(e as Error).message}`
            );
            process.exit(1);
        }
    );
}
