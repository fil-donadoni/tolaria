// A bounded integer field of the Table step (PRD #5383). The text is a local
// draft: clearing the field or typing through an out-of-range prefix ("2" on
// the way to "26") never snaps the setup mid-keystroke; a valid in-range value
// commits as it is typed, and leaving the field commits the clamped value.
import { useState } from "react";
import { Input } from "~/components/ui/input";

const FIELD_LABEL = "text-[11px] tracking-wide text-text-muted uppercase";

export default function LimitedSetupNumberField({
    label,
    value,
    min,
    max,
    hint,
    onCommit,
}: {
    label: string;
    value: number;
    min: number;
    max?: number;
    hint?: string;
    onCommit: (value: number) => void;
}) {
    // `null` = not editing: show the setup's own value.
    const [draft, setDraft] = useState<string | null>(null);
    const parse = (raw: string): number | null => {
        const n = Number(raw);
        return raw.trim() !== "" && Number.isInteger(n) ? n : null;
    };
    const inRange = (n: number) => n >= min && (max === undefined || n <= max);
    return (
        <label className="flex max-w-40 flex-col gap-1">
            <span className={FIELD_LABEL}>{label}</span>
            <Input
                type="number"
                min={min}
                max={max}
                value={draft ?? String(value)}
                onChange={(e) => {
                    const raw = e.currentTarget.value;
                    setDraft(raw);
                    const n = parse(raw);
                    if (n !== null && inRange(n)) onCommit(n);
                }}
                onBlur={() => {
                    const n = draft === null ? null : parse(draft);
                    if (n !== null) {
                        onCommit(
                            Math.max(
                                min,
                                max === undefined ? n : Math.min(max, n)
                            )
                        );
                    }
                    setDraft(null);
                }}
            />
            {hint && <span className="text-xs text-text-muted">{hint}</span>}
        </label>
    );
}
