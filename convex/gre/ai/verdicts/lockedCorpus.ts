// The Verdict Lock's corpus beside the blade registry's (issue #3578, PRD
// #3574, ADR 0128 §2).
//
// Its own module since issue #3581, and only for its imports: the lock's
// reader (`lockSource.ts`) needs nothing from the blade registry, but this
// composition does, and the registry reaches the engine's scenario setup —
// `game.ts`, the generated API and, through `@auth/core`, `lib.dom`. A script
// that verifies a pack (`scripts/lib/verdict-pack-cache.ts`) imports the
// reader alone, and so keeps that graph out of the scripts type-check.

import { verdictsFromRegistry, type RegistryVerdicts } from "./registrySource";
import type { BladeScenario } from "../blade/types";
import {
    verdictsFromLock,
    type StoredVerdictPayload,
    type VerdictLock,
} from "./lockSource";

/**
 * The whole corpus the lock decides: the blade registry's derived verdicts
 * first, then the locked verdicts in lock order, with the registry's gaps
 * carried through — the same shape, and the same reason for the order, as
 * `verdictCorpus` over files.
 *
 * `payloads` has NO DEFAULT, for the reason `verdictCorpus`'s `files` has
 * none: a caller that forgot to fetch would otherwise get a registry-only
 * corpus that looks like nobody judged anything. Here it would throw anyway
 * for any non-empty lock; an empty lock with `[]` is a real, empty corpus.
 */
export function lockedVerdictCorpus(
    lock: VerdictLock,
    payloads: readonly StoredVerdictPayload[],
    scenarios?: readonly BladeScenario[]
): RegistryVerdicts {
    const registry = verdictsFromRegistry(scenarios);
    return {
        verdicts: [...registry.verdicts, ...verdictsFromLock(lock, payloads)],
        gaps: registry.gaps,
    };
}
