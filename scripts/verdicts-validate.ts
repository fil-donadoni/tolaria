#!/usr/bin/env bun
// `bun run verdicts:validate` — every object in the Verdict Store, and exactly
// why each one that is not promotable is not (issue #3583, ADR 0128 §7).
// Read-only: it needs this machine's reader key and writes nothing. The
// mechanism: `lib/verdict-promotion-run.ts`.
import {
    runVerdictsValidate,
    vitestEngineStep,
} from "./lib/verdict-promotion-run";
import { machineVerdictStoreReader } from "./lib/verdict-store";

async function main(): Promise<void> {
    const root = process.cwd();
    const text = await runVerdictsValidate({
        root,
        reader: machineVerdictStoreReader(),
        engineStep: vitestEngineStep(root),
    });
    console.log(text);
}

main().catch((error: unknown) => {
    console.error(
        `verdicts:validate: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
});
