// Compiled-card hydration seam (issue #2702, PRD #2693 — the Oracle
// compiler). Compiled definitions are registered into the SAME runtime
// registry (`convex/cards/registry.ts`) hand-written cards use, through the
// SAME `preloadDefinitions` seam `catalogue.ts` calls for `allCards`.
//
// The contract (PRD #2693): "consumers never learn whether a definition was
// compiled or hand-written." Every GRE/projection/Bot/Draft Lab/preview call
// site reads `getDefinition`/`tryGetDefinition` (ADR 0046) — this seam adds
// rows to that ONE map and nothing else. It does NOT feed `catalogue.ts`'s
// `allCards`/`getAllCards()` — that population drives several catalogue-wide
// sweeps (full-catalogue asset build, migration classifier, card-index
// guard) whose blast radius is a separate decision from "can a compiled card
// be looked up". See `docs/adr/0108-compiled-card-id-scheme.md` for the id
// scheme and the getAllCards() exclusion rationale.
//
// WHERE THE ROWS COME FROM is asymmetric (ADR 0113 §2, issue #3053): the
// server reads them from the module graph (`./compiledPool`), the client
// FETCHES the merged content-addressed artifact at the loading gate
// (`src/lib/catalogueArtifact.ts`). Both hand the rows to the SAME
// `registerCompiledDefinitions` in `catalogue.ts`, so the filter below runs
// identically on both sides.
//
// Size budget: the client asset is budgeted by
// `scripts/__tests__/catalogue-artifact-size.test.ts` (served bytes) and the
// two client chunks by `scripts/check-bundle-size.ts`; the server bundle by
// `bun run check:convex-bundle` (ADR 0113 § Amendment).
import type { CardDefinition } from "./types";

/**
 * The runtime backstop, kept as a FILTER and asserted to be a no-op
 * (ADR 0114 §2, issue #3052).
 *
 * The collision between a compiled row and a hand-written definition for the
 * same print id is resolved at BUILD: `scripts/oracle-pool.ts` excludes a
 * hand-written oracle id at generation, and `scripts/catalogue-artifact.ts`
 * merges the two populations into one artifact, where a divergence is a red.
 * So on the SERVER this never has anything to drop, and the assertion that it
 * never does lives in `scripts/__tests__/catalogue-artifact.test.ts`.
 *
 * On the CLIENT it is load-bearing rather than a backstop: the fetched
 * artifact holds the 890 relocated hand-written rows too (issue #3052), and
 * those ids are already in the registry from the module graph, which is the
 * copy the engine runs and the copy the divergence baseline rules
 * authoritative. Same filter, same direction, both sides.
 *
 * The assertion is in the GATE and not here on purpose. This function is
 * called at module load of `convex/cards/catalogue.ts`, which every Convex
 * mutation, the browser bundle and every test file transitively imports;
 * throwing on a stale pool would turn a tree that runs correctly today —
 * dropping the compiled twin LEAVES the hand-written definition, which
 * PRD #2693 makes authoritative — into a white screen, a failed deploy and a
 * collection error in every suite at once. A gate that reds with the name of
 * the card and the command to run is strictly better than an outage, and it
 * is the same staleness `bun run catalogue:check` already names.
 */
export function excludeHandWritten(
    compiled: readonly CardDefinition[],
    handWrittenIds: ReadonlySet<string>
): CardDefinition[] {
    return compiled.filter((c) => !handWrittenIds.has(c.id));
}
