import type { CardInstance } from "~/types/game";

/** CR 702.62b (issue #10495) — the plate a SUSPENDED exiled card wears in the
 *  Exile pile: the card is face up and public, so both players read it, with
 *  its clock (the time counters left). Non-interactive: suspend's later play is
 *  offered by its own trigger, never by a button on the card. Renders nothing
 *  for a card the projection does not mark `suspended`. */
export default function SuspendedBadge({ card }: { card: CardInstance }) {
    if (card.suspended !== true) return null;
    const time = card.counters?.time ?? 0;
    return (
        <span
            data-suspended-badge=""
            className="pointer-events-none absolute inset-x-1 bottom-1 z-30 rounded bg-surface-elevated/90 px-2 py-1 text-center text-xs font-bold text-text shadow"
        >
            Suspended · {time} time
        </span>
    );
}
