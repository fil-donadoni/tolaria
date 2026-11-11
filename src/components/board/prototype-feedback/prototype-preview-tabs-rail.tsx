// PROTOTYPE — throwaway (`?pv-preview-tabs=B`). A vertical rail on the dock's
// LEFT edge: one tall icon-over-label button per view, the active one joined to
// the card like a file-folder tab. The tabs stop competing with the card for
// the top of the panel and stay put while the body scrolls.
import PrototypePreviewDockPortal from "./prototype-preview-dock-portal";
import PrototypePreviewTabIcon from "./prototype-preview-tab-icon";
import type { PrototypePreviewTabsProps } from "./prototype-preview-tabs-types";

export default function PrototypePreviewTabsRail({
    mode,
    onChange,
    tabs,
}: PrototypePreviewTabsProps) {
    return (
        <PrototypePreviewDockPortal placement="left-rail">
            <div
                role="tablist"
                aria-orientation="vertical"
                className="flex h-full flex-col gap-1 border-r border-border-subtle bg-surface-base/60 py-2 pl-1"
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
                            className={`flex flex-col items-center gap-1 rounded-l-md border-l-[3px] px-1 py-3 text-[11px] font-semibold leading-tight ${
                                active
                                    ? "-mr-px border-accent bg-surface-elevated text-parchment"
                                    : "border-transparent text-text-muted hover:bg-accent-soft/20 hover:text-parchment"
                            }`}
                        >
                            <PrototypePreviewTabIcon view={t.key} size={22} />
                            <span className="text-center">{t.label}</span>
                        </button>
                    );
                })}
            </div>
        </PrototypePreviewDockPortal>
    );
}
