// Non-interactive mock of the library, sitting in the MIDDLE of the fan. A
// compact right-leaning stack of card-backs (rightmost on top) that joins
// seamlessly into the movable cards on either side (Arena parity). Which SIDE of
// it a card lands on decides top vs bottom/graveyard.
import {
    CARD_W as CARD_W_NATURAL,
    CARD_H as CARD_H_NATURAL,
    DECK_BACKS,
    DECK_STEP,
} from "./constants";

/** Full footprint of the deck mock at the given card size — the picker's
 *  layout places the library block and the fans on either side relative to
 *  it. `cardW`/`cardH` default to the natural desktop size; the picker passes
 *  its live (responsive, issue #1765) tile size so the mock always matches
 *  the fan cards beside it. */
export default function DeckMock({
    cardW = CARD_W_NATURAL,
    cardH = CARD_H_NATURAL,
}: {
    cardW?: number;
    cardH?: number;
}) {
    return (
        <div
            className="relative"
            style={{
                width: cardW + DECK_STEP * (DECK_BACKS - 1),
                height: cardH,
            }}
            aria-hidden
        >
            {Array.from({ length: DECK_BACKS }, (_, i) => (
                <img
                    key={i}
                    src="/img/card-back.webp"
                    alt=""
                    draggable={false}
                    className="absolute card-corner border border-border object-cover shadow-md"
                    style={{
                        width: cardW,
                        height: cardH,
                        left: i * DECK_STEP,
                        zIndex: i,
                    }}
                />
            ))}
        </div>
    );
}
