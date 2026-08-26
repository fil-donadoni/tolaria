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

/** A hand-written `CardDefinition` is ALWAYS authoritative (PRD #2693 "gold
 *  as oracle"). `scripts/oracle-pool.ts` already excludes an oracle id that
 *  has a hand-written `data/card-index.json` entry at GENERATION time; this
 *  is the runtime backstop for a hand-written card added since the pool was
 *  last regenerated (a fresher `handWrittenIds` than the pool's own join
 *  saw) — a pure function so the collision-avoidance itself is unit-testable
 *  without needing two conflicting definitions to share an id in the real,
 *  module-load-once catalogue (ADR 0108). */
export function excludeHandWritten(
    compiled: readonly CardDefinition[],
    handWrittenIds: ReadonlySet<string>
): CardDefinition[] {
    return compiled.filter((c) => !handWrittenIds.has(c.id));
}
