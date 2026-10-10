// PROTOTYPE — throwaway. Variant A "Bento": banner header on top, then a
// two-column bento — hero + phase tiles left, the circular table in a tall
// tile on the right (sticky). Phones: hero, table tile, tiles, stacked.
import PhasePills from "./phase-pills";
import EventBannerHeader from "./event-banner-header";
import EventTabs from "./event-tabs";
import NextActionHero from "./next-action-hero";
import PhaseTiles from "./phase-tiles";
import TableCompactTile from "./table-compact-tile";
import TableRing from "./table-ring";
import ReviewTable from "./review-table";
import TileFrame from "./tile-frame";
import { tableSummary } from "./table-summary";
import { useEventProto } from "./use-event-proto";

export default function VariantABento() {
    const p = useEventProto();
    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
            <PhasePills p={p} />
            <EventBannerHeader p={p} />
            <EventTabs p={p} className="mt-1" />
            {p.tab === "review" ? (
                <ReviewTable p={p} />
            ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-flow-row-dense lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
                    <NextActionHero p={p} />
                    <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
                        <TableCompactTile p={p} className="sm:hidden" />
                        <TileFrame
                            title="The table"
                            right={
                                <span className="text-xs text-parchment">
                                    {tableSummary(p)}
                                </span>
                            }
                            className="hidden sm:flex lg:sticky lg:top-3"
                        >
                            <div className="mx-auto w-full max-w-[26rem]">
                                <TableRing p={p} />
                            </div>
                        </TileFrame>
                    </div>
                    <PhaseTiles p={p} className="sm:grid-cols-2" />
                </div>
            )}
        </div>
    );
}
