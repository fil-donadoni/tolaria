#!/usr/bin/env bun
// `bun run verdicts:exam` — every promotable player Verdict the Verdict Lock
// does not name enters it on the EXAM side (ADR 0186 Decision 7, issue
// #10851): named in the lock's `examIds`, never read by the Weight Fit, always
// counted by Held-out Agreement. No weight moves — the engine step re-runs the
// fit and refuses unless it reproduces the committed weights — so only the
// lock (and the pack, on the deployment) is written. Idempotent: re-running
// with nothing new writes nothing.
//
// Needs the reader key and a deploy key, as `verdicts:promote` does. The
// mechanism: `lib/verdict-promotion-run.ts`.
import {
    deploymentPackWriter,
    runVerdictsExam,
    vitestEngineStep,
} from "./lib/verdict-promotion-run";
import { verdictCacheDir } from "./lib/verdict-pack-cache";
import { machineVerdictStoreReader } from "./lib/verdict-store";

async function main(): Promise<void> {
    const root = process.cwd();
    const outcome = await runVerdictsExam({
        root,
        reader: machineVerdictStoreReader(),
        engineStep: vitestEngineStep(root),
        cacheDir: verdictCacheDir(),
        writePack: deploymentPackWriter(root),
    });
    console.log(outcome.text);
}

main().catch((error: unknown) => {
    console.error(
        `verdicts:exam: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
});
