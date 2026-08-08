import type { CardInstance } from "~/types/game";

/**
 * The pinned free-text note a Manual Game player can attach to a card
 * (`manualSetNote`) — manual-mode QA round 3, item 6.
 *
 * The verb and the server field both shipped with the mode; nothing ever
 * RENDERED the result, so a note was write-only: set it, and the card looked
 * exactly as before. This badge is the read side.
 *
 * `note` is a manual-only field. It rides along on the projected manual card
 * (`manual-board-adapter.ts` — "nothing here strips them"), but the board's
 * own `CardInstance` type does not name it, so it is read through a narrow
 * structural cast rather than by widening the GRE type with a field the GRE
 * never writes. On every GRE board the field is absent and this renders
 * nothing at all.
 *
 * Placed top-centre: the four corners are taken (counters top-left, summoning
 * sickness / loyalty and the P/T stack bottom-right), and a note is the one
 * overlay whose whole purpose is to be read at a glance.
 */
export default function ManualNoteBadge({ card }: { card: CardInstance }) {
    const note = (card as { note?: string }).note;
    if (!note) return null;
    return (
        <div className="absolute inset-x-1 top-1 z-20 flex justify-center pointer-events-none">
            <span
                // The full text on hover, because the badge itself truncates:
                // a note is free text and can be a sentence, but the card is
                // ~120px wide.
                title={note}
                data-manual-note
                className="max-w-full truncate rounded-xs bg-black/80 px-1 py-0.5 text-[9px] font-medium leading-none text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
            >
                {note}
            </span>
        </div>
    );
}
