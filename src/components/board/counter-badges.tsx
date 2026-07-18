import type { CardInstance } from "~/types/game";
import { getCounterDisplays } from "~/lib/counters";

const TONE_CLASS: Record<string, string> = {
    buff: "bg-emerald-600",
    debuff: "bg-red-700",
    neutral: "bg-amber-600",
};

/** Counter icons (CR 122) stacked at the top-left of a battlefield card.
 *  Each badge shows the counter token and, when more than one, its count
 *  (e.g. "+1/+1 ×3"). Renders nothing when the card has no counters. Sits
 *  opposite the badge index (top-right) and the P/T stack (bottom-right). */
export default function CounterBadges({ card }: { card: CardInstance }) {
    const counters = getCounterDisplays(card);
    if (counters.length === 0) return null;

    return (
        <div className="absolute top-1/2 left-1/2 -translate-1/2 flex flex-col items-start gap-0.5 pointer-events-none z-20">
            {counters.map((c) => (
                <div
                    key={c.type}
                    className={`${TONE_CLASS[c.tone]} px-2 py-1 rounded-full text-sm font-bold text-white leading-none flex flex-col items-center gap-0.5 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]`}
                >
                    <span>{c.short}</span>
                    {c.count > 1 && (
                        <span className="opacity-80">×{c.count}</span>
                    )}
                </div>
            ))}
        </div>
    );
}
