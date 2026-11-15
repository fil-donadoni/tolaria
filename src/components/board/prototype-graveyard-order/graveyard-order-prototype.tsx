// PROTOTYPE — throwaway (branch prototype/graveyard-order-overlap). Question:
// now that graveyard ORDER matters (CR 404.3, PR #9585), how should the
// graveyard browse dialog show what is on top, and how should a type filter
// show the positions of the cards it hides?
//
// Three variants on the REAL graveyard dialog (`CardsPile` grid, plain
// browse and choices alike), switchable by `?variant=0|A|B|C` and the
// DEV-only floating bar (← → keys):
//   0  current grid (baseline)
//   A  Rows    — wrapping rows, 30% overlap, one placeholder per hidden card
//   B  Fan     — single row, top on the right, hidden cards as tight outlines
//   C  Cascade — solitaire columns, name bars peek, hidden runs as strips
import type { ReactNode } from "react";
import type { CardInstance } from "~/types/game";
import { buildSlots } from "./proto-model";
import PrototypeSwitcher from "./prototype-switcher";
import { GRAVEYARD_PROTO_VARIANTS } from "./proto-variant";
import VariantARows from "./variant-a-rows";
import VariantBFan from "./variant-b-fan";
import VariantCCascade from "./variant-c-cascade";

export default function GraveyardOrderPrototype({
    variant,
    cards,
    isShown,
    renderCard,
}: {
    variant: "A" | "B" | "C";
    /** Engine order, bottom→top (last = top). */
    cards: CardInstance[];
    isShown: (c: CardInstance) => boolean;
    renderCard: (c: CardInstance) => ReactNode;
}) {
    const slots = buildSlots(cards, isShown, variant === "C");
    if (variant === "A")
        return <VariantARows slots={slots} renderCard={renderCard} />;
    if (variant === "B")
        return <VariantBFan slots={slots} renderCard={renderCard} />;
    return <VariantCCascade slots={slots} renderCard={renderCard} />;
}

export function GraveyardProtoBar({
    variant,
    onChange,
}: {
    variant: string;
    onChange: (k: string) => void;
}) {
    return (
        <PrototypeSwitcher
            variants={GRAVEYARD_PROTO_VARIANTS}
            current={variant}
            onChange={onChange}
        />
    );
}
