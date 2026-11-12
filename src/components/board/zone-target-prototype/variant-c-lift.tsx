// PROTOTYPE (zone-target highlight) — C "Lifted out": the targeted cards are
// pulled out of the pile as ghost cards and the arrow lands on EACH card, not
// on the pile (one arrow per target, like a permanent). A dashed tether
// ghost → pile says where it lives. The real stack → pile arrow is hidden.
import ProtoArrowLayer, { type ProtoPath } from "./proto-arrow-layer";
import ProtoThumb from "./proto-thumb";
import { curve, inward, zoneWord, type VariantProps } from "./variant-props";

export const VARIANT_C_NAME = "Lifted out, arrow per card";
const W = 86;
const GAP = 14;

/** Hide the real layer's zone-target arrows while C is up (prototype hack). */
const HIDE_REAL = `[data-testid="board-arrows"] g:has(path[data-arrow-key*="graveyard-card"]) { display: none; }`;

export default function VariantCLift({ groups, anchors }: VariantProps) {
    const paths: ProtoPath[] = [];
    const nodes = groups.flatMap((g) => {
        const a = anchors[g.key];
        if (!a?.zone) return [];
        const dir = inward(a.zone);
        const c = { x: a.zone.x + dir.x * 160, y: a.zone.y + dir.y * 160 };
        // Lay the ghosts out perpendicular to the inward direction.
        const perp = { x: -dir.y, y: dir.x };
        const n = g.cards.length;
        return g.cards.map((card, i) => {
            const off = (i - (n - 1) / 2) * (W + GAP);
            const p = { x: c.x + perp.x * off, y: c.y + perp.y * off };
            const top = { x: p.x, y: p.y - (W * 1.395) / 2 - 4 };
            paths.push({ key: `${card.id}:arrow`, d: curve(a.source, top) });
            paths.push({
                key: `${card.id}:tether`,
                d: `M ${p.x} ${p.y} L ${a.zone!.x} ${a.zone!.y}`,
                dashed: true,
                thin: true,
            });
            return (
                <div
                    key={card.id}
                    className="pointer-events-none fixed z-[910] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                    style={{ left: p.x, top: p.y }}
                >
                    <ProtoThumb card={card} width={W} targeted />
                    <span className="rounded bg-black/75 px-1.5 text-[10px] text-white/85">
                        {g.ownerLabel} {zoneWord(g.zone)}
                    </span>
                </div>
            );
        });
    });
    return (
        <>
            <style>{HIDE_REAL}</style>
            <ProtoArrowLayer paths={paths} />
            {nodes}
        </>
    );
}
