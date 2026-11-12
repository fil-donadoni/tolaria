// PROTOTYPE (zone-target highlight) — A "Fan at the tip": the arrow still
// lands on the pile; the targeted cards fan out of the pile toward the board,
// small, tethered to it. Pile carries a ◎N badge.
import ProtoArrowLayer, { type ProtoPath } from "./proto-arrow-layer";
import ProtoCountBadge from "./proto-count-badge";
import ProtoThumb from "./proto-thumb";
import { curve, inward, type VariantProps } from "./variant-props";

export const VARIANT_A_NAME = "Fan at the tip";
const W = 62;

export default function VariantAFan({
    groups,
    anchors,
    drawBase,
}: VariantProps) {
    const paths: ProtoPath[] = [];
    const nodes = groups.flatMap((g) => {
        const a = anchors[g.key];
        if (!a?.zone) return [];
        if (drawBase)
            paths.push({ key: `${g.key}:base`, d: curve(a.source, a.zone) });
        const dir = inward(a.zone);
        const c = { x: a.zone.x + dir.x * 110, y: a.zone.y + dir.y * 110 };
        paths.push({
            key: `${g.key}:tether`,
            d: `M ${a.zone.x} ${a.zone.y} L ${c.x} ${c.y}`,
            dashed: true,
            thin: true,
        });
        const n = g.cards.length;
        return [
            <ProtoCountBadge key={`${g.key}:b`} at={a.zone} n={n} />,
            <div
                key={g.key}
                className="pointer-events-none fixed z-[910] flex -translate-x-1/2 -translate-y-1/2 items-end"
                style={{ left: c.x, top: c.y }}
            >
                {g.cards.map((card, i) => (
                    <div
                        key={card.id}
                        style={{ marginLeft: i === 0 ? 0 : -W * 0.35 }}
                    >
                        <ProtoThumb
                            card={card}
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
