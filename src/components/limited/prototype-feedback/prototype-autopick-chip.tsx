// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-autopick=B`). Never merge.
// Variant B: the grid stays clean; the answer lives with the clock. In the
// last 5 s a chip appears under the timer bar: "Auto-pick in 3s → [thumbnail]
// Card name". Hover (or focus) the chip to find the card: it is spotlit and
// scrolled into view.
import { useState } from "react";
import { openedPrintId } from "@convex/limited/poolArrangement";
import CardImage from "~/components/cards/card-image";
import {
    prototypeTileSelector,
    type PrototypeAutopickProps,
} from "./prototypeAutopickTarget";

export default function PrototypeAutopickChip({
    target,
    isSelection,
    seconds,
}: PrototypeAutopickProps) {
    const [locating, setLocating] = useState(false);
    const tile = target ? prototypeTileSelector(target.pickId) : null;
    const locate = () => {
        setLocating(true);
        if (tile)
            document
                .querySelector(tile)
                ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    return (
        <div data-prototype="autopick-chip" className="flex shrink-0">
            <button
                type="button"
                onMouseEnter={locate}
                onMouseLeave={() => setLocating(false)}
                onFocus={locate}
                onBlur={() => setLocating(false)}
                className="flex min-h-[var(--control-h)] items-center gap-2 rounded-full border py-1 pr-4 pl-3 text-sm transition-colors border-danger/70 bg-danger/15 text-text"
            >
                <span className="font-semibold tabular-nums">
                    Auto-pick in {seconds}s
                </span>
                <span aria-hidden="true">→</span>
                {target ? (
                    <>
                        <span className="pointer-events-none block aspect-5/7 w-7 shrink-0 overflow-hidden rounded-[3px]">
                            <CardImage
                                card={{
                                    id: openedPrintId(target) ?? target.cardId,
                                }}
                                sizes="28px"
                                holdPreview={false}
                            />
                        </span>
                        <span className="font-semibold text-text">
                            {target.cardName}
                        </span>
                        <span className="text-xs">
                            {isSelection
                                ? "(your selection)"
                                : "(suggested — click a card to choose your own)"}
                        </span>
                    </>
                ) : (
                    <span>the Bot will choose for you</span>
                )}
            </button>
            {locating && tile && (
                <style>{`
[data-draft-pick-tile] { opacity: 0.35; transition: opacity 0.15s; }
${tile} {
    opacity: 1;
    outline: 4px solid var(--color-signal-pending);
    outline-offset: 2px;
    scale: 1.06;
    z-index: 2;
}
`}</style>
            )}
        </div>
    );
}
