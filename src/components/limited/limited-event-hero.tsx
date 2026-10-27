import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import type { LimitedEventHero } from "~/lib/limited/limitedEventHero";
import LimitedRoundAction from "./limited-round-action";

/** The next-action hero (PRD #5383, issue #5389): ONE large call to action for
 *  the phase and viewer, chosen by the pure `limitedEventHero` mapping. This
 *  component only renders it and wires each kind to its handler.
 *
 *  During the Games phase the CTA is the round Match itself: the pairing's own
 *  Start / Accept / Resume decision (`LimitedRoundAction`) is hosted here, under
 *  the "Play match vs X" headline, so the page never shows a second primary
 *  button for the same Match. */
export default function LimitedEventHeroCard({
    eventId,
    event,
    hero,
    pending,
    onJoin,
    onStart,
    onLeave,
    hint,
}: {
    eventId: Id<"limitedEvents">;
    event: LimitedEventView;
    hero: LimitedEventHero;
    pending: boolean;
    onJoin: () => void;
    onStart: () => void;
    /** Present only for a seated viewer of an event not yet finished: opens
     *  the page's Leave Event confirm. */
    onLeave?: () => void;
    /** Quiet explanatory line under the CTA. */
    hint?: string;
}) {
    const navigate = useNavigate();
    const { cta, secondary } = hero;

    const handlerFor = (kind: typeof cta.kind): (() => void) | undefined => {
        switch (kind) {
            case "join":
                return onJoin;
            case "start":
                return onStart;
            case "draft":
                return () =>
                    void navigate({
                        to: "/limited/$eventId/draft",
                        params: { eventId },
                    });
            case "build":
                return () =>
                    void navigate({
                        to: "/limited/$eventId/build",
                        params: { eventId },
                    });
            case "back":
                return () => void navigate({ to: "/limited" });
            case "play":
            case "waiting":
                return undefined;
        }
    };

    const pairing = event.viewerPairing ?? null;

    return (
        <section
            data-testid="event-hero"
            data-hero-phase={hero.phase}
            data-hero-role={hero.role}
            className="flex flex-col items-start gap-3 rounded-[var(--panel-radius)] border border-accent/40 bg-surface-elevated p-4"
        >
            {cta.kind === "play" && pairing !== null ? (
                <>
                    <h2
                        data-hero-cta="play"
                        className="font-display text-xl text-parchment"
                    >
                        {cta.label}
                    </h2>
                    <LimitedRoundAction
                        eventId={eventId}
                        event={event}
                        pairing={pairing}
                    />
                </>
            ) : (
                <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    data-hero-cta={cta.kind}
                    disabled={cta.kind === "waiting" || pending}
                    onClick={handlerFor(cta.kind)}
                >
                    {cta.label}
                </Button>
            )}
            {secondary && (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-hero-secondary={secondary.kind}
                    disabled={pending}
                    onClick={handlerFor(secondary.kind)}
                >
                    {secondary.label}
                </Button>
            )}
            {onLeave && (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-hero-leave
                    disabled={pending}
                    onClick={onLeave}
                >
                    Leave Event
                </Button>
            )}
            {hint && <p className="text-sm italic text-text-muted">{hint}</p>}
        </section>
    );
}
