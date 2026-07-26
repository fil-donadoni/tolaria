import ActionButton from "~/components/board/action-button";
import ManaSymbol from "~/components/cards/mana-symbol";

/** One playable opponent in the event's match lobby — a bot seat's Auto-Built
 *  deck or a human seat that has submitted theirs. Compact tile (name, deck
 *  colors as mana symbols, one action) so a full 8-seat table's opponents fit
 *  in a couple of rows instead of eight stacked full-width bars. */
export default function LimitedOpponentTile({
    name,
    colors,
    actionLabel,
    onAction,
    disabled = false,
}: {
    name: string;
    /** Deck colors as single-letter codes (W/U/B/R/G) — empty for a human
     *  seat, whose decklist stays hidden until the event completes. */
    colors?: string[];
    actionLabel: string;
    onAction: () => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center gap-2 rounded-sm border border-border-subtle/40 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-text">
                {name}
            </span>
            {colors && colors.length > 0 && (
                <span className="flex shrink-0 items-center gap-0.5">
                    {colors.map((c) => (
                        <ManaSymbol key={c} symbol={c} className="size-3.5" />
                    ))}
                </span>
            )}
            <ActionButton
                onClick={onAction}
                label={actionLabel}
                tone="primary"
                disabled={disabled}
            />
        </div>
    );
}
