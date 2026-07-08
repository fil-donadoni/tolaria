// Non-interactive mock of the library, sitting in the MIDDLE of the fan. A
// compact right-leaning stack of card-backs (rightmost on top) that joins
// seamlessly into the movable cards on either side (Arena parity). Which SIDE of
// it a card lands on decides top vs bottom/graveyard.
import { CARD_W, CARD_H } from "./constants";

const BACKS = 4;
const STEP = 16; // px each back peeks to the right

/** Full footprint of the deck mock — the picker's layout places the library
 *  block and the fans on either side relative to it. */
export const DECK_W = CARD_W + STEP * (BACKS - 1);
export const DECK_H = CARD_H;

export default function DeckMock() {
    return (
        <div
            className="relative"
            style={{ width: DECK_W, height: DECK_H }}
            aria-hidden
        >
            {Array.from({ length: BACKS }, (_, i) => (
                <img
                    key={i}
                    src="/img/card-back.webp"
                    alt=""
                    draggable={false}
                    className="absolute rounded-[7%] border border-border object-cover shadow-md"
                    style={{
                        width: CARD_W,
                        height: CARD_H,
                        left: i * STEP,
                        zIndex: i,
                    }}
                />
            ))}
        </div>
    );
}
