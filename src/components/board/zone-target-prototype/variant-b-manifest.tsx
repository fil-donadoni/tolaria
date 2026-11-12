// PROTOTYPE (zone-target highlight) — B "Stack manifest": nothing new at the
// pile but a ◎N badge; the SOURCE grows a text-first target list (thumb +
// name + "in X's graveyard"), i.e. the stack item itself says what it targets.
import ProtoArrowLayer, { type ProtoPath } from "./proto-arrow-layer";
import ProtoCountBadge from "./proto-count-badge";
import ProtoThumb from "./proto-thumb";
import { protoName } from "./use-zone-target-model";
import { curve, inward, zoneWord, type VariantProps } from "./variant-props";

export const VARIANT_B_NAME = "Stack manifest";

export default function VariantBManifest({
    groups,
    anchors,
    drawBase,
}: VariantProps) {
    const paths: ProtoPath[] = [];
    // One manifest per SOURCE (a spell targeting both graveyards lists both).
    const bySource = new Map<string, typeof groups>();
    for (const g of groups) {
        const k = g.sourceStackId ?? "sim";
        bySource.set(k, [...(bySource.get(k) ?? []), g]);
    }
    const badges = groups.flatMap((g) => {
        const a = anchors[g.key];
        if (!a?.zone) return [];
        if (drawBase)
            paths.push({ key: `${g.key}:base`, d: curve(a.source, a.zone) });
        return [<ProtoCountBadge key={g.key} at={a.zone} n={g.cards.length} />];
    });
    const manifests = Array.from(bySource.entries()).map(([k, gs]) => {
        const a = anchors[gs[0].key];
        if (!a) return null;
        const dir = inward(a.source);
        const left = a.source.x + (dir.x < 0 ? -300 : 40);
        return (
            <div
                key={k}
                className="pointer-events-auto fixed z-[915] w-[260px] rounded-lg border border-accent-strong/60 bg-surface/95 p-2 text-xs text-text shadow-2xl backdrop-blur"
                style={{ left, top: a.source.y - 20 }}
            >
                <div className="mb-1 font-semibold text-accent-strong">
                    {gs[0].sourceLabel} targets
                </div>
                {gs.flatMap((g) =>
                    g.cards.map((card) => (
                        <div
                            key={card.id}
                            className="flex items-center gap-2 py-0.5"
                        >
                            <ProtoThumb card={card} width={30} targeted />
                            <div className="min-w-0">
                                <div className="truncate font-medium">
                                    {protoName(card)}
                                </div>
                                <div className="text-text-muted">
                                    in {g.ownerLabel} {zoneWord(g.zone)}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        );
    });
    return (
        <>
            <ProtoArrowLayer paths={paths} />
            {badges}
            {manifests}
        </>
    );
}
