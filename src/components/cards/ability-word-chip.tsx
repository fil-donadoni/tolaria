import {
    formatAbilityWordCounter,
    type AbilityWordCounter,
} from "~/lib/ability-word-counters";

// Inline live-count chip for a count-based ability word (Domain, Devotion,
// Delirium, …; see ability-word-counters.ts). Sits directly after the word in
// the live oracle text. Filled, bordered and bold so it reads as a value, not
// as more oracle text: success tones once the threshold is reached, a neutral
// raised tone while it is not, accent for an uncapped count (Devotion).
export default function AbilityWordChip({
    counter,
}: {
    counter: AbilityWordCounter;
}) {
    return (
        <span
            data-ability-word={counter.key}
            data-met={counter.met ?? undefined}
            className={`mx-1 inline-flex items-center rounded-md border px-1.5 py-px text-[0.9em] font-bold leading-none tabular-nums align-[0.05em] ${chipTone(counter.met)}`}
        >
            {formatAbilityWordCounter(counter)}
        </span>
    );
}

function chipTone(met: boolean | null): string {
    if (met === null)
        return "border-border-accent bg-accent-soft text-accent-strong";
    return met
        ? "border-success bg-success-soft text-success-strong"
        : "border-border-strong bg-surface-elevated text-text";
}
