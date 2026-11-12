// PROTOTYPE (zone-target highlight) — D "Zone peek": the arrow lands on the
// pile, and the pile opens a compact peek of the WHOLE zone in order, the
// targeted cards ringed and numbered, everything else dimmed — context
// ("which Llanowar Elves, the 3rd of 14?") at the cost of more surface.
import ProtoArrowLayer, { type ProtoPath } from "./proto-arrow-layer";
import ProtoThumb from "./proto-thumb";
import { curve, inward, zoneWord, type VariantProps } from "./variant-props";

export const VARIANT_D_NAME = "Zone peek";
const W = 40;

export default function VariantDPeek({
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
        const targeted = new Map(g.cards.map((c, i) => [c.id, i + 1]));
        const cols = Math.min(8, g.zoneCards.length);
        const panelW = Math.max(240, cols * (W + 4) + 16);
        const left = a.zone.x + (dir.x < 0 ? -panelW - 24 : 24);
        const top = a.zone.y + (dir.y < 0 ? -150 : 10);
        return [
            <div
                key={g.key}
                className="pointer-events-auto fixed z-[915] rounded-lg border border-accent-strong/60 bg-surface/95 p-2 text-xs text-text shadow-2xl backdrop-blur"
                style={{ left, top, width: panelW }}
            >
                <div className="mb-1.5 flex justify-between gap-2">
                    <span className="font-semibold text-accent-strong">
                        {g.sourceLabel} → {g.ownerLabel} {zoneWord(g.zone)}
                    </span>
                    <span className="text-text-muted">
                        {g.cards.length} of {g.zoneCards.length}
                    </span>
                </div>
                <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${cols}, ${W}px)` }}
                >
                    {g.zoneCards.map((card) => {
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
