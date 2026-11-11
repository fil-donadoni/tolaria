/**
 * Where the hover-enlarged copy of a pack card goes (issue #9166): centred on
 * the tile it enlarges, sized so the oracle text reads, clamped inside the
 * viewport. Pure so the clamp is testable without layout.
 */
export const ENLARGED_MIN_W = 320;
export const ENLARGED_MAX_W = 440;
const MARGIN = 8;
const GROWTH = 1.8;
const CARD_HEIGHT_PER_WIDTH = 7 / 5;

export interface EnlargedPlacement {
    left: number;
    top: number;
    width: number;
}

export function enlargedPlacement(
    tile: { left: number; top: number; width: number; height: number },
    viewport: { width: number; height: number }
): EnlargedPlacement {
    const width = Math.min(
        ENLARGED_MAX_W,
        Math.max(ENLARGED_MIN_W, tile.width * GROWTH),
        (viewport.height - 2 * MARGIN) / CARD_HEIGHT_PER_WIDTH,
        viewport.width - 2 * MARGIN
    );
    const height = width * CARD_HEIGHT_PER_WIDTH;
    const clamp = (v: number, size: number, max: number) =>
        Math.min(Math.max(MARGIN, v), max - size - MARGIN);
    return {
        width,
        left: clamp(
            tile.left + tile.width / 2 - width / 2,
            width,
            viewport.width
        ),
        top: clamp(
            tile.top + tile.height / 2 - height / 2,
            height,
            viewport.height
        ),
    };
}
