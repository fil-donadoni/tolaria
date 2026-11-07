// PROTOTYPE — throwaway. Scope tabs shared by the variants' headers.
export default function ProtoScopeTabs({
    scopes,
    value,
    onChange,
}: {
    scopes: { setCode: string; label: string }[];
    value: string | undefined;
    onChange: (s: string) => void;
}) {
    return (
        <div
            role="radiogroup"
            aria-label="Scope"
            className="flex flex-wrap gap-1"
        >
            {scopes.map((s) => (
                <button
                    key={s.setCode}
                    type="button"
                    role="radio"
                    aria-checked={value === s.setCode}
                    onClick={() => onChange(s.setCode)}
                    className={
                        "rounded-sm border px-2.5 py-1 text-xs font-medium transition " +
                        (value === s.setCode
                            ? "border-accent-strong/70 bg-accent/30 text-parchment"
                            : "border-border-subtle/40 text-text-muted hover:text-text")
                    }
                >
                    {s.label}
                </button>
            ))}
        </div>
    );
}
