// PROTOTYPE — throwaway (prototype/graveyard-order-overlap). Slot model for
// the ordered graveyard browse: the engine array is bottom→top (last = top,
// CR 404.3, `fullText.ts` reads `graveyard[length - 1]`). A filter hides
// cards but keeps their POSITIONS as placeholders, so the visible cards
// still read in their true depth.
import type { CardInstance } from "~/types/game";

export type ProtoSlot =
    | { kind: "card"; key: string; card: CardInstance; pos: number }
    | { kind: "hidden"; key: string; count: number; from: number; to: number };

/** `pos` 1 = top of the graveyard. Returned bottom→top (paint order: the top
 *  card is painted last, so it sits on top of every overlap). `collapse`
 *  folds a run of consecutive hidden cards into ONE placeholder. */
export function buildSlots(
    cards: CardInstance[],
    isShown: (c: CardInstance) => boolean,
    collapse: boolean
): ProtoSlot[] {
    const n = cards.length;
    const out: ProtoSlot[] = [];
    cards.forEach((card, i) => {
        const pos = n - i;
        if (isShown(card)) {
            out.push({ kind: "card", key: card.id, card, pos });
            return;
        }
        const last = out[out.length - 1];
        if (collapse && last?.kind === "hidden") {
            last.count += 1;
            last.to = pos;
            return;
        }
        out.push({
            kind: "hidden",
            key: `hidden-${card.id}`,
            count: 1,
            from: pos,
            to: pos,
        });
    });
    return out;
}

export function hiddenLabel(s: Extract<ProtoSlot, { kind: "hidden" }>) {
    return s.count === 1 ? `#${s.from}` : `#${s.from}–${s.to}`;
}

/** Same breakpoints as `PILE_GRID_TILE_W` (68px / w-24 / sm:w-28), exposed as
 *  a CSS var so overlaps can be a fraction of the tile width. */
export const TILE_VAR_CLASS =
    "[--tile:68px] min-[420px]:[--tile:6rem] sm:[--tile:7rem]";

export const PLACEHOLDER_CLASS =
    "card-corner border border-dashed border-border-strong bg-surface-elevated text-text-muted";
