// The Profile Census residue files (PRD #8772, issue #8906), bundled at build
// time from `data/card-profiles/residue/*.json`: read-only data, never an
// engine input. An empty directory is a valid state (no pass has run yet).
import type { CensusResidueFile } from "@convex/limited/cardProfilesCore";

const files = import.meta.glob<CensusResidueFile>(
    "../../data/card-profiles/residue/*.json",
    { eager: true, import: "default" }
);

/** Every checked-in residue file, in file-name order. */
export const CENSUS_RESIDUE_FILES: readonly CensusResidueFile[] = Object.keys(
    files
)
    .sort()
    .map((path) => files[path]);

/** The residue shown for one scope: that scope's own passes plus the
 *  catalogue-wide capability pass — the Capability proposals no scope owns. */
export function residueForScope(
    residues: readonly CensusResidueFile[],
    scope: string | undefined
): CensusResidueFile[] {
    return residues.filter(
        (file) => file.pass === "capability" || file.scope === scope
    );
}
