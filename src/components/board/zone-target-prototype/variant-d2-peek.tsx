// PROTOTYPE (zone-target highlight) — D2 "Zone peek" (round 2): one panel per
// targeted zone, anchored at its pile. The TARGETED cards come first, large,
// and each source's arrow lands on its card inside the panel (no numbered
// cross-references). The rest of the zone follows, small and dimmed, for
// context ("which of three identical cards?"). Hover: the rest dims.
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

export const VARIANT_D2_NAME = "Zone peek, targets first";
const WT = 58;
const WR = 30;

export default function VariantD2Peek({
    groups,
    anchors,
    extra,
    focus,
}: VariantProps) {
    const paths: ProtoPath[] = [];
    const nodes = zoneClusters(groups, anchors).map((z) => {
        const dir = inward(z.at);
        const targetedIds = new Set(z.targets.map((t) => t.card.id));
        const rest = z.zoneCards.filter((c) => !targetedIds.has(c.id));
        const allKeys = z.targets.flatMap((t) => t.groupKeys);
        const panelDim = isDim(focus, allKeys);
        for (const t of z.targets) {
            const r = extra[`d2:${z.zoneKey}:${t.card.id}`];
            if (!r) continue;
            const top = { x: r.x + r.w / 2, y: r.y - 8 };
            for (const gk of t.groupKeys)
                paths.push({
                    key: `${gk}:${t.card.id}`,
                    d: curve(anchors[gk].source, top),
                    dim: isDim(focus, [gk]),
                    emphasized: isLit(focus, [gk]),
                });
        }
        // Grow the panel INTO the board from the pile's corner.
        const pos: React.CSSProperties = {};
        // Never on top of the stack panel (round-2 walk: the top pile's peek
        // covered the stack rows it was explaining).
        const stack = extra["@stack"];
        const PANEL_H = 260;
        const yTop = dir.y < 0 ? z.at.y + 30 - PANEL_H : z.at.y - 30;
        const overlapsStackY =
            !!stack && yTop < stack.y + stack.h && yTop + PANEL_H > stack.y;
        const rightEdge =
            overlapsStackY && stack
                ? Math.min(z.at.x - 30, stack.x - 16)
                : z.at.x - 30;
        if (dir.x < 0) pos.right = window.innerWidth - rightEdge;
        else pos.left = z.at.x + 30;
        if (dir.y < 0) pos.bottom = window.innerHeight - z.at.y - 30;
        else pos.top = z.at.y - 30;
        return (
            <div
                key={z.zoneKey}
                data-proto-group={allKeys.join(" ")}
                className="pointer-events-auto fixed z-[915] w-[300px] rounded-lg border border-border-strong bg-surface/95 p-2.5 text-xs text-text shadow-2xl backdrop-blur transition-opacity"
                style={{ ...pos, opacity: panelDim ? 0.35 : 1 }}
            >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="font-semibold">
                        {z.ownerLabel} {zoneWord(z.zone)}
                    </span>
                    <span className="text-text-muted">
                        {z.targets.length} targeted · {z.zoneCards.length} cards
                    </span>
                </div>
                <div className="flex flex-wrap gap-3 pt-2">
                    {z.targets.map((t) => (
                        <ProtoThumb
                            key={t.card.id}
                            card={t.card}
                            width={WT}
                            marked
                            dim={isDim(focus, t.groupKeys)}
                            group={t.groupKeys.join(" ")}
                            measureId={`d2:${z.zoneKey}:${t.card.id}`}
                        />
                    ))}
                </div>
                {rest.length > 0 && (
                    <>
                        <div className="mt-2.5 mb-1.5 border-t border-border-strong pt-1.5 text-[10px] uppercase tracking-wider text-text-muted">
                            Rest of the {zoneWord(z.zone)} · {rest.length}
                        </div>
                        <div className="flex flex-wrap gap-1 opacity-45">
                            {rest.map((card) => (
                                <ProtoThumb
                                    key={card.id}
                                    card={card}
                                    width={WR}
                                />
                            ))}
                        </div>
                    </>
                )}
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
