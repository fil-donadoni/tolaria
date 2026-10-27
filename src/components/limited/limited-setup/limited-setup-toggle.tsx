// An On/Off setting with its one-line consequence (PRD #5383): the Table
// step's pick timer, round deadline and Open Decklists share this shape.
import SegmentedControl from "~/components/ui/segmented-control";

export default function LimitedSetupToggle({
    label,
    value,
    consequence,
    note,
    onChange,
}: {
    label: string;
    value: boolean;
    /** What the current value means, shown under the control. */
    consequence: string;
    /** A rule that holds whatever the value is, shown directly under the control. */
    note?: string;
    onChange: (value: boolean) => void;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[11px] tracking-wide text-text-muted uppercase">
                {label}
            </span>
            <SegmentedControl
                ariaLabel={label}
                value={value ? "on" : "off"}
                onChange={(next) => onChange(next === "on")}
                options={[
                    { value: "off", label: "Off" },
                    { value: "on", label: "On" },
                ]}
            />
            {note && (
                <span
                    className="text-xs text-text-muted"
                    data-testid="limited-setup-toggle-note"
                >
                    {note}
                </span>
            )}
            <span className="text-xs text-text-muted">{consequence}</span>
        </div>
    );
}
