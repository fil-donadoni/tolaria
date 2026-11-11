// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-autopick`). Never merge.
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";

export type PrototypeAutopickCard = NonNullable<
    LimitedEventSeatView["currentPack"]
>[number];

export interface PrototypeAutopickProps {
    /** What the clock will take; `null` = the Bot chooses (no default yet). */
    target: PrototypeAutopickCard | null;
    /** The target is the player's own Selected Card, not the suggestion. */
    isSelection: boolean;
    /** Seconds left on the pick clock (these only mount in the last 5). */
    seconds: number;
}

/** CSS selector for one Booster tile (`limited-draft-pack-card.tsx`). */
export function prototypeTileSelector(pickId: string): string {
    return `[data-draft-pick-tile][data-pick-id="${CSS.escape(pickId)}"]`;
}
