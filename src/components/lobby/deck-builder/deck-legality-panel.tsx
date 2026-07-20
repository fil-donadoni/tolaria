import type { Reason } from "@convex/formats";

interface DeckLegalityPanelProps {
    /** The Format's human-readable label, shown in the heading. */
    formatLabel: string;
    isLegal: boolean;
    reasons: Reason[];
}

/**
 * Live deck-legality readout for the builder (PRD #509, ADR 0036, issue #512).
 * Reflects the shared pure `validateDeck` as the working deck changes: a green
 * "legal" badge when the deck satisfies its Format, or the precise list of
 * failure reasons otherwise. Advisory only — the authoritative gate runs server
 * side at game start. Freeform decks are always legal, so this shows the badge.
 */
export default function DeckLegalityPanel({
    formatLabel,
    isLegal,
    reasons,
}: DeckLegalityPanelProps) {
    return (
        <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-1 border-t border-border-subtle/30 bg-surface/60 px-4 py-2 md:px-6"
        >
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {formatLabel} legality
                </span>
                {isLegal ? (
                    <span className="rounded-sm bg-success/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-strong">
                        Legal
                    </span>
                ) : (
                    <span className="rounded-sm bg-danger/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-strong">
                        Illegal
                    </span>
                )}
            </div>
            {!isLegal && (
                <ul className="flex flex-col gap-0.5">
                    {reasons.map((r) => (
                        <li
                            key={`${r.code}:${r.message}`}
                            className="text-xs text-danger-strong/90"
                        >
                            {r.message}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
