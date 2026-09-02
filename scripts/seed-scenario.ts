// `bun run seed:scenario <PR#> [--dry-run]` — register ONE merged PR's preset
// scenario into the local Convex deployment (ADR 0044).
//
// This is the step ADR 0110 dropped on the floor. CLAUDE.md § Development
// cycle step 7 routes the insert to "the orchestrator, post-merge"; ADR 0110
// retired the orchestrator and `/next-issue` never inherited the job, so
// between then and now every emitted spec was written, reviewed, merged and
// then lost. `land` calls this automatically after a successful merge; run it
// by hand to replay one PR, or `seed:backlog` to sweep the history.
//
// NON-GATING BY CONTRACT. Called from `land`, this runs AFTER the API merge
// has landed. A developer with no local deployment, a stopped `convex dev`, a
// spec naming a card that has since been renamed — none of those may turn a
// merged PR into a reported failure. Every one of them prints and exits 0 from
// `land`'s point of view (the shell step is `|| true`), while a direct
// invocation still exits non-zero so a human running it by hand is told.

import { spawnSync } from "node:child_process";
import { classifyScenarioSection } from "./lib/scenario-block";
import { seedScenario } from "./lib/seed-scenario-run";
import { primaryCheckout } from "./lib/primary-checkout";

function gh(args: string[]): string {
    const res = spawnSync("gh", args, { encoding: "utf8" });
    if (res.status !== 0) {
        throw new Error(
            `gh ${args.join(" ")} failed: ${(res.stderr ?? "").trim()}`
        );
    }
    return (res.stdout ?? "").trim();
}

export function parseArgs(argv: string[]): { pr: number; dryRun: boolean } {
    const positional = argv.filter((a) => !a.startsWith("--"));
    const pr = Number((positional[0] ?? "").replace(/^#/, ""));
    if (!Number.isInteger(pr) || pr <= 0) {
        throw new Error("usage: bun run seed:scenario <PR#> [--dry-run]");
    }
    return { pr, dryRun: argv.includes("--dry-run") };
}

function main(): void {
    const [, , ...argv] = process.argv;
    let pr: number;
    let dryRun: boolean;
    try {
        ({ pr, dryRun } = parseArgs(argv));
    } catch (err) {
        console.error(`seed:scenario: ${(err as Error).message}`);
        process.exit(1);
    }

    let body: string;
    try {
        body = JSON.parse(gh(["pr", "view", String(pr), "--json", "body"]))
            .body as string;
    } catch (err) {
        console.error(
            `seed:scenario: could not read PR #${pr} (${(err as Error).message})`
        );
        process.exit(1);
    }

    const verdict = classifyScenarioSection(body);
    if (verdict.kind === "none") {
        console.log(
            `seed:scenario: PR #${pr} states no scenario is owed — nothing to register`
        );
        return;
    }
    if (verdict.kind === "absent") {
        console.log(`seed:scenario: PR #${pr} carries no scenario block`);
        return;
    }
    if (verdict.kind === "malformed") {
        console.error(
            `seed:scenario: PR #${pr}'s block does not load — ${(verdict.problems ?? []).join("; ")}`
        );
        process.exit(1);
    }

    const candidate = verdict.candidate!;
    if (dryRun) {
        console.log(
            `seed:scenario: PR #${pr} would register "${candidate.label}" (${candidate.spec.cards.length} card entries)`
        );
        return;
    }

    const cwd = primaryCheckout(process.cwd());
    const outcome = seedScenario(candidate, cwd);
    if (!outcome.ok) {
        console.error(
            `seed:scenario: PR #${pr} "${candidate.label}" FAILED — ${outcome.error}`
        );
        process.exit(1);
    }
    console.log(
        `seed:scenario: PR #${pr} "${candidate.label}" ${outcome.action ?? "written"}`
    );
}

if (import.meta.main) {
    main();
}
