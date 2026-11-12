// PROTOTYPE (zone-target highlight) — "N targeted" badge pinned on the pile.
import type { Pt } from "./use-zone-target-model";

export default function ProtoCountBadge({ at, n }: { at: Pt; n: number }) {
    return (
        <div
            className="pointer-events-none fixed z-[920] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-strong px-2 py-0.5 text-[11px] font-bold text-black shadow-lg ring-2 ring-black/40"
            style={{ left: at.x + 18, top: at.y - 22 }}
        >
            ◎ {n}
        </div>
    );
}
