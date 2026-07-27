// Synthetic / Replay mode switcher (issue #1613, ADR 0074: "Two modes —
// Synthetic ... Replay"). A plain two-button toggle, no routing — both modes
// live on the SAME `/draft-lab` route.
export type DraftLabMode = "synthetic" | "replay";

export default function DraftLabModeTabs({
    mode,
    onChange,
}: {
    mode: DraftLabMode;
    onChange: (mode: DraftLabMode) => void;
}) {
    const tabs: { key: DraftLabMode; label: string }[] = [
        { key: "synthetic", label: "Synthetic" },
        { key: "replay", label: "Replay" },
    ];

    return (
        <div className="flex gap-1 rounded-sm border border-border-subtle bg-surface-elevated/40 p-0.5">
            {tabs.map((tab) => (
                <button
                    key={tab.key}
                    type="button"
                    onClick={() => onChange(tab.key)}
                    aria-pressed={mode === tab.key}
                    className={`rounded-sm px-3 py-1 text-xs font-semibold tracking-wide uppercase transition-colors ${
                        mode === tab.key
                            ? "bg-accent/20 text-accent"
                            : "text-text-muted hover:text-text"
                    }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
