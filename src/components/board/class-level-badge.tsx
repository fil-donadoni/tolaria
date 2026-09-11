import ManaSymbol from "~/components/cards/mana-symbol";
import { getClassLevelDisplay } from "~/lib/class-levels";
import type { CardInstance } from "~/types/game";

/** Class level indicator (CR 716) for a Class enchantment on the battlefield:
 *  the level it is at now and, while there is one left, the cost printed on the
 *  next level's bar.
 *
 *  Both halves are load-bearing. The level alone does not say what the player
 *  can DO — CR 716.2a admits exactly one bar at any moment, the one for
 *  level+1, so without its cost beside it the only way to learn the price is to
 *  open the ability menu. And the level itself has nowhere else to appear: it
 *  is deliberately NOT a counter (CR 716.4 / 711.7), so `CounterBadges` cannot
 *  show it the way it shows a Saga's lore counters.
 *
 *  Placement (QA): bottom-left, the `NotedManaBadge` corner. They cannot
 *  collide — noted mana is a mana-battery artifact's state and a Class is an
 *  enchantment — and the two corners that CAN be occupied on a Class are left
 *  alone: `CounterBadges` sits centred and `LoyaltyBadge` bottom-right.
 *
 *  Renders nothing for a permanent that is not a Class, so the board pays a
 *  subtype check per card and nothing else. */
export default function ClassLevelBadge({ card }: { card: CardInstance }) {
    const display = getClassLevelDisplay(card);
    if (!display) return null;

    return (
        <div
            className="pointer-events-none absolute bottom-1 left-1 z-20 flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
            aria-label={
                display.nextLevel === null
                    ? `Class level ${display.level}, maximum level`
                    : `Class level ${display.level}, level ${display.nextLevel} costs ${display.nextCostSymbols.join("")}`
            }
            data-class-level={display.level}
        >
            <span className="text-xs leading-none font-bold text-white">
                Lv {display.level}
            </span>
            {display.nextLevel !== null && (
                <span className="flex items-center gap-0.5 border-l border-white/30 pl-1 leading-none">
                    <span className="text-[0.625rem] leading-none text-white/70">
                        →{display.nextLevel}
                    </span>
                    {display.nextCostSymbols.map((symbol, index) => (
                        <ManaSymbol
                            key={`${symbol}-${index}`}
                            symbol={symbol}
                            className="size-3.5"
                        />
                    ))}
                </span>
            )}
        </div>
    );
}
