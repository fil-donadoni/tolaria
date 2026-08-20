import type { Color } from "@convex/cards/types";
import ManaSymbol from "~/components/cards/mana-symbol";

/** WUBRG order (CR 200.2) — the order every Magic UI shows colours in. */
const PIP_ORDER: readonly Color[] = ["W", "U", "B", "R", "G"];

/**
 * The bottom bar's colour PIPS (issue #2584): one mana symbol per colour the
 * Maindeck actually asks for, with its pip count beside it.
 *
 * Counting already happened in `computeDeckStats` (`src/lib/deckStats.ts`) —
 * this renders `DeckStats.pips` and does no arithmetic of its own, the same
 * split `DeckStatsColorRow` follows for the Stats dialog. A colour with no
 * pips renders nothing at all rather than a zero, so a mono-red deck's bar
 * shows one symbol instead of five.
 */
export default function DeckMiniPips({
    pips,
}: {
    pips: Partial<Record<Color, number>>;
}) {
    const shown = PIP_ORDER.filter((color) => (pips[color] ?? 0) > 0);
    if (shown.length === 0) return null;
    return (
        <div
            className="flex shrink-0 items-center gap-1"
            aria-label="Maindeck colour pips"
        >
            {shown.map((color) => (
                <span key={color} className="flex items-center gap-0.5">
                    <ManaSymbol symbol={color} className="size-3.5" />
                    <span className="text-[0.625rem] text-text-muted">
                        {pips[color]}
                    </span>
                </span>
            ))}
        </div>
    );
}
