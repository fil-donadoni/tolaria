import {
    LIMITED_EVENT_PHASES,
    LIMITED_EVENT_PHASE_LABEL,
    type LimitedEventPhase,
} from "~/lib/limited/limitedEventHero";
import { cn } from "~/lib/utils";

/** Waiting ▸ Draft ▸ Deckbuilding ▸ Games ▸ Done, the current step marked
 *  (`aria-current="step"`, PRD #5383, issue #5389). Steps already behind the
 *  table read as done, the rest as upcoming. */
export default function LimitedEventStepper({
    phase,
}: {
    phase: LimitedEventPhase;
}) {
    const current = LIMITED_EVENT_PHASES.indexOf(phase);
    return (
        <ol
            aria-label="Event phase"
            data-testid="event-stepper"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-wide"
        >
            {LIMITED_EVENT_PHASES.map((step, index) => (
                <li
                    key={step}
                    data-step={step}
                    aria-current={index === current ? "step" : undefined}
                    className={cn(
                        "flex items-center gap-2",
                        index === current
                            ? "text-accent-strong"
                            : index < current
                              ? "text-text-muted"
                              : "text-text-disabled"
                    )}
                >
                    {LIMITED_EVENT_PHASE_LABEL[step]}
                    {index < LIMITED_EVENT_PHASES.length - 1 && (
                        <span aria-hidden="true">▸</span>
                    )}
                </li>
            ))}
        </ol>
    );
}
