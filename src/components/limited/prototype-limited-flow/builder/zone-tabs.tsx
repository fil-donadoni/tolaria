// PROTOTYPE — throwaway. Variant B's phone segmented tabs: Creatures /
// Non-creatures / Sideboard with live counts. Each pill is a fly fallback
// target (`data-fly-tab`) when a card moves into a hidden tab.
import { cn } from "~/lib/utils";

export type ZoneTab = "creatures" | "spells" | "side";

export default function ZoneTabs({
    value,
    onChange,
    counts,
}: {
    value: ZoneTab;
    onChange: (t: ZoneTab) => void;
    counts: Record<ZoneTab, number>;
}) {
    const tabs: { key: ZoneTab; label: string }[] = [
        { key: "creatures", label: "Creatures" },
        { key: "spells", label: "Non-creatures" },
        { key: "side", label: "Sideboard" },
    ];
    return (
        <div
            role="tablist"
            aria-label="Deck zone"
            className="sticky top-0 z-30 grid grid-cols-3 gap-1 rounded-[var(--panel-radius)] border border-border-strong bg-surface-base/95 p-1 backdrop-blur"
        >
            {tabs.map((t) => {
                const active = t.key === value;
                return (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-fly-tab={t.key}
                        onClick={() => onChange(t.key)}
                        className={cn(
                            "flex min-h-10 flex-col items-center justify-center rounded-sm px-1 text-[11px] font-semibold leading-tight transition",
                            active
                                ? "bg-accent text-surface-base"
                                : "text-text-muted hover:text-parchment"
                        )}
                    >
                        <span className="truncate">{t.label}</span>
                        <span
                            className={cn(
                                "text-[13px] tabular-nums",
                                active ? "text-surface-base" : "text-parchment"
                            )}
                        >
                            {counts[t.key]}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
