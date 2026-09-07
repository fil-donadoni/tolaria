import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import CardImage from "~/components/cards/card-image";

/** A Draft seat's PICK ORDER, as card faces in the sequence they were taken
 *  (issue #3167). The seat's `pool` array order IS the pick order — `applyPick`
 *  appends one entry per Pick and never reorders — so the ordinal is the index,
 *  and nothing new is needed on the wire.
 *
 *  Deliberately NOT a `DeckZoneSurface` mount, unlike the deck and Pool blocks
 *  beside it: this is the one block whose arrangement is a SEQUENCE, not a set
 *  of Columns. The Column Layout engine buckets and re-sorts by construction
 *  (`generateColumns` + the Ordering ladder), which is exactly what a pick
 *  order must not do — Grouping `none` would collapse 45 picks into one pile
 *  in `name` order and lose the only thing this block exists to show. It stays
 *  an `<ol>` for the same reason: the order carries the meaning, so it is
 *  semantic, not presentational.
 *
 *  Read-only like every other block of the disclosure: the faces carry no
 *  gesture at all, so there is no tile, no drag identity and no click. */
export default function LimitedReviewPickOrder({
    pool,
}: {
    pool: LimitedPoolCard[];
}) {
    return (
        <ol className="mt-1 flex list-none flex-wrap gap-2 p-0">
            {pool.map((card, i) => (
                <li
                    key={`${card.scryfallId}-${i}`}
                    className="relative aspect-5/7 w-(--card-w) shrink-0"
                    title={`Pick ${i + 1} — ${card.cardName}`}
                >
                    {/* `lazy` + no compositor promotion: a completed 8-seat
                        table mounts hundreds of these at once, most of them
                        inside a collapsed disclosure (see `CONTAINED_LAYER` in
                        `card-image.tsx`). */}
                    <CardImage
                        card={{ id: card.cardId }}
                        lazy
                        promoteLayer={false}
                    />
                    {/* The 1-based pick number, over the face it labels. A
                        LABEL, not a control — `pointer-events-none`, no role,
                        no tab stop (the same treatment `DeckCardTile` gives
                        its `xN` badge). */}
                    <span
                        data-pick-number
                        className="pointer-events-none absolute top-0.5 left-0.5 rounded-sm border border-border-accent/70 bg-surface-base/90 px-1 text-[0.625rem] leading-4 font-semibold text-parchment"
                    >
                        {i + 1}
                    </span>
                </li>
            ))}
        </ol>
    );
}
