// PROTOTYPE — throwaway. Deckbuilding: your 45-card pool by colour.
import ManaSymbol from "~/components/cards/mana-symbol";
import TileFrame from "./tile-frame";
import type { MockSeat } from "./event-mock";

export default function PoolTile({
    viewer,
    className,
}: {
    viewer: MockSeat;
    className?: string;
}) {
    const counts = ["W", "U", "B", "R", "C"].map((c) => ({
        c,
        n: viewer.picks.filter((x) =>
            c === "C" ? x.colors.length === 0 : x.colors.includes(c)
        ).length,
    }));
    const max = Math.max(...counts.map((x) => x.n), 1);
    return (
        <TileFrame
            title="Your pool"
            right={
                <span className="text-xs text-text-muted">
                    45 cards · deck <b className="text-danger-strong">not in</b>
                </span>
            }
            className={className}
        >
            <ul className="flex flex-col gap-1.5">
                {counts.map(({ c, n }) => (
                    <li key={c} className="flex items-center gap-2 text-xs">
                        <ManaSymbol symbol={c} className="size-4" />
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                            <span
                                className="block h-full rounded-full bg-parchment/70"
                                style={{ width: `${(n / max) * 100}%` }}
                            />
                        </span>
                        <span className="w-5 text-right tabular-nums text-parchment">
                            {n}
                        </span>
                    </li>
                ))}
            </ul>
        </TileFrame>
    );
}
