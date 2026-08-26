import { useRef } from "react";
import { cn } from "@/lib/utils";

export type SegmentedControlOption<Value extends string> = {
    value: Value;
    label: React.ReactNode;
};

type SegmentedControlProps<Value extends string> = {
    options: SegmentedControlOption<Value>[];
    value: Value;
    onChange: (value: Value) => void;
    /** Accessible name for the group (WAI-ARIA radiogroup pattern) — every
     *  call site names what the segments choose ("Filter by card type"),
     *  never a generic default. */
    ariaLabel: string;
    /** Disables every segment (e.g. while a submit is in flight) — the group
     *  stays in the accessibility tree, just non-interactive, matching how
     *  `Button` disables rather than unmounting. */
    disabled?: boolean;
    className?: string;
};

/**
 * Shared segmented-control primitive (ADR 0103 §5/§22, issue #2729).
 *
 * `.segment-pill` / `.segment-active` / `.segment-inactive` (`index.css`,
 * issue #2723) are already the v4 "dark field, hairline, accent focus ring"
 * recipe every segmented control in the app paints with — but there was no
 * shared COMPONENT wrapping them: three lobby controls
 * (`match-format-selector.tsx`, `difficulty-selector.tsx`,
 * `play-mode-selector.tsx`) hand-roll `role="radiogroup"`/`role="radio"`
 * markup on `bg-accent`/`bg-surface-elevated` directly, each with click-only
 * selection and no roving tabindex. This component is the WAI-ARIA APG radio
 * group pattern (`https://www.w3.org/WAI/ARIA/apg/patterns/radio/`) on top of
 * the same three CSS classes: one tab stop for the group, `ArrowLeft`/
 * `ArrowRight` moving AND selecting between segments, `aria-checked` mirroring
 * the selected value.
 *
 * The three existing lobby controls are NOT migrated onto this component here
 * — that is a separate refactor outside this issue's target files (see
 * `docs/findings/2729-segmented-control-callers.md`). This is the primitive
 * new callers (the pile-browse filter footer) reach for instead of hand-
 * rolling a sixth copy.
 */
export default function SegmentedControl<Value extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    disabled = false,
    className,
}: SegmentedControlProps<Value>) {
    const groupRef = useRef<HTMLDivElement>(null);

    const focusSegmentAt = (index: number) => {
        const buttons =
            groupRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role="radio"]'
            );
        buttons?.[index]?.focus();
    };

    const handleKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        index: number
    ) => {
        if (disabled) return;
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (index + delta + options.length) % options.length;
        onChange(options[nextIndex].value);
        focusSegmentAt(nextIndex);
    };

    return (
        <div
            ref={groupRef}
            role="radiogroup"
            aria-label={ariaLabel}
            aria-disabled={disabled || undefined}
            className={cn(
                "inline-flex items-center gap-1 rounded-sm border border-border-subtle/40 bg-surface-elevated/20 p-0.5",
                className
            )}
        >
            {options.map((option, index) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(option.value)}
                        onKeyDown={(event) => handleKeyDown(event, index)}
                        className={cn(
                            "segment-pill text-xs font-medium",
                            "disabled:cursor-not-allowed disabled:opacity-40",
                            selected ? "segment-active" : "segment-inactive"
                        )}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
