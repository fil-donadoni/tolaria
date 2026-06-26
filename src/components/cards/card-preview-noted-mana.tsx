import ManaSymbol from "./mana-symbol";

/** Noted-mana section of the card preview (CR 106.10 — Jeweled Amulet, Ice
 *  Cauldron). Mirrors the counters section: lists the mana type(s) and amount a
 *  mana-battery permanent has banked, so the player can read what its
 *  "remove a charge counter" ability will add. Renders one mana symbol per
 *  noted color (with a count when more than one). Renders nothing when no mana
 *  is noted. Reuses the same `ManaSymbol` primitive as the on-card
 *  {@link NotedManaBadge} (#753) so the two surfaces stay visually consistent. */
export default function CardPreviewNotedMana({
    noted,
}: {
    noted?: { mana: Record<string, number>; castableCardId?: string };
}) {
    const entries = noted
        ? Object.entries(noted.mana).filter(([, amount]) => amount > 0)
        : [];
    if (entries.length === 0) return null;

    return (
        <div className="border-t border-border-subtle pt-2 text-sm">
            <div className="text-text-muted font-semibold mb-1">Noted mana</div>
            <div className="flex items-center gap-2 flex-wrap">
                {entries.map(([color, amount]) => (
                    <span
                        key={color}
                        className="flex items-center leading-none"
                    >
                        <ManaSymbol symbol={color} className="size-5" />
                        {amount > 1 && (
                            <span className="ml-0.5 font-bold tabular-nums">
                                ×{amount}
                            </span>
                        )}
                    </span>
                ))}
            </div>
        </div>
    );
}
