import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { cn } from "~/lib/utils";
import PickRatingsThumb from "./pick-ratings-thumb";
import { effectiveRating } from "./pick-ratings-model";

/** Most comparable cards a rung draws; the count column carries the rest. */
const MAX_THUMBS = 30;

interface PickRatingsLadderRungProps {
    step: number;
    card: ScopeCardRating;
    neighbours: readonly ScopeCardRating[];
    disabled: boolean;
    /** Whether the open card sits on this rung. */
    here: boolean;
    onRate: (step: number) => void;
    onOpenNeighbour: (cardId: string) => void;
}

/** One rung: clicking it rates the open card; the cards already on it are the
 *  comparison (right click previews, left click opens that card to
 *  reposition it). */
export default function PickRatingsLadderRung({
    step,
    card,
    neighbours,
    disabled,
    here,
    onRate,
    onOpenNeighbour,
}: PickRatingsLadderRungProps) {
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label={`Rate ${card.name} ${step.toFixed(1)}`}
            aria-pressed={here}
            data-pick-rating-rung={step}
            onClick={() => {
                if (!disabled) onRate(step);
            }}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                if (!disabled) onRate(step);
            }}
            className={cn(
                "grid min-h-11 cursor-pointer grid-cols-[2.5rem_2.25rem_minmax(0,1fr)_2.5rem] items-center gap-2 border-t border-border-subtle/20 px-1 py-0.5 transition",
                here ? "bg-accent/20" : "hover:bg-surface-elevated/40",
                disabled && "cursor-wait opacity-70"
            )}
        >
            <span
                className={cn(
                    "font-mono text-sm",
                    here ? "text-text" : "text-text-muted"
                )}
            >
                {step.toFixed(1)}
                {card.seedRating === step && (
                    <span className="block text-xs leading-none text-text-muted">
                        seed
                    </span>
                )}
            </span>
            <span>
                {here && (
                    <PickRatingsThumb
                        cardId={card.cardId}
                        name={card.name}
                        width="w-8"
                        sizes="32px"
                        title={`${card.name} · ${effectiveRating(card).toFixed(1)}`}
                    />
                )}
            </span>
            <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                {neighbours.slice(0, MAX_THUMBS).map((other) => (
                    <PickRatingsThumb
                        key={other.cardId}
                        cardId={other.cardId}
                        name={other.name}
                        width="w-7"
                        sizes="28px"
                        title={`${other.name} · ${effectiveRating(other).toFixed(1)}`}
                        onSelect={() => onOpenNeighbour(other.cardId)}
                    />
                ))}
            </span>
            <span className="text-right font-mono text-xs text-text-muted">
                {neighbours.length > MAX_THUMBS
                    ? `+${neighbours.length - MAX_THUMBS}`
                    : neighbours.length === 0
                      ? ""
                      : neighbours.length}
            </span>
        </div>
    );
}
