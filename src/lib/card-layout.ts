/** Computes fan-style rotation and offset for a card at a given index in a hand. */
export function getFanStyle(
    cardIndex: number,
    totalCards: number,
    isOpponent = false
) {
    const centerIndex = (totalCards - 1) / 2;
    const distanceFromCenter = cardIndex - centerIndex;

    // Cap total angular spread so large piles don't over-rotate.
    const maxTotalSpreadDeg = isOpponent ? 36 : 50;
    const basePerCardDeg = isOpponent ? 3 : 5;
    const degPerCard =
        totalCards > 1
            ? Math.min(basePerCardDeg, maxTotalSpreadDeg / (totalCards - 1))
            : basePerCardDeg;
    const rotation = distanceFromCenter * degPerCard;

    // Cards lie on a circular arc whose virtual pivot is below them.
    // Bigger pivotDistancePx = gentler arc. In items-end layout,
    // marginBottom pushes content UP, so we give the center the
    // largest marginBottom and edges 0, producing a natural dome
    // (center highest, edges lowest) like a hand-held fan.
    const pivotDistancePx = isOpponent ? 360 : 480;
    const rad = (rotation * Math.PI) / 180;
    const arcDropPx = pivotDistancePx * (1 - Math.cos(rad));
    const maxAngleRad = (centerIndex * degPerCard * Math.PI) / 180;
    const maxArcDropPx = pivotDistancePx * (1 - Math.cos(maxAngleRad));
    const marginBottomPx = maxArcDropPx - arcDropPx;

    // Overlap ~50% of card width — cards sit closer together.
    const overlapVar = isOpponent
        ? "calc(var(--card-w-sm) * -0.5)"
        : "calc(var(--card-w) * -0.5)";

    return {
        transform: `rotate(${rotation}deg)`,
        marginLeft: cardIndex === 0 ? "0" : overlapVar,
        marginBottom: `${marginBottomPx}px`,
        transformOrigin: "bottom center",
    };
}

/** ClassName for cards in the player's fan layout. */
export const fanCardClassName =
    "w-(--card-w) aspect-5/7 shrink-0 mb-2 transition-[translate,transform,margin] hover:-translate-y-4 hover:z-10";

/** ClassName for cards in the opponent's fan layout. */
export const fanCardOpponentClassName =
    "w-[var(--card-w-sm)] aspect-5/7 shrink-0 mb-2 transition-[translate,transform,margin] hover:-translate-y-4 hover:z-10";
