// PROTOTYPE (zone-target highlight) — A "Fan at the tip": the arrow still
// lands on the pile; the targeted cards (from EVERY stack item pointing into
// that zone) fan out of the pile toward the board, small, tethered to it.
// Pile carries a ◎N badge.
import ProtoArrowLayer, { type ProtoPath } from "./proto-arrow-layer";
import ProtoCountBadge from "./proto-count-badge";
import ProtoThumb from "./proto-thumb";
import { zoneClusters } from "./use-zone-target-model";
import { curve, inward, type VariantProps } from "./variant-props";

export const VARIANT_A_NAME = "Fan at the tip";
const W = 62;
const DIST = 230;

export default function VariantAFan({
    groups,
    anchors,
    drawBase,
}: VariantProps) {
    const paths: ProtoPath[] = [];
    if (drawBase)
        for (const g of groups) {
            const a = anchors[g.key];
            if (a?.zone)
                paths.push({
                    key: `${g.key}:base`,
                    d: curve(a.source, a.zone),
                });
        }
    const nodes = zoneClusters(groups, anchors).flatMap((z) => {
        const dir = inward(z.at);
        const c = { x: z.at.x + dir.x * DIST, y: z.at.y + dir.y * DIST };
        paths.push({
            key: `${z.zoneKey}:tether`,
            d: `M ${z.at.x} ${z.at.y} L ${c.x} ${c.y}`,
            dashed: true,
            thin: true,
        });
        const n = z.targets.length;
        return [
            <ProtoCountBadge key={`${z.zoneKey}:b`} at={z.at} n={n} />,
            <div
                key={z.zoneKey}
                className="pointer-events-none fixed z-[910] flex -translate-x-1/2 -translate-y-1/2 items-end"
                style={{ left: c.x, top: c.y }}
            >
                {z.targets.map((t, i) => (
                    <div
                        key={t.card.id}
                        title={`targeted by ${t.sources.join(", ")}`}
                        style={{ marginLeft: i === 0 ? 0 : -W * 0.35 }}
                    >
                        <ProtoThumb
                            card={t.card}
                            width={W}
                            targeted
                            rotate={(i - (n - 1) / 2) * 9}
                        />
                    </div>
                ))}
            </div>,
        ];
    });
    return (
        <>
            <ProtoArrowLayer paths={paths} />
            {nodes}
        </>
    );
}
