import type { CardInstance } from "~/types/game";
import { isPlaneswalker } from "~/lib/card-utils";

/** Loyalty badge (CR 306.5b) shown on a battlefield planeswalker — the
 *  planeswalker's current loyalty, read from the generic `counters["loyalty"]`
 *  map the engine keeps (starting loyalty on ETB, then adjusted by loyalty
 *  abilities and loyalty-removing damage). Renders nothing for a
 *  non-planeswalker; a planeswalker at 0 loyalty leaves the battlefield as an
 *  SBA, so a rendered badge always shows a positive value.
 *
 *  Shape/placement (QA): it is drawn as the printed LOYALTY SHIELD and sits
 *  exactly ON the card's own printed shield in the bottom-right corner —
 *  scaled in % of the card, so it lines up at every board card size — instead
 *  of the old round chip floating beside it. */
export default function PlaneswalkerLoyaltyBadge({
    card,
}: {
    card: CardInstance;
}) {
    if (!isPlaneswalker(card)) return null;
    const loyalty = card.counters?.loyalty ?? 0;
    return (
        <div
            className="pointer-events-none absolute bottom-[1.5%] right-[4%] z-10 flex w-[26%] items-center justify-center"
            style={{ aspectRatio: "10 / 11" }}
            aria-label={`${loyalty} loyalty`}
            data-loyalty-shield
        >
            {/* The shield itself — the printed pentagon (flat top, pointed
                bottom), inked dark with the gold accent rim. The value is SVG
                text inside the same viewBox, so it scales with the shield at
                every card size with no font-size math. */}
            <svg
                viewBox="0 0 40 44"
                className="absolute inset-0 h-full w-full drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                aria-hidden
            >
                <path
                    d="M20 0.5 L39.5 8.5 V25 L20 43.5 L0.5 25 V8.5 Z"
                    fill="#0b0b0c"
                    stroke="var(--color-accent)"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                />
                <text
                    x="20"
                    y="21"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={loyalty >= 100 ? 16 : 22}
                    fontWeight="800"
                    fill="var(--color-parchment)"
                >
                    {loyalty}
                </text>
            </svg>
        </div>
    );
}
