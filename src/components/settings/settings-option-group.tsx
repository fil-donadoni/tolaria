import { useId } from "react";

export interface SettingsOption<T extends string> {
    value: T;
    label: string;
    description: string;
}

/**
 * Shared labeled radio group for the Settings page (issue #2595) — density,
 * motion and the preview default all share this exact shape (a legend, an
 * optional hint, and a row of mutually-exclusive options), so it is one
 * generic component rather than three near-identical button rows. Native
 * `<fieldset>`/`<legend>`/`<input type="radio">` on purpose: the axe gate
 * (`bun run check:ui`) flags unlabelled custom controls, and a real radio
 * group gets checked/label semantics for free.
 */
export default function SettingsOptionGroup<T extends string>({
    legend,
    legendVisible = true,
    hint,
    options,
    value,
    onChange,
    disabled = false,
}: {
    legend: string;
    /** `false` keeps the legend for screen readers only, when a visible
     *  Panel title already says the same thing (`sr-only`). */
    legendVisible?: boolean;
    hint?: string;
    options: readonly SettingsOption<T>[];
    value: T;
    onChange: (next: T) => void;
    disabled?: boolean;
}) {
    const name = useId();
    return (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
            <legend
                className={
                    legendVisible
                        ? "text-sm font-semibold text-text"
                        : "sr-only"
                }
            >
                {legend}
            </legend>
            {hint && <p className="text-xs text-text-muted">{hint}</p>}
            <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                    <label
                        key={option.value}
                        className={`flex max-w-[220px] cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                            value === option.value
                                ? "border-accent bg-accent-soft/30 text-parchment"
                                : "border-border-subtle text-text-muted hover:text-text"
                        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={option.value}
                            checked={value === option.value}
                            onChange={() => onChange(option.value)}
                            disabled={disabled}
                            className="mt-1"
                        />
                        <span className="flex flex-col">
                            <span className="font-medium">{option.label}</span>
                            <span className="text-xs">
                                {option.description}
                            </span>
                        </span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
