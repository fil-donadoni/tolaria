#!/usr/bin/env bun
// `bun run verdicts:sync` — warm this machine's Verdict pack cache for the
// checkout's committed lock (issue #3581, ADR 0128 §10), e.g. before losing
// connectivity. Idempotent: a warm cache is re-verified from disk and makes no
// network call, and needs no read key. The mechanism, and why a pinned fetch
// keeps the gate's outcome offline: `lib/verdict-pack-cache.ts`.
import { syncVerdictPack, verdictCacheDir } from "./lib/verdict-pack-cache";
import { machineVerdictStoreReader } from "./lib/verdict-store";

syncVerdictPack(process.cwd(), {
    cacheDir: verdictCacheDir(),
    store: () => machineVerdictStoreReader(),
})
    .then((line) => console.log(`verdicts:sync: ${line}`))
    .catch((error: unknown) => {
        console.error(
            `verdicts:sync: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
    });
