/** Computes fan-style rotation and offset for a card at a given index in a hand. */
export function getFanStyle(
    cardIndex: number,
    totalCards: number,
    isOpponent = false
) {
    const centerIndex = (totalCards - 1) / 2;
    const distanceFromCenter = cardIndex - centerIndex;

    const rotation = distanceFromCenter * 4;
    const marginTop = Math.abs(distanceFromCenter) * (isOpponent ? 4 : 8);
    // Overlap ~37.5% of card width (matches old -3rem for 8rem card).
    const overlapVar = isOpponent
        ? "calc(var(--card-w-sm) * -0.375)"
        : "calc(var(--card-w) * -0.375)";

    return {
        transform: `rotate(${rotation}deg)`,
        marginLeft: cardIndex === 0 ? "0" : overlapVar,
        marginTop: `${marginTop}px`,
        transformOrigin: "bottom center",
    };
}

/** ClassName for cards in the player's fan layout. */
export const fanCardClassName =
    "w-[var(--card-w)] aspect-5/7 shrink-0 mb-2 transition-all hover:-translate-y-4 hover:z-10";

/** ClassName for cards in the opponent's fan layout. */
export const fanCardOpponentClassName =
    "w-[var(--card-w-sm)] aspect-5/7 shrink-0 mb-2 transition-all hover:-translate-y-4 hover:z-10";

const CARD_WIDTH_PX = 128; // w-32 fallback for dialog sizing
const OVERLAP_PX = 48; // 3rem

const ROTATION_MARGIN_PX = 32; // extra space for rotated edge cards

/** Estimates the pixel width of a fan of cards (used for dialog sizing). */
export function getFanWidth(totalCards: number): number {
    if (totalCards <= 0) return 0;
    return (
        CARD_WIDTH_PX +
        (totalCards - 1) * (CARD_WIDTH_PX - OVERLAP_PX) +
        ROTATION_MARGIN_PX * 2
    );
}
