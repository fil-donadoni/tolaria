// Ladder pairing-subset filter (issue #2681, decision #1895 §1 coverage
// ledger). `--pairings deckA:deckB,...` or `--dynamics tag,...` restricts a
// run to a subset of LADDER_PAIRINGS rows WITHOUT renumbering them: every
// downstream consumer (buildGamePlan's `baseSeed + p * seedsPerPairing + k`
// seed derivation, the resume identity key `gameIndex`) keeps indexing the
// row's position in the FULL registry. This module only decides WHICH
// indices a filter selects — filtering the already-built plan by that set is
// a separate, index-preserving step (see `filterGamePlan` in plan.ts).
//
// A filter value that matches zero rows throws rather than silently running
// an empty (or unintentionally broader) plan — a typo'd deck id or dynamics
// tag must fail loudly (issue #2681 acceptance: "--dynamics combo runs only
// the rows tagged combo").

import type { LadderPairing } from "./pairings";

export type LadderFilterSpec =
    | { kind: "pairings"; values: string[] }
    | { kind: "dynamics"; values: string[] };

/** Parse a comma-separated `--pairings`/`--dynamics` CLI value. */
export function parseFilterArg(
    kind: "pairings" | "dynamics",
    raw: string
): LadderFilterSpec {
    const values = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (values.length === 0)
        throw new Error(`--${kind} needs at least one value`);
    return { kind, values };
}

/** The set of indices into `pairings` a filter selects — the registry-index
 *  identity every other function in this module and plan.ts preserves. Null
 *  filter = every row (the unfiltered run). Throws if any single filter value
 *  matches no row. */
export function selectPairingIndices(
    pairings: LadderPairing[],
    filter: LadderFilterSpec | null
): Set<number> {
    if (!filter) return new Set(pairings.map((_, i) => i));
    const out = new Set<number>();
    for (const raw of filter.values) {
        let matched = false;
        if (filter.kind === "pairings") {
            const [a, b] = raw.split(":");
            if (!a || !b)
                throw new Error(
                    `malformed --pairings entry "${raw}" (want deckA:deckB)`
                );
            pairings.forEach((row, i) => {
                if (
                    (row.deckA === a && row.deckB === b) ||
                    (row.deckA === b && row.deckB === a)
                ) {
                    out.add(i);
                    matched = true;
                }
            });
        } else {
            pairings.forEach((row, i) => {
                if (row.dynamics.includes(raw)) {
                    out.add(i);
                    matched = true;
                }
            });
        }
        if (!matched)
            throw new Error(
                `--${filter.kind}: no registry row matches "${raw}"`
            );
    }
    return out;
}
