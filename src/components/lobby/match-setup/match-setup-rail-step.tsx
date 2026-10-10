// One row of the recap rail (PRD #5334 stories 16–18): the step's title and
// its current answer. Clicking an answered step re-opens it; a step ahead of
// the first unanswered one is disabled.
import type { StepInfo } from "~/lib/matchSetup";
import { cn } from "~/lib/utils";

export default function MatchSetupRailStep({
    step,
    index,
    active,
    disabled,
    onOpen,
}: {
    step: StepInfo;
    index: number;
    active: boolean;
    disabled: boolean;
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-current={active ? "step" : undefined}
            onClick={onOpen}
            data-setup-step={step.key}
            className={cn(
                "flex min-h-[var(--control-h)] flex-col rounded-sm px-2 py-1.5 text-left transition",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active ? "bg-accent/15" : "hover:bg-surface-elevated/40"
            )}
        >
            <span className="text-[11px] tracking-wide text-text-muted uppercase">
                {index + 1}. {step.title}
            </span>
            <span className="truncate text-sm text-parchment">
                {step.answer ?? "—"}
            </span>
        </button>
    );
}
