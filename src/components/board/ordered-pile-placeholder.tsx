/** A filtered-out card's slot in the ordered pile fan (issue #9874): a
 *  card-shaped outline with a thin edge and no visible fill. The fill IS the
 *  dialog surface, so it still occludes the item under it the way a card
 *  would — a transparent one let the card below show through and the next
 *  card cover the whole run. */
export default function OrderedPilePlaceholder({
    position,
    marginLeft,
}: {
    /** 1 = top of the pile. */
    position: number;
    marginLeft: string;
}) {
    return (
        // `aria-hidden`: a type-filtered graveyard can hold dozens of these;
        // the fan announces them once, as a count (`FanLayout`).
        <div
            aria-hidden
            data-ordered-pile-placeholder={position}
            className="relative aspect-5/7 w-(--pile-card-w) shrink-0 self-start card-corner border border-placeholder-edge bg-surface"
            style={{ marginLeft }}
        />
    );
}
