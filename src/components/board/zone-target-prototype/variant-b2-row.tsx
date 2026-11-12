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
            // Expanded: from the target's own line; collapsed: from the
            // block's "Targets · N" header.
            const r =
                extra[`b2:${g.sourceStackId}:${card.id}`] ??
                extra[`b2h:${g.sourceStackId}`];
            // Row scrolled out of the stack panel: no line, no arrow (the
            // real layer draws nothing without an anchor either).
            if (!r) continue;
            const from = { x: r.x, y: r.y + r.h / 2 };
            paths.push({
                key: `${g.key}:${card.id}`,
                geo: curve(from, a.zone, -0.22),
                groups: [g.key],
                dim: isDim(focus, [g.key]),
                emphasized: isLit(focus, [g.key]),
            });
        }
    }
    return <ProtoArrowLayer paths={paths} />;
}
