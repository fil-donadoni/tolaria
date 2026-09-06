// Compiled-card hydration seam (issue #2702, PRD #2693 — the Oracle
// compiler). Interim physical form: `data/oracle-compiled-pool.json` — a
// GENERATED, committed, ready-only slice of `data/oracle-compiled.json`
// (`bun run oracle:pool`, `scripts/oracle-pool.ts`) — is imported at module
// level as JSON and registered into the SAME runtime registry
// (`convex/cards/registry.ts`) hand-written cards use, through the SAME
// `preloadDefinitions` seam `catalogue.ts` calls for `allCards`.
//
// The contract (PRD #2693): "consumers never learn whether a definition was
// compiled or hand-written." Every GRE/projection/Bot/Draft Lab/preview call
// site reads `getDefinition`/`tryGetDefinition` (ADR 0046) — this module adds
// rows to that ONE map and nothing else. It does NOT feed `catalogue.ts`'s
// `allCards`/`getAllCards()` — that population drives several catalogue-wide
// sweeps (full-catalogue asset build, migration classifier, card-index
// guard) whose blast radius is a separate decision from "can a compiled card
// be looked up"; folding compiled rows into it is left to a follow-up once
// the physical store (out of scope here, PRD #2693) exists. See
// `docs/adr/0108-compiled-card-id-scheme.md` for the id scheme and the
// getAllCards() exclusion rationale.
//
// Size budget: `scripts/__tests__/oracle-pool-size.test.ts` measures the
// REAL committed `data/oracle-compiled-pool.json` and fails the gate past
// `BUDGET_BYTES` — see that file for the threshold and its rationale. This
// is what keeps "hydrate the pool at module load" from becoming "hydrate the
// whole 34,890-row corpus at module load" as the compiler's `ready` count
// grows; crossing the budget is the signal to build the real per-deck store
// PRD #2693 deliberately deferred.
import type { CardDefinition } from "./types";
import compiledPool from "../../data/oracle-compiled-pool.json";

/** The compiled-ready pool, exactly as `scripts/oracle-pool.ts` wrote it:
 *  full `CardDefinition[]` shape (the join already resolved `id` + `rarity`
 *  from `data/card-index.json`; `scripts/oracle-pool.ts`'s own header
 *  explains why those two fields — and no others — are added on top of the
 *  compiler's `CompiledDefinition`). */
export const compiledReadyDefinitions: CardDefinition[] =
    compiledPool as unknown as CardDefinition[];

/**
 * The collision is resolved at BUILD; this asserts that it was (ADR 0114 §2,
 * issue #3052).
 *
 * This function used to be `excludeHandWritten`, a runtime FILTER: a compiled
 * row whose id a hand-written definition already claimed was silently dropped.
 * ADR 0114 §2 deletes that class rather than managing it — one generator
 * (`scripts/catalogue-artifact.ts`) merges the two populations into a single
 * artifact, so by the time anything hydrates there is nothing left to resolve,
 * and `bun run catalogue:check` reds on a hand-written card added without
 * regenerating. What used to be silently filtered is therefore a stale
 * `data/oracle-compiled-pool.json`, and silence is the wrong answer to it:
 * `preloadDefinitions` is last-write-wins, so a dropped assertion here would
 * let a compiled row OVERWRITE the hand-written definition the engine is
 * meant to run.
 *
 * It never fires on a regenerated tree — `scripts/oracle-pool.ts` excludes a
 * hand-written oracle id at generation, and the merge asserts the same
 * disjointness — which is exactly what makes throwing affordable.
 */
export function assertNoHandWrittenCollision(
    compiled: readonly CardDefinition[],
    handWrittenIds: ReadonlySet<string>
): readonly CardDefinition[] {
    const collisions = compiled
        .filter((c) => handWrittenIds.has(c.id))
        .map((c) => `${c.name} (${c.id})`);
    if (collisions.length > 0) {
        throw new Error(
            `compiled pool collides with ${collisions.length} hand-written ` +
                `definition(s): ${collisions.join(", ")}. The pool is stale — ` +
                `run \`bun run oracle:pool\` (ADR 0114 §2: the collision is ` +
                `resolved at BUILD, never at hydration).`
        );
    }
    return compiled;
}
