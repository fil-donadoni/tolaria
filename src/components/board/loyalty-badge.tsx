import type { CardInstance } from "~/types/game";
import { isCreature, showsLoyalty } from "~/lib/card-utils";

/** Loyalty badge (CR 306.5b) shown on a battlefield permanent that HAS
 *  loyalty — its current loyalty, read from the generic `counters["loyalty"]`
 *  map the engine keeps (starting loyalty on ETB, then adjusted by loyalty
 *  abilities and loyalty-removing damage).
 *
 *  NOT planeswalker-only (issue #3299). CR 606.2 says "Normally, only
 *  planeswalkers have loyalty abilities" — normally, not only: a creature
 *  granted a loyalty ability (Agatha's Soul Cauldron copying Grist, the Hunger
 *  Tide's abilities out of exile) accumulates real loyalty counters, and a
 *  planeswalker-gated badge left them invisible, so the player could not tell
 *  whether a `-N` ability was affordable under CR 606.6. The predicate lives in
 *  `~/lib/card-utils` `showsLoyalty` and is what decides; see it for why a
 *  planeswalker still renders its zero.
 *
 *  Shape/placement (QA): it is drawn as the printed LOYALTY SHIELD and sits
 *  exactly ON the card's own printed shield in the bottom-right corner —
 *  scaled in % of the card, so it lines up at every board card size — instead
 *  of the old round chip floating beside it.
 *
 *  The bottom offset depends on WHAT is wearing it (QA). A planeswalker's own
 *  printed shield is in that corner and nothing else occupies it, so the badge
 *  sits at 1.5%, right on top of it. A CREATURE holding a granted loyalty
 *  ability has its P/T box there instead, and at 1.5% the shield overflows it;
 *  13.5% clears the box and leaves both readable. */
export default function LoyaltyBadge({ card }: { card: CardInstance }) {
    if (!showsLoyalty(card)) return null;
    const loyalty = card.counters?.loyalty ?? 0;
    const bottom = isCreature(card) ? "13.5%" : "1.5%";
    return (
        <div
            className="pointer-events-none absolute right-[4%] z-10 flex w-[26%] items-center justify-center"
            style={{ aspectRatio: "10 / 11", bottom }}
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
