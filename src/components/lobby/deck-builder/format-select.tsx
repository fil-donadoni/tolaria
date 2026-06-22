import { FORMAT_IDS, FORMAT_RULES, type FormatId } from "@convex/formats";

interface FormatSelectProps {
    value: FormatId;
    // When read-only (edit mode), the Format is fixed for the deck's life
    // (ADR 0036) and rendered as a static label instead of a control.
    readOnly: boolean;
    onChange: (format: FormatId) => void;
}

/**
 * The deck Format picker (PRD #509, ADR 0036). Required at creation; immutable
 * once chosen. In create mode it renders a `<select>` sourced from the code-side
 * `FORMAT_RULES` registry; in edit mode it shows the chosen Format read-only.
 */
export default function FormatSelect({
    value,
    readOnly,
    onChange,
}: FormatSelectProps) {
    if (readOnly) {
        return (
            <div className="flex items-center gap-2 text-sm">
                <span className="text-label tracking-wide text-text-muted">
                    Format
                </span>
                <span
                    className="rounded-sm border border-border-subtle/40 bg-surface/60 px-2 py-1 text-text"
                    title="Format is chosen at creation and cannot be changed"
                >
                    {FORMAT_RULES[value].label}
                </span>
            </div>
        );
    }

    return (
        <label className="flex items-center gap-2 text-sm">
            <span className="text-label tracking-wide text-text-muted">
                Format
            </span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as FormatId)}
                className="input-field px-2 py-1"
                aria-label="Deck format"
            >
                {FORMAT_IDS.map((id) => (
                    <option key={id} value={id}>
                        {FORMAT_RULES[id].label}
                    </option>
                ))}
            </select>
        </label>
    );
}
