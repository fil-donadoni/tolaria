#!/usr/bin/env bun
// `bun run verdicts:promote` — everything integral and unconflicted in the
// Verdict Store enters the Verdict Lock, and `DEFAULT_EVAL_WEIGHTS` moves with
// it, in one change (issue #3583, ADR 0128 §7). Prints the report a reviewer
// reads: new Eval Pairs, pairs the fit could not satisfy, per-weight movement
// and the blade `must` result.
//
// Needs this machine's reader key AND a deploy key in the environment
// (`CONVEX_DEPLOY_KEY`): the pack is written by the deployment, never from
// here. Re-running with nothing new is a no-op. Exits 1 when the blade `must`
// tier is red on the rewritten weights — the files are written, and the
// report says what to read. The mechanism: `lib/verdict-promotion-run.ts`.
import {
    bladeMustRunner,
    deploymentPackWriter,
    runVerdictsPromote,
    vitestEngineStep,
} from "./lib/verdict-promotion-run";
import { verdictCacheDir } from "./lib/verdict-pack-cache";
import { machineVerdictStoreReader } from "./lib/verdict-store";

async function main(): Promise<void> {
    const root = process.cwd();
    const outcome = await runVerdictsPromote({
        root,
        reader: machineVerdictStoreReader(),
        engineStep: vitestEngineStep(root),
        cacheDir: verdictCacheDir(),
        writePack: deploymentPackWriter(root),
        runBladeMust: bladeMustRunner(root),
    });
    console.log(outcome.text);
    if (outcome.bladePassed === false) process.exit(1);
}

main().catch((error: unknown) => {
    console.error(
        `verdicts:promote: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
});
