// PROTOTYPE — throwaway. Header: Feature Card banner (Black Lotus for
// Vintage Cube), event name, Games Format + chips, ⋯ menu, phase stepper.
import { ArrowLeft } from "lucide-react";
import { getArtCropImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import EventChips from "./event-chips";
import EventMoreMenu from "./event-more-menu";
import PhaseStepper from "./phase-stepper";
import { EVENT_META } from "./event-mock";
import type { EventProto } from "./use-event-proto";

export default function EventBannerHeader({
    p,
    compact = false,
    className,
}: {
    p: EventProto;
    compact?: boolean;
    className?: string;
}) {
    return (
        <header
            className={cn(
                "overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface",
                className
            )}
        >
            <div
                className={cn(
                    "relative isolate flex flex-col justify-end",
                    compact ? "min-h-24 sm:min-h-28" : "min-h-36 sm:min-h-48"
                )}
            >
                <img
                    src={getArtCropImageUrl(EVENT_META.featureCard.id)}
                    alt=""
                    className="absolute inset-0 -z-10 h-full w-full object-cover object-[50%_35%]"
                />
                <span
                    aria-hidden
                    className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.15)_0%,rgba(0,0,0,0.35)_50%,rgba(0,0,0,0.9)_100%)]"
                />
                <div className="absolute left-3 right-3 top-3 flex items-center justify-between">
                    <button
                        type="button"
                        className="flex items-center gap-1 rounded-full bg-surface-base/60 px-2.5 py-1 text-xs text-parchment backdrop-blur hover:bg-surface-base/80"
                    >
                        <ArrowLeft className="size-3.5" /> Limited
                    </button>
                    <EventMoreMenu p={p} />
                </div>
                <div className="flex flex-col gap-2 p-4 pt-14 sm:p-5 sm:pt-14">
                    <EventChips />
                    <h1
                        className={cn(
                            "font-display leading-none text-parchment drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]",
                            compact
                                ? "text-2xl sm:text-3xl"
                                : "text-3xl sm:text-5xl"
                        )}
                    >
                        {EVENT_META.name}
                    </h1>
                </div>
            </div>
            <div className="border-t border-[var(--hairline)] px-4 py-3 sm:px-5">
                <PhaseStepper phase={p.phase} />
            </div>
        </header>
    );
}
