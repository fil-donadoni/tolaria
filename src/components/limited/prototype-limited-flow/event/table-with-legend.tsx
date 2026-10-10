// PROTOTYPE — throwaway. Variant C's table panel: the ring beside a seat
// legend (xl), stacked below that; the compact tile on phones.
import TableCompactTile from "./table-compact-tile";
import TableLegend from "./table-legend";
import TableRing from "./table-ring";
import TileFrame from "./tile-frame";
import { tableSummary } from "./table-summary";
import type { EventProto } from "./use-event-proto";

export default function TableWithLegend({ p }: { p: EventProto }) {
    return (
        <>
            <TableCompactTile p={p} className="sm:hidden" />
            <TileFrame
                title="The table"
                right={
                    <span className="text-xs text-parchment">
                        {tableSummary(p)}
                    </span>
                }
                className="hidden sm:flex"
            >
                <div className="grid items-center gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
                    <div className="mx-auto w-full max-w-[26rem]">
                        <TableRing p={p} />
                    </div>
                    <TableLegend
                        p={p}
                        className="xl:border-l xl:border-[var(--hairline)] xl:pl-4"
                    />
                </div>
            </TileFrame>
        </>
    );
}
