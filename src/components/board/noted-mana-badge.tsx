import type { CardInstance } from "~/types/game";
import ManaSymbol from "~/components/cards/mana-symbol";

/** Noted-mana indicator (CR 106.10) for a mana-battery permanent — Jeweled
 *  Amulet / Ice Cauldron. Surfaces which mana type(s) and amount the artifact
 *  has banked, so the player can tell what its "remove a charge counter" ability
 *  will add. Renders one mana symbol per noted color (with a count when more
 *  than one of that color), pinned to the bottom-left of the card. Renders
 *  nothing when no mana is noted. */
export default function NotedManaBadge({ card }: { card: CardInstance }) {
    const noted = card.notedMana?.mana;
    const entries = noted
        ? Object.entries(noted).filter(([, amount]) => amount > 0)
        : [];
    if (entries.length === 0) return null;

    return (
        <div className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/70 px-1 py-0.5 pointer-events-none z-20 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
            {entries.map(([color, amount]) => (
                <span key={color} className="flex items-center leading-none">
                    <ManaSymbol symbol={color} className="size-4" />
                    {amount > 1 && (
                        <span className="ml-0.5 text-xs font-bold text-white">
                            {amount}
                        </span>
                    )}
                </span>
            ))}
        </div>
    );
}
