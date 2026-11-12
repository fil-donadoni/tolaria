// PROTOTYPE (zone-target highlight) — B2 "Targets in the stack row" (round
// 2): the targets live INSIDE the stack item's block (ProtoStackRowTargets,
// rendered by the real StackRow); this overlay only draws one arrow per
// target line, from that line to the zone pile. Nothing floats over the
// board. Hover a row / line / pile: the rest dims.
import ProtoArrowLayer, { type ProtoPath } from "./proto-arrow-layer";
import { curve, isDim, isLit, type VariantProps } from "./variant-props";

export const VARIANT_B2_NAME = "Targets inside the stack row";

export default function VariantB2Row({
    groups,
    anchors,
    extra,
    focus,
}: VariantProps) {
    const paths: ProtoPath[] = [];
    for (const g of groups) {
        const a = anchors[g.key];
        if (!a?.zone || !g.sourceStackId) continue;
        for (const card of g.cards) {
            const r = extra[`b2:${g.sourceStackId}:${card.id}`];
            // Fallback (row not rendered / sim mode): from the arrow source.
            const from = r ? { x: r.x, y: r.y + r.h / 2 } : a.source;
            paths.push({
                key: `${g.key}:${card.id}`,
                d: curve(from, a.zone, -0.22),
                dim: isDim(focus, [g.key]),
                emphasized: isLit(focus, [g.key]),
            });
        }
    }
    return <ProtoArrowLayer paths={paths} />;
}
