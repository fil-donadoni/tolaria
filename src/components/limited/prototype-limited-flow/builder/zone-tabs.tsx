// PROTOTYPE — throwaway. Phone segmented tabs (Creatures / Non-creatures /
// Sideboard, or Deck / Sideboard) with live counts. Each pill is a fly fallback
// target (`data-fly-tab`) when a card moves into a hidden tab.
import { cn } from "~/lib/utils";

export type ZoneTab = "creatures" | "spells" | "deck" | "side";

export default function ZoneTabs({
    value,
    onChange,
    tabs,
}: {
    value: ZoneTab;
    onChange: (t: ZoneTab) => void;
    tabs: { key: ZoneTab; label: string; count: number }[];
}) {
    return (
        <div
            role="tablist"
            aria-label="Deck zone"
            style={{
                gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
            }}
            className="sticky top-0 z-30 grid gap-1 rounded-[var(--panel-radius)] border border-border-strong bg-surface-base/95 p-1 backdrop-blur"
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
                            {t.count}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
