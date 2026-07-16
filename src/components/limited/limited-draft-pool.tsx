import { useCallback, useMemo } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import {
    findMovablePoolIndex,
    resolvePoolPlacements,
    splitPoolByArrangement,
} from "@convex/limited/poolArrangement";
import { useLimitedEventMutations } from "~/hooks/useLimitedEvent";
import PoolDeckbuilderSurface from "~/components/deckbuilder/pool-deckbuilder-surface";

/**
 * The draft-time Pool (ADR 0060, issue #1247): the same deckbuilder surface
 * the post-draft build view uses (`PoolDeckbuilderSurface`, issue #1244) —
 * card images, fixed Mana-Value columns, a Sideboard column, dnd — instead
 * of the old flat `name ×count` text list (`LimitedPoolView`). "The
 * draft-time Pool IS the working deck": every card defaults into the
 * Maindeck the instant it's picked (no separate "everything starts in the
 * Sideboard" phase, unlike the pre-ADR-0060 Sealed convention), and moving a
 * card persists server-side on the seat's Pool Arrangement so it "carries
 * unchanged into deckbuild" once the draft finishes
 * (`pool-deck-builder-form.tsx` seeds its working deck from the SAME
 * `splitPoolByArrangement`).
 */
export default function LimitedDraftPool({
    eventId,
    pool,
    arrangement,
}: {
    eventId: Id<"limitedEvents">;
    pool: LimitedPoolCard[];
    arrangement: PoolArrangementEntry[] | null;
}) {
    const { setPoolArrangementEntry } = useLimitedEventMutations();

    const placements = useMemo(
        () => resolvePoolPlacements(pool, arrangement ?? undefined),
        [pool, arrangement]
    );
    const { cards: mainCards, sideboard: sideCards } = useMemo(
        () => splitPoolByArrangement(pool, arrangement ?? undefined),
        [pool, arrangement]
    );

    const move = useCallback(
        (cardId: string, toSideboard: boolean) => {
            const poolIndex = findMovablePoolIndex(
                placements,
                cardId,
                !toSideboard
            );
            if (poolIndex === null) return;
            void setPoolArrangementEntry({
                eventId,
                poolIndex,
                sideboard: toSideboard,
            });
        },
        [placements, setPoolArrangementEntry, eventId]
    );

    if (pool.length === 0) {
        return (
            <p className="text-sm text-text-muted">
                No Pool has been generated for your seat yet.
            </p>
        );
    }

    return (
        <PoolDeckbuilderSurface
            mainCards={mainCards}
            sideCards={sideCards}
            onMoveToSideboard={(cardId) => move(cardId, true)}
            onMoveToMaindeck={(cardId) => move(cardId, false)}
            mainTitle="Pool"
            sideTitle="Sideboard"
            mainEmptyMessage="Cards you pick will appear here, grouped by Mana Value."
            sideEmptyMessage="Move a card here to park it out of your working deck."
        />
    );
}
