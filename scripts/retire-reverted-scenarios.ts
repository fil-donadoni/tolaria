// `bun scripts/retire-reverted-scenarios.ts <PR#>` — after a REVERT lands,
// delete every preset scenario the reverted PR(s) seeded (issue #7702).
//
// `land`'s post-merge list runs it for EVERY landing, right after the seed:
// a PR that reverts nothing costs one `gh pr view` and prints nothing. Which
// PRs a landing reverts, and why that is the ladder's own list, is
// `lib/scenario-retire.ts`; which rows go (seeded ones, golden included; an
// admin-authored row is kept with a warning) is `selectRetirableScenarioIds`
// (`convex/debugScenarioSpec.ts`).
//
// NON-GATING BY CONTRACT, like `seed-scenario.ts`: it runs after the merge,
// and the `land` step is `|| true`. Run by hand it still exits non-zero on a
// failure. RE-ENTRY SAFE: a row already gone is a no-op, not a failure.
//
// Runs in the PRIMARY CHECKOUT (`lib/seed-scenario-run.ts` constraint 1).

import { spawnSync } from "node:child_process";
import { convexRunErrorMessage } from "./lib/convex-run-error";
import { primaryCheckout } from "./lib/primary-checkout";
import { classifyScenarioSection } from "./lib/scenario-block";
import {
    formatRetireOutcome,
    retireScenarioArgv,
    revertedPrsOf,
    type RetireCounts,
} from "./lib/scenario-retire";

const CALL_TIMEOUT_MS = 180_000;
const GH_TIMEOUT_MS = 60_000;

function prBody(pr: number): string {
    const res = spawnSync(
        "gh",
        ["pr", "view", String(pr), "--json", "body", "--jq", ".body"],
        // A hung `gh` must not stall `land`'s post-merge list: `|| true`
        // only covers a failing exit.
        { encoding: "utf8", timeout: GH_TIMEOUT_MS }
    );
    if (res.error) throw new Error(`gh pr view ${pr}: ${res.error.message}`);
    if (res.status !== 0) {
        throw new Error(
            `gh pr view ${pr} failed: ${(res.stderr ?? "").trim()}`
        );
    }
    return res.stdout ?? "";
}

function subjectIn(cwd: string): (sha: string) => string | null {
    return (sha) => {
        const res = spawnSync("git", ["log", "-1", "--format=%s", sha], {
            cwd,
            encoding: "utf8",
        });
        if (res.status === 0) return (res.stdout ?? "").trim();
        console.error(
            `retire-scenario: WARNING — reverted commit ${sha.slice(0, 12)} is not readable in ${cwd}; its PR's scenario is not retired`
        );
        return null;
    };
}

function retire(label: string, push: boolean, cwd: string): RetireCounts {
    const res = spawnSync("npx", retireScenarioArgv(label, push), {
        cwd,
        encoding: "utf8",
        timeout: CALL_TIMEOUT_MS,
    });
    if (res.error) throw new Error(res.error.message);
    if (res.status !== 0) {
        throw new Error(
            convexRunErrorMessage(
                `${res.stderr ?? ""}${res.stdout ?? ""}`.trim()
            )
        );
    }
    return JSON.parse((res.stdout ?? "").trim()) as RetireCounts;
}

function main(): number {
    const pr = Number((process.argv[2] ?? "").replace(/^#/, ""));
    if (!Number.isInteger(pr) || pr <= 0) {
        console.error("usage: bun scripts/retire-reverted-scenarios.ts <PR#>");
        return 1;
    }
    const cwd = primaryCheckout(process.cwd());
    let reverted: number[];
    try {
        reverted = revertedPrsOf(prBody(pr), subjectIn(cwd));
    } catch (err) {
        console.error(`retire-scenario: ${(err as Error).message}`);
        return 1;
    }
    if (reverted.length === 0) return 0;

    let failed = false;
    let pushed = false;
    for (const target of reverted) {
        let body: string;
        try {
            body = prBody(target);
        } catch (err) {
            console.error(`retire-scenario: ${(err as Error).message}`);
            failed = true;
            continue;
        }
        const verdict = classifyScenarioSection(body);
        if (verdict.kind !== "spec" || verdict.candidate === undefined) {
            // "None owed", no block, or a block that never loaded — so it was
            // never seeded either.
            console.log(
                `retire-scenario: reverted PR #${target} seeded no scenario`
            );
            continue;
        }
        const label = verdict.candidate.label;
        try {
            const counts = retire(label, !pushed, cwd);
            pushed = true;
            formatRetireOutcome(target, label, counts).forEach((l) =>
                console.log(l)
            );
        } catch (err) {
            console.error(
                `retire-scenario: PR #${target} "${label}" FAILED — ${(err as Error).message}`
            );
            failed = true;
        }
    }
    return failed ? 1 : 0;
}

if (import.meta.main) process.exit(main());
