// PROTOTYPE — throwaway. Variant B's slim header: the Feature Card as a
// round medallion, name + chips, stepper in the same strip, ⋯ menu.
import { getArtCropImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import EventChips from "./event-chips";
import EventMoreMenu from "./event-more-menu";
import PhaseStepper from "./phase-stepper";
import { EVENT_META } from "./event-mock";
import type { EventProto } from "./use-event-proto";

export default function EventStripHeader({
    p,
    className,
}: {
    p: EventProto;
    className?: string;
}) {
    return (
        <header
            className={cn(
                "relative isolate flex flex-col gap-3 overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface p-3 sm:p-4 lg:flex-row lg:items-center",
                className
            )}
        >
            <img
                src={getArtCropImageUrl(EVENT_META.featureCard.id)}
                alt=""
                className="absolute inset-0 -z-10 h-full w-full object-cover opacity-20 blur-[2px]"
            />
            <div className="flex min-w-0 flex-1 items-center gap-3">
                <img
                    src={getArtCropImageUrl(EVENT_META.featureCard.id)}
                    alt={EVENT_META.featureCard.name}
                    className="size-14 shrink-0 rounded-full border-2 border-accent/60 object-cover shadow-lg sm:size-16"
                />
                <div className="flex min-w-0 flex-col gap-1.5">
                    <h1 className="truncate font-display text-2xl leading-none text-parchment sm:text-3xl">
                        {EVENT_META.name}
                    </h1>
                    <EventChips />
                </div>
                <EventMoreMenu p={p} className="ml-auto lg:hidden" />
            </div>
            <div className="flex items-center gap-3 lg:w-[26rem] lg:shrink-0">
                <PhaseStepper phase={p.phase} compact className="flex-1" />
                <EventMoreMenu p={p} className="hidden lg:flex" />
            </div>
        </header>
    );
}
