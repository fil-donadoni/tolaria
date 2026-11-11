import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import CardProfileRelatedCard from "./card-profile-related-card";
import { effectiveProfile, type ProfileField } from "./card-profiles-model";

interface CardProfileRelatedCardsProps {
    cards: readonly ScopeCardProfile[];
    /** Which field the peek lists for each card — the line's layer. */
    field: ProfileField;
    /** Accessible name of the group (`Also tagged aggro`, …). */
    label: string;
}

function tagsOf(card: ScopeCardProfile, field: ProfileField): string {
    const effective = effectiveProfile(card);
    if (field === "archetypes") {
        return `Archetypes: ${(effective?.archetypes ?? []).join(", ") || "—"}`;
    }
    const provides = (effective?.provides ?? []).join(", ") || "—";
    const requires = (effective?.requires ?? []).join(", ") || "—";
    return `Provides: ${provides} · Requires: ${requires}`;
}

/** The related cards of one focus-dialog line, right-aligned; a dash when
 *  the scope has none. */
export default function CardProfileRelatedCards({
    cards,
    field,
    label,
}: CardProfileRelatedCardsProps) {
    return (
        <span
            role="group"
            aria-label={label}
            className="flex items-center justify-end gap-0.5"
        >
            {cards.length === 0 && (
                <span className="text-xs text-text-disabled">—</span>
            )}
            {cards.map((card) => (
                <CardProfileRelatedCard
                    key={card.cardId}
                    cardId={card.cardId}
                    name={card.name}
                    tags={tagsOf(card, field)}
                />
            ))}
        </span>
    );
}
