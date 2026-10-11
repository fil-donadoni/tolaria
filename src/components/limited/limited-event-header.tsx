import type { ReactNode } from "react";
import type { LimitedEventView, PackSourceInfo } from "~/hooks/useLimitedEvent";
import { limitedEventName } from "~/lib/limitedEventName";
import { limitedEventChips } from "~/lib/limited/limitedEventHero";
import LimitedHubArt from "./limited-hub/limited-hub-art";

/** The event page's banner (PRD #5383, issue #5389): the Pack Source's Feature
 *  Card as the backdrop, the event name and its chips (type · Pack Source,
 *  Games Format, seats, timer). `menu` is the ⋯ slot, top right, so secondary
 *  actions never sit beside the hero's CTA. */
export default function LimitedEventHeader({
    event,
    source,
    menu,
}: {
    event: LimitedEventView;
    source: PackSourceInfo | undefined;
    menu: ReactNode;
}) {
    return (
        <header
            data-testid="event-header"
            className="relative isolate flex min-h-32 flex-col justify-end gap-2 rounded-[var(--panel-radius)] border border-accent/50 bg-surface p-4"
        >
            {/* Only the art is clipped: the header itself must not clip the
                ⋯ menu that drops out of it. */}
            <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
                <LimitedHubArt source={source} />
            </div>
            <div className="absolute right-2 top-2 z-10">{menu}</div>
            <h1 className="pr-14 font-display text-2xl leading-tight text-parchment drop-shadow">
                {limitedEventName(event)}
            </h1>
            <ul className="flex flex-wrap gap-1.5">
                {limitedEventChips(event, source?.name).map((chip) => (
                    <li
                        key={chip}
                        className="rounded-sm border border-accent/40 bg-surface/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
                    >
                        {chip}
                    </li>
                ))}
            </ul>
        </header>
    );
}
