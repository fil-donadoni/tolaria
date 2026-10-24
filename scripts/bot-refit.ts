#!/usr/bin/env bun
// `bun run bot:refit [--check]` — re-fit the Bot's weights and regenerate every
// pin that derives from them, in one step (issue #6690, ADR 0158 §3).
// The plan and its rationale: `scripts/lib/bot-refit.ts`.
import { spawnSync } from "node:child_process";
import { refitPlan } from "./lib/bot-refit";

function main(): number {
    const args = process.argv.slice(2);
    const plan = refitPlan(args);
    // `--check` reports EVERY lagging guard in one run; a refit stops at the
    // first failed step, since the next one reads what that step wrote.
    const keepGoing = args.includes("--check");
    const failed: string[] = [];
    for (const step of plan) {
        console.log(`bot:refit [${step.id}] ${step.argv.join(" ")}`);
        const [cmd, ...rest] = step.argv;
        const run = spawnSync(cmd, rest, {
            stdio: "inherit",
            env: { ...process.env, ...step.env },
        });
        if (run.status === 0) continue;
        console.error(
            `bot:refit: step "${step.id}" failed (exit ${run.status ?? run.signal}) — ${step.onFail}`
        );
        failed.push(step.id);
        if (!keepGoing) break;
    }
    if (failed.length > 0) {
        console.error(
            `bot:refit: red — ${failed.join(", ")}${keepGoing ? " (run `bun run bot:refit` to regenerate)" : ""}`
        );
        return 1;
    }
    console.log(`bot:refit: ${plan.length} step(s) green`);
    return 0;
}

process.exit(main());
