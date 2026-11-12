// PROTOTYPE (zone-target highlight) — D "Zone peek": the arrow lands on the
// pile, and the pile opens a compact peek of the WHOLE zone in order, the
// targeted cards ringed and numbered, everything else dimmed — context
// ("which of three identical cards, the 3rd of 14?") at the cost of more
// surface. One panel per zone, merging every stack item that targets into it.
import ProtoArrowLayer, { type ProtoPath } from "./proto-arrow-layer";
import ProtoThumb from "./proto-thumb";
import { zoneClusters } from "./use-zone-target-model";
import { curve, inward, zoneWord, type VariantProps } from "./variant-props";

export const VARIANT_D_NAME = "Zone peek";
const W = 40;

export default function VariantDPeek({
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
    const nodes = zoneClusters(groups, anchors).map((z) => {
        const dir = inward(z.at);
        const targeted = new Map(z.targets.map((t, i) => [t.card.id, i + 1]));
        const cols = Math.min(8, z.zoneCards.length);
        const panelW = Math.max(240, cols * (W + 4) + 16);
        const left = z.at.x + (dir.x < 0 ? -panelW - 24 : 24);
        const top = z.at.y + (dir.y < 0 ? -190 : 10);
        return (
            <div
                key={z.zoneKey}
                className="pointer-events-auto fixed z-[915] rounded-lg border border-accent-strong/60 bg-surface/95 p-2 text-xs text-text shadow-2xl backdrop-blur"
                style={{ left, top, width: panelW }}
            >
                <div className="mb-1.5 flex justify-between gap-2">
                    <span className="font-semibold text-accent-strong">
                        Targeted in {z.ownerLabel} {zoneWord(z.zone)}
                    </span>
                    <span className="text-text-muted">
                        {z.targets.length} of {z.zoneCards.length}
                    </span>
                </div>
                <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${cols}, ${W}px)` }}
                >
                    {z.zoneCards.map((card) => {
                        const n = targeted.get(card.id);
                        return (
                            <ProtoThumb
                                key={card.id}
                                card={card}
                                width={W}
                                targeted={!!n}
                                dim={!n}
                                badge={n ? String(n) : undefined}
                            />
                        );
                    })}
                </div>
                <ol className="mt-1.5 space-y-0.5 text-[11px] text-text-muted">
                    {z.targets.map((t, i) => (
                        <li key={t.card.id}>
                            <span className="font-bold text-accent-strong">
                                {i + 1}
                            </span>{" "}
                            ← {t.sources.join(", ")}
                        </li>
                    ))}
                </ol>
            </div>
        );
    });
    return (
        <>
            <ProtoArrowLayer paths={paths} />
            {nodes}
        </>
    );
}
