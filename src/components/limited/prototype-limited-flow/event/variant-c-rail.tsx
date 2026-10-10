// PROTOTYPE — throwaway. Variant C "Rail": a tall left rail carries the
// identity (Feature Card, name, chips), the vertical phase stepper and the
// ONE next action at its foot; the right pane is tabs → the table (ring +
// seat legend side by side) → phase tiles. Phones: the rail collapses into
// a top block with a horizontal stepper.
import { getArtCropImageUrl } from "~/lib/images";
import PhasePills from "./phase-pills";
import EventChips from "./event-chips";
import EventMoreMenu from "./event-more-menu";
import EventTabs from "./event-tabs";
import NextActionHero from "./next-action-hero";
import PhaseStepper from "./phase-stepper";
import PhaseTiles from "./phase-tiles";
import ReviewTable from "./review-table";
import TableWithLegend from "./table-with-legend";
import { EVENT_META } from "./event-mock";
import { useEventProto } from "./use-event-proto";

export default function VariantCRail() {
    const p = useEventProto();
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3">
            <PhasePills p={p} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[17rem_minmax(0,1fr)] lg:grid-cols-[19rem_minmax(0,1fr)]">
                <aside className="flex flex-col overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface md:sticky md:top-3 md:max-h-[calc(100dvh-1.5rem)] md:self-start">
                    <div className="relative isolate flex min-h-32 flex-col justify-end gap-2 p-4 md:min-h-44">
                        <img
                            src={getArtCropImageUrl(EVENT_META.featureCard.id)}
                            alt=""
                            className="absolute inset-0 -z-10 h-full w-full object-cover"
                        />
                        <span
                            aria-hidden
                            className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.1),rgba(0,0,0,0.9))]"
                        />
                        <EventMoreMenu
                            p={p}
                            className="absolute right-3 top-3"
                        />
                        <h1 className="pr-12 font-display text-3xl leading-none text-parchment">
                            {EVENT_META.name}
                        </h1>
                        <EventChips />
                    </div>
                    <div className="border-t border-[var(--hairline)] px-4 py-3">
                        <PhaseStepper phase={p.phase} className="md:hidden" />
                        <PhaseStepper
                            phase={p.phase}
                            orientation="vertical"
                            className="hidden py-1 md:flex"
                        />
                    </div>
                    <div className="mt-auto border-t border-accent/30 bg-gradient-to-b from-accent/5 to-accent/15 p-4">
                        <NextActionHero p={p} look="rail" />
                    </div>
                </aside>
                <main className="flex min-w-0 flex-col gap-3">
                    <EventTabs p={p} />
                    {p.tab === "review" ? (
                        <ReviewTable p={p} />
                    ) : (
                        <>
                            <TableWithLegend p={p} />
                            <PhaseTiles
                                p={p}
                                pairRound
                                className="lg:grid-cols-2"
                            />
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
