import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import ActionButton from "~/components/board/action-button";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

/** The Booster currently in front of the viewer (PRD #1107 stories 10-11,
 *  issue #1112): one Pick button per card. Sorted by name only for display —
 *  `pickId` (not array position) is what `onPick` sends, so re-sorting never
 *  changes which physical card gets picked. */
export default function LimitedDraftPack({
    pack,
    onPick,
    pending,
}: {
    pack: DraftPackCard[];
    onPick: (pickId: string) => void;
    pending: boolean;
}) {
    if (pack.length === 0) {
        return (
            <p className="text-sm text-text-muted">
                Waiting for the next pack…
            </p>
        );
    }

    const sorted = [...pack].sort((a, b) =>
        a.cardName.localeCompare(b.cardName)
    );

    return (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sorted.map((card) => (
                <li key={card.pickId}>
                    <ActionButton
                        onClick={() => onPick(card.pickId)}
                        label={card.cardName}
                        tone="secondary"
                        disabled={pending}
                    />
                </li>
            ))}
        </ul>
    );
}
