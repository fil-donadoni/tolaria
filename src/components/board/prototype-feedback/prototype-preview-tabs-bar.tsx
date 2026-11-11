// PROTOTYPE — throwaway (`?pv-preview-tabs=A`). A real tab bar: full width, at
// the top, icon + 13px label, the active tab underlined, and the rulings COUNT
// on the Rulings tab so the player sees there is something behind it.
import useCardRulings from "~/hooks/useCardRulings";
import PrototypePreviewTabIcon from "./prototype-preview-tab-icon";
import type { PrototypePreviewTabsProps } from "./prototype-preview-tabs-types";

export default function PrototypePreviewTabsBar({
    mode,
    onChange,
    tabs,
    rulingsPrintId,
}: PrototypePreviewTabsProps) {
    // Prototype shortcut: fetches the rulings as soon as the preview opens
    // (the real view fetches only when its tab is selected).
    const { state } = useCardRulings(rulingsPrintId ?? null, true);
    const count = state.status === "loaded" ? state.rulings.length : null;
    return (
        <div
            role="tablist"
            data-prototype-preview-tabs="bar"
            className="sticky top-0 z-10 flex w-full border-b border-border-subtle bg-surface-elevated"
        >
            {tabs.map((t) => {
                const active = mode === t.key;
                return (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-preview-mode={t.key}
                        onClick={() => onChange(t.key)}
                        className={`-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-[3px] px-2 py-2.5 text-[13px] font-semibold ${
                            active
                                ? "border-accent text-parchment"
                                : "border-transparent text-text-muted hover:bg-accent-soft/20 hover:text-parchment"
                        }`}
                    >
                        <PrototypePreviewTabIcon view={t.key} />
                        <span className="whitespace-nowrap">{t.label}</span>
                        {t.key === "rulings" && count !== null && (
                            <span
                                className={`rounded-full px-1.5 text-[11px] leading-[18px] ${
                                    count > 0
                                        ? "bg-signal-pending text-surface-base"
                                        : "bg-surface-base/60 text-text-muted"
                                }`}
                            >
                                {count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
