// One reconstructed pick: the historical fact beside what the current
// scorer would pick (issue #1613). A human seat's pick has no recomputed
// analogue — `recomputedCardId` is `null` and the row renders an em dash
// there, never a fabricated comparison.
import type { ReplayPickEntry } from "@/lib/limited/draftReplayEngine";

function cardName(
    pack: ReplayPickEntry["pack"],
    cardId: string | null
): string {
    if (cardId === null) return "—";
    return pack.find((c) => c.cardId === cardId)?.cardName ?? cardId;
}

export default function DraftLabReplayPickRow({
    entry,
    seatLabel,
    pastDivergence,
}: {
    entry: ReplayPickEntry;
    seatLabel: string;
    /** True once this pick's index is at or past
     *  `ReplayResult.firstDivergedPickIndex` — see
     *  `DraftLabReplayDivergenceBanner` for what that means. Styling only;
     *  the row is always rendered regardless. */
    pastDivergence: boolean;
}) {
    return (
        <li
            className={`grid grid-cols-[2.5rem_5rem_1fr_1fr] items-baseline gap-2 rounded-sm px-1.5 py-1 text-[11px] ${
                entry.diverged
                    ? "bg-signal-opponent/10"
                    : "bg-surface-elevated/30"
            } ${pastDivergence ? "opacity-70" : ""}`}
        >
            <span className="text-text-disabled">#{entry.pickIndex}</span>
            <span className="truncate text-text-muted">{seatLabel}</span>
            <span className="truncate text-text">
                {cardName(entry.pack, entry.historicalCardId)}
            </span>
            <span
                className={`truncate ${
                    entry.diverged ? "text-signal-opponent" : "text-text-muted"
                }`}
            >
                {cardName(entry.pack, entry.recomputedCardId)}
                {entry.diverged && " ← moved"}
            </span>
        </li>
    );
}
