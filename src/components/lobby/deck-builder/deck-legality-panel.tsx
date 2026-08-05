import { useState } from "react";
import type { Reason } from "@convex/formats";

interface DeckLegalityPanelProps {
    /** The Format's human-readable label, shown in the heading. */
    formatLabel: string;
    isLegal: boolean;
    reasons: Reason[];
}

/** Reasons shown before the list is capped behind a disclosure (issue #2056
 *  defect 2) — an uncapped list grows the panel unbounded, which on a short
 *  viewport (852x303 baseline) was already pushing the Save bar below the
 *  fold with just one reason showing. */
const MAX_VISIBLE_REASONS = 2;

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
    const [expanded, setExpanded] = useState(false);
    const visibleReasons =
        expanded || reasons.length <= MAX_VISIBLE_REASONS
            ? reasons
            : reasons.slice(0, MAX_VISIBLE_REASONS);
    const hiddenCount = reasons.length - visibleReasons.length;

    return (
        <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-1 border-t border-border-subtle/30 bg-surface/60 px-4 py-2 short-viewport:py-1 md:px-6"
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
                <>
                    <ul className="flex flex-col gap-0.5 short-viewport:max-h-16 short-viewport:overflow-y-auto">
                        {visibleReasons.map((r) => (
                            <li
                                key={`${r.code}:${r.message}`}
                                className="text-xs text-danger-strong/90"
                            >
                                {r.message}
                            </li>
                        ))}
                    </ul>
                    {(hiddenCount > 0 || expanded) &&
                        reasons.length > MAX_VISIBLE_REASONS && (
                            <button
                                type="button"
                                onClick={() => setExpanded((v) => !v)}
                                className="self-start text-[10px] font-semibold uppercase tracking-wide text-accent hover:underline"
                            >
                                {expanded
                                    ? "Show fewer"
                                    : `+${hiddenCount} more`}
                            </button>
                        )}
                </>
            )}
        </div>
    );
}
