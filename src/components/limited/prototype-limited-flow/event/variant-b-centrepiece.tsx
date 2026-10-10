// PROTOTYPE — throwaway. Variant B "Centrepiece": slim strip header, then the
// table IS the page — a big ring with the next-action hero sitting on the
// felt in the middle and the tabs floating above it; phase tiles in a row
// underneath. Phones: hero card + table tile (circle in a dialog).
import { getArtCropImageUrl } from "~/lib/images";
import PhasePills from "./phase-pills";
import EventStripHeader from "./event-strip-header";
import EventTabs from "./event-tabs";
import NextActionHero from "./next-action-hero";
import PhaseTiles from "./phase-tiles";
import ReviewTable from "./review-table";
import TableCompactTile from "./table-compact-tile";
import TableRing from "./table-ring";
import { EVENT_META } from "./event-mock";
import { useEventProto } from "./use-event-proto";

export default function VariantBCentrepiece() {
    const p = useEventProto();
    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
            <PhasePills p={p} />
            <EventStripHeader p={p} />
            {p.hasTabs && (
                <div className="flex justify-center">
                    <EventTabs p={p} look="pill" />
                </div>
            )}
            {p.tab === "review" ? (
                <ReviewTable p={p} />
            ) : (
                <>
                    {/* phones */}
                    <div className="flex flex-col gap-3 sm:hidden">
                        <NextActionHero p={p} />
                        <TableCompactTile p={p} />
                    </div>
                    {/* the stage */}
                    <section
                        aria-label="The table"
                        className="relative isolate hidden overflow-hidden rounded-[calc(var(--panel-radius)*2)] border border-border-strong px-2 pt-6 sm:block"
                    >
                        <img
                            src={getArtCropImageUrl(EVENT_META.featureCard.id)}
                            alt=""
                            className="absolute inset-0 -z-20 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
                        />
                        <span
                            aria-hidden
                            className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_45%,transparent_0%,var(--color-surface-base)_75%)]"
                        />
                        <div className="mx-auto w-full max-w-[38rem]">
                            <TableRing
                                p={p}
                                radius={41}
                                center={
                                    <NextActionHero
                                        p={p}
                                        look="bare"
                                        className="px-2"
                                    />
                                }
                            />
                        </div>
                    </section>
                    <PhaseTiles
                        p={p}
                        pairRound
                        className={
                            p.phase === "waiting"
                                ? "md:grid-cols-2 lg:grid-cols-3"
                                : "md:grid-cols-2"
                        }
                    />
                </>
            )}
        </div>
    );
}
