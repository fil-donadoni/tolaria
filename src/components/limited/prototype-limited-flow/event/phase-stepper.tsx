// PROTOTYPE — throwaway. Waiting ▸ Draft ▸ Deckbuilding ▸ Games ▸ Done.
import { Check } from "lucide-react";
import { cn } from "~/lib/utils";
import { PHASES, phaseIndex, type EventPhase } from "./event-mock";

export default function PhaseStepper({
    phase,
    orientation = "horizontal",
    compact = false,
    className,
}: {
    phase: EventPhase;
    orientation?: "horizontal" | "vertical";
    /** Horizontal only: label the current step alone, at every width. */
    compact?: boolean;
    className?: string;
}) {
    const at = phaseIndex(phase);
    const vertical = orientation === "vertical";
    return (
        <ol
            aria-label="Event phase"
            className={cn(
                "flex",
                vertical ? "flex-col" : "items-center gap-1.5",
                className
            )}
        >
            {PHASES.map((ph, i) => {
                const done = i < at || phase === "finished";
                const current = i === at;
                const last = i === PHASES.length - 1;
                return (
                    <li
                        key={ph.key}
                        aria-current={current ? "step" : undefined}
                        className={cn(
                            "relative flex items-center gap-2",
                            vertical ? "pb-4 last:pb-0" : !last && "flex-1"
                        )}
                    >
                        {vertical && !last && (
                            <span
                                aria-hidden
                                className={cn(
                                    "absolute left-3 top-6 h-[calc(100%-1.5rem)] w-px",
                                    i < at
                                        ? "bg-accent/60"
                                        : "bg-[var(--hairline-strong)]"
                                )}
                            />
                        )}
                        <span
                            className={cn(
                                "flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold tabular-nums",
                                done
                                    ? "border-accent bg-accent text-surface-base"
                                    : current
                                      ? "border-accent bg-accent/15 text-accent-strong ring-4 ring-accent/15"
                                      : "border-border-strong text-text-disabled"
                            )}
                        >
                            {done && !current ? (
                                <Check className="size-3.5" strokeWidth={3} />
                            ) : (
                                i + 1
                            )}
                        </span>
                        <span
                            className={cn(
                                "truncate text-[11px] font-semibold uppercase tracking-[0.12em]",
                                current
                                    ? "text-parchment"
                                    : done
                                      ? "text-text-muted"
                                      : "text-text-disabled",
                                !vertical &&
                                    !current &&
                                    (compact ? "hidden" : "hidden md:inline")
                            )}
                        >
                            {ph.step}
                        </span>
                        {!vertical && !last && (
                            <span
                                aria-hidden
                                className={cn(
                                    "h-px min-w-3 flex-1",
                                    i < at
                                        ? "bg-accent/60"
                                        : "bg-[var(--hairline-strong)]"
                                )}
                            />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
