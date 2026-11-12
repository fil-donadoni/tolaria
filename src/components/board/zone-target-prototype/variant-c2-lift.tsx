// PROTOTYPE (zone-target highlight) — C2 "Lifted out" (round 2): the targeted
// cards are drawn lifted out of their pile, one horizontal row per zone, and
// each arrow lands on ITS card — exactly like a permanent target. A dashed
// tether card → pile says where it lives. Reticle marker (information, not
// an affordance). Hover any part of a relationship: the rest dims.
import ProtoArrowLayer, { type ProtoPath } from "./proto-arrow-layer";
import ProtoThumb from "./proto-thumb";
import {
    curve,
    inward,
    isDim,
    isLit,
    zoneClusters,
    zoneWord,
    type VariantProps,
} from "./variant-props";

export const VARIANT_C2_NAME = "Lifted out, arrow per card";
const W = 86;
const GAP = 16;
const DIST = 420;

export default function VariantC2Lift({
    groups,
    anchors,
    extra,
    focus,
}: VariantProps) {
    const paths: ProtoPath[] = [];
    const nodes = zoneClusters(groups, anchors).flatMap((z) => {
        const dir = inward(z.at);
        const c = { x: z.at.x + dir.x * DIST, y: z.at.y + dir.y * DIST };
        const n = z.targets.length;
        // Keep the row off the stack panel.
        const stack = extra["@stack"];
        const rowHalf = (n * (W + GAP)) / 2;
        const H = W * 1.395;
        if (
            stack &&
            c.y - H / 2 < stack.y + stack.h &&
            c.y + H / 2 > stack.y &&
            c.x + rowHalf > stack.x
        )
            c.x = stack.x - rowHalf - 16;
        return z.targets.map((t, i) => {
            const p = { x: c.x + (i - (n - 1) / 2) * (W + GAP), y: c.y };
            const top = { x: p.x, y: p.y - (W * 1.395) / 2 - 6 };
            const dim = isDim(focus, t.groupKeys);
            for (const gk of t.groupKeys) {
                const a = anchors[gk];
                // Source not visible (stack row scrolled out): no arrow.
                if (!a.sourceRect) continue;
                const lit = isLit(focus, [gk]);
                paths.push({
                    key: `${gk}:${t.card.id}`,
                    geo: curve(a.source, top),
                    groups: [gk],
                    dim: isDim(focus, [gk]),
                    emphasized: lit,
                });
            }
            paths.push({
                key: `${t.card.id}:tether`,
                d: `M ${p.x} ${p.y} L ${z.at.x} ${z.at.y}`,
                dashed: true,
                thin: true,
                dim,
            });
            return (
                <div
                    key={t.card.id}
                    className="pointer-events-none fixed z-[79] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
                    style={{ left: p.x, top: p.y }}
                >
                    <ProtoThumb
                        card={t.card}
                        width={W}
                        marked
                        dim={dim}
                        group={t.groupKeys.join(" ")}
                    />
                    <span
                        className="rounded bg-black/75 px-1.5 text-[10px] text-white/85 transition-opacity"
                        style={{ opacity: dim ? 0.2 : 1 }}
                    >
                        {z.ownerLabel} {zoneWord(z.zone)}
                    </span>
                </div>
            );
        });
    });
    return (
        <>
            <ProtoArrowLayer paths={paths} />
            {nodes}
        </>
    );
}
