import type { CensusResidueFile } from "@convex/limited/cardProfilesCore";
import { resolveCardName } from "@convex/cards/catalogue";

interface CardProfilesResidueProps {
    residues: readonly CensusResidueFile[];
}

/** The census residue as pending Capability proposals, read-only: promotion
 *  stays a registry ticket (PRD #8772). */
export default function CardProfilesResidue({
    residues,
}: CardProfilesResidueProps) {
    const candidates = residues.flatMap((file) =>
        file.candidates.map((candidate) => ({ file, candidate }))
    );
    return (
        <div className="flex flex-col gap-1">
            <span className="text-label">Pending Capability proposals</span>
            {candidates.length === 0 && (
                <p className="text-xs text-text-muted">
                    The census left no residue.
                </p>
            )}
            {candidates.map(({ file, candidate }) => (
                <div
                    key={`${file.pass}-${file.scope}-${candidate.name}`}
                    className="flex flex-col gap-0.5 rounded-sm border border-border-subtle/30 px-2 py-1.5 text-xs"
                >
                    <span className="text-text">{candidate.name}</span>
                    <span className="text-text-muted">{candidate.why}</span>
                    <span className="text-text-muted">
                        Providers: {names(candidate.providers)}
                    </span>
                    <span className="text-text-muted">
                        Requirers: {names(candidate.requirers)}
                    </span>
                </div>
            ))}
        </div>
    );
}

function names(cardIds: readonly string[]): string {
    return cardIds.map((id) => resolveCardName(id) ?? id).join(", ");
}
