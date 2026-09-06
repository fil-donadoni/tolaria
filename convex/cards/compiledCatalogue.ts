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
 * The runtime backstop, kept as a FILTER and asserted to be a no-op
 * (ADR 0114 §2, issue #3052).
 *
 * The collision between a compiled row and a hand-written definition for the
 * same print id is resolved at BUILD: `scripts/oracle-pool.ts` excludes a
 * hand-written oracle id at generation, and `scripts/catalogue-artifact.ts`
 * merges the two populations into one artifact, where a divergence is a red.
 * So this never has anything to drop, and the assertion that it never does
 * lives in `scripts/__tests__/catalogue-artifact.test.ts`.
 *
 * The assertion is THERE and not here on purpose. This function is called at
 * module load of `convex/cards/catalogue.ts`, which every Convex mutation, the
 * browser bundle and every test file transitively imports; throwing on a stale
 * pool would turn a tree that runs correctly today — dropping the compiled
 * twin LEAVES the hand-written definition, which PRD #2693 makes authoritative
 * — into a white screen, a failed deploy and a collection error in every suite
 * at once. A gate that reds with the name of the card and the command to run
 * is strictly better than an outage, and it is the same staleness
 * `bun run catalogue:check` already names.
 */
export function excludeHandWritten(
    compiled: readonly CardDefinition[],
    handWrittenIds: ReadonlySet<string>
): CardDefinition[] {
    return compiled.filter((c) => !handWrittenIds.has(c.id));
}
