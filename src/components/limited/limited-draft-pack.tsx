import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import LimitedDraftPackCard from "./limited-draft-pack-card";

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
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {sorted.map((card) => (
                <li key={card.pickId}>
                    <LimitedDraftPackCard
                        card={card}
                        onPick={onPick}
                        pending={pending}
                    />
                </li>
            ))}
        </ul>
    );
}
