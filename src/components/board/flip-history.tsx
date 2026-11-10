import type { FlipRecord } from "@convex/gre/types";
import { flipTone, historyCaption } from "~/lib/random-reveal-flip";
import FlipHistoryCoin from "~/components/board/flip-history-coin";

/** A chosen number can be large ("choose 100"): past this many the ghosts
 *  collapse into one "+N more" entry. */
const MAX_GHOSTS = 8;

/** The landed flips of a one-flipper Flip Sequence, under the coin: numbered
 *  mini-coins captioned "1 · Win" … "4 · Lose". `landed` holds one record per
 *  landed round, in order. Once the series has `ended`, "not flipped" ghosts
 *  fill the rest up to the number the card announced (`limit`); before that
 *  the list never hints at how long the series is (CR 705.2). */
export default function FlipHistory({
    landed,
    limit,
    ended,
}: {
    landed: readonly FlipRecord[];
    limit?: number;
    ended: boolean;
}) {
    const missing = ended && limit ? Math.max(0, limit - landed.length) : 0;
    const ghosts = Math.min(missing, MAX_GHOSTS);
    if (landed.length === 0) return null;
    return (
        <ol
            data-testid="flip-history"
            className="flex flex-wrap items-start justify-center gap-x-3 gap-y-2"
        >
            {landed.map((flip, i) => (
                <FlipHistoryCoin
                    key={flip.round}
                    face={flip.face}
                    tone={flipTone(flip)}
                    caption={historyCaption(flip, i)}
                />
            ))}
            {Array.from({ length: ghosts }).map((_, i) => (
                <FlipHistoryCoin
                    key={`ghost-${landed.length + i}`}
                    ghost
                    caption={`${landed.length + i + 1} · not flipped`}
                />
            ))}
            {missing > ghosts && (
                <li
                    data-testid="flip-history-more"
                    className="self-center text-[10px] text-text-disabled"
                >
                    +{missing - ghosts} more not flipped
                </li>
            )}
        </ol>
    );
}
