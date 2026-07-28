import type { ReactNode } from "react";

type ControllerTabButtonProps = {
    /** Caption under the glyph. Truncated, never wrapped — the grid cell is a
     *  fixed quarter of the bar, so a longer value can never resize the bar. */
    label: string;
    ariaLabel?: string;
    ariaExpanded?: boolean;
    /** Highlights the tab while its surface (drawer / sheet) is open. */
    active?: boolean;
    /** Extra classes for a transient affordance (e.g. the self-target ring). */
    highlightClassName?: string;
    onClick: () => void;
    /** The glyph row: an icon, or the life total for the "You" tab. */
    children: ReactNode;
};

/** One tab of the portrait bar's app tab bar (variant D, #1759).
 *
 *  Every tab is the same fixed-height, fixed-width cell so the bar's geometry
 *  is independent of its contents — a longer phase label or a three-digit life
 *  total truncates instead of pushing its neighbours around. Zero layout shift
 *  is the whole point of the redesign, so the shell owns the sizing and callers
 *  only supply content. */
export default function ControllerTabButton({
    label,
    ariaLabel,
    ariaExpanded,
    active = false,
    highlightClassName = "",
    onClick,
    children,
}: ControllerTabButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            aria-expanded={ariaExpanded}
            className={`flex h-[3.25rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                active ? "text-accent-strong" : "text-text-muted"
            } ${highlightClassName}`}
        >
            {children}
            <span className="max-w-full truncate px-1 text-[9px] font-medium uppercase tracking-[0.14em]">
                {label}
            </span>
        </button>
    );
}
