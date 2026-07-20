import type { Milestone } from "~/lib/graveyard-milestones";

// Inline `have/need` progress chip for a graveyard ability word (Delirium /
// Threshold, see graveyard-milestones.ts). Sits directly after the ability word
// in the live oracle text and turns emerald once the milestone is reached, so
// the conditional clause's on/off state is readable at a glance.
export default function MilestoneChip({ milestone }: { milestone: Milestone }) {
    const tone = milestone.met
        ? "text-success-strong border-success/50"
        : "text-text-muted border-border-subtle";
    return (
        <span
            data-milestone={milestone.word.toLowerCase()}
            data-met={milestone.met}
            className={`mx-1 inline-flex items-center rounded border px-1 text-[0.85em] font-semibold tabular-nums align-[0.05em] ${tone}`}
        >
            {milestone.have}/{milestone.need}
        </span>
    );
}
