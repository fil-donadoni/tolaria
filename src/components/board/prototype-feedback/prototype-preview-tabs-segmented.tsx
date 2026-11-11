// PROTOTYPE — throwaway (`?pv-preview-tabs=C`). A bottom segmented control
// pinned under the card, cycled with ← / → while the preview is open, with the
// shortcut spelled out and a dots pager — the views read as PAGES of one card.
import { useEffect } from "react";
import PrototypePreviewDockPortal from "./prototype-preview-dock-portal";
import type { PrototypePreviewTabsProps } from "./prototype-preview-tabs-types";

export default function PrototypePreviewTabsSegmented({
    mode,
    onChange,
    tabs,
}: PrototypePreviewTabsProps) {
    const idx = Math.max(
        0,
        tabs.findIndex((t) => t.key === mode)
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Alt+arrows belong to the prototype switcher.
            if (e.altKey || e.metaKey || e.ctrlKey) return;
            const t = e.target as HTMLElement | null;
            if (
                t &&
                (t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.isContentEditable)
            )
                return;
            const d =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            onChange(tabs[(idx + d + tabs.length) % tabs.length].key);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    });

    const kbd =
        "rounded border border-border-subtle bg-surface-base px-1.5 font-mono text-[11px] text-parchment";
    return (
        <PrototypePreviewDockPortal placement="bottom">
            <div className="flex flex-col items-center gap-1.5 border-t border-border-subtle bg-surface-elevated px-3 pb-2 pt-2.5">
                <div role="tablist" className="flex w-full items-center gap-2">
                    <span className={kbd}>←</span>
                    <div className="flex flex-1 rounded-full bg-surface-base/70 p-1">
                        {tabs.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                role="tab"
                                aria-selected={mode === t.key}
                                data-preview-mode={t.key}
                                onClick={() => onChange(t.key)}
                                className={`flex-1 whitespace-nowrap rounded-full px-2 py-1.5 text-[12px] font-semibold ${
                                    mode === t.key
                                        ? "bg-accent text-surface-base shadow"
                                        : "text-text-muted hover:text-parchment"
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <span className={kbd}>→</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    <span className="flex gap-1">
                        {tabs.map((t, i) => (
                            <span
                                key={t.key}
                                className={`h-1.5 rounded-full ${
                                    i === idx
                                        ? "w-4 bg-accent"
                                        : "w-1.5 bg-text-muted/50"
                                }`}
                            />
                        ))}
                    </span>
                    <span>
                        {idx + 1}/{tabs.length} · ← → to switch
                    </span>
                </div>
            </div>
        </PrototypePreviewDockPortal>
    );
}
