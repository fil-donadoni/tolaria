#!/usr/bin/env bun
// `bun run verdicts:testers` — per-tester quality: for each person, the
// positions they judged, the ones someone else answered differently, the ones
// quarantined now, and the ones the Weight Fit could not satisfy (issue #3585,
// ADR 0128). Every number is derived on this run from the Verdict Store, the
// committed lock and the fit report over it, and lists the verdict ids behind
// it for `/admin/verdicts`. Read-only: it needs this machine's reader key. The
// mechanism: `lib/verdict-promotion-run.ts`.
import {
    runVerdictsTesters,
    vitestEngineStep,
} from "./lib/verdict-promotion-run";
import { machineVerdictStoreReader } from "./lib/verdict-store";

async function main(): Promise<void> {
    const root = process.cwd();
    const text = await runVerdictsTesters({
        root,
        reader: machineVerdictStoreReader(),
        engineStep: vitestEngineStep(root),
    });
    console.log(text);
}

main().catch((error: unknown) => {
    console.error(
        `verdicts:testers: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
});
