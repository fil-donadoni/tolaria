/** One `<select>` filter control, shared by the Cards and Classes tabs
 *  (issue #4177, review of PR #4810 finding N2) — Target List, cause, blame
 *  and status all share this shape; only the option list and the "all"
 *  placeholder differ. */
export default function BotFindingsFilterSelect({
    label,
    placeholder,
    value,
    options,
    onChange,
}: {
    label: string;
    placeholder: string;
    value: string;
    options: readonly { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    return (
        <select
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-xs text-text"
        >
            <option value="">{placeholder}</option>
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    );
}
