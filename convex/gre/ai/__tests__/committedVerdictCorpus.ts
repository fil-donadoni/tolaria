// The corpus a checkout commits to (ADR 0128 §2, issue #3584): the blade
// registry's verdicts, then the verdicts the committed Verdict Lock names,
// read from the machine pack cache and verified against the lock.
//
// ONE reader for every consumer — the reproducibility guard
// (`weightFit.bot.test.ts`) and the blade runners (`fit:weights`, the verdict
// report, the coverage census). Before issue #3584 the runners read
// `data/verdicts/**` beside the lock, which was a second path able to feed a
// fit the guard never saw; that directory is gone, and this is what replaced
// it.
//
// A helper, not a test: no `*.test.ts` / `*.spec.ts` suffix, so no suite
// collects it, and it lives under `__tests__/` so the Convex bundler skips it.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    loadLockedVerdicts,
    verdictCacheDir,
} from "../../../../scripts/lib/verdict-pack-cache";
import { machineVerdictStoreReader } from "../../../../scripts/lib/verdict-store";
import type { VerdictStoreReader } from "../../../verdictStore";
import { BLADE_SCENARIOS } from "../blade/registry";
import type { BladeScenario } from "../blade/types";
import { VERDICT_LOCK_PATH, parseVerdictLock } from "../verdicts/lockSource";
import {
    verdictsFromRegistry,
    type RegistryVerdicts,
} from "../verdicts/registrySource";

export type CommittedCorpusSource = {
    root: string;
    cacheDir: string;
    store: () => VerdictStoreReader;
};

/** This checkout, this machine's cache, this machine's reader key. */
export const MACHINE_CORPUS_SOURCE: CommittedCorpusSource = {
    root: resolve(__dirname, "../../../.."),
    cacheDir: verdictCacheDir(),
    store: () => machineVerdictStoreReader(),
};

/** The registry's verdicts for `scenarios`, then the lock's. No lock, no
 *  locked verdicts — and no network call. */
export async function committedVerdictCorpus(
    scenarios: readonly BladeScenario[] = BLADE_SCENARIOS,
    source: CommittedCorpusSource = MACHINE_CORPUS_SOURCE
): Promise<RegistryVerdicts> {
    const registry = verdictsFromRegistry(scenarios);
    const lockFile = join(source.root, VERDICT_LOCK_PATH);
    if (!existsSync(lockFile)) return registry;
    const { verdicts } = await loadLockedVerdicts(
        parseVerdictLock(readFileSync(lockFile, "utf8")),
        { cacheDir: source.cacheDir, store: source.store }
    );
    return {
        verdicts: [...registry.verdicts, ...verdicts],
        gaps: registry.gaps,
    };
}
