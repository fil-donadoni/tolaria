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
// THE SECOND DOT IN `.fixture.ts` IS LOAD-BEARING. This module reads the
// machine pack cache, so `node:fs` and the store reader's `node:crypto` reach
// it, and a Convex module may not import either. What keeps it out of the
// bundle is the basename: entry-point discovery skips any name with more than
// one dot (`node_modules/convex/dist/cjs/bundler/index.js`, mirrored in
// `scripts/lib/convex-bundle-size.ts`) — that, not the `__tests__` directory,
// is also why the `*.test.ts` / `*.spec.ts` files beside it are skipped. A
// single-dot name here is pushed as a Convex module and reds
// `check:convex-bundle`.
//
// It does not belong in `scripts/` either: it imports the blade registry, and
// a `scripts/` entry that does drags the blade graph into the scripts
// type-check program — the hazard `gre/ai/blade/verdictPromotion.ts` documents
// and `scripts/lib/verdict-promotion-run.ts` shells out to a spec to avoid.
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
