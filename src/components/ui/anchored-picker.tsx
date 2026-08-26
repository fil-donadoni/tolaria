import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

export type AnchorPoint = { x: number; y: number };

const VIEWPORT_MARGIN = 8;

/** Push `anchor` back inside the viewport by the measured box (`width` /
 *  `height`), so a popover opened near an edge never grows off-screen — a
 *  hand card sits at the bottom, so an anchor at the card's top would
 *  otherwise grow the popup past the bottom edge with no way to reach the
 *  lower rows. Pure layout, CR-agnostic.
 *
 *  Shared by every anchored popover in the board: the `AnchoredPicker`
 *  primitive below AND `ManaChoicePicker` (`board/mana-choice-picker.tsx`),
 *  which borrows only this positioning half — its pip-shaped rows don't fit
 *  `AnchoredPickerRow`'s list-row shape, so it keeps its own markup and its
 *  own centred-when-no-pointer variant. */
// eslint-disable-next-line react-refresh/only-export-components
export function clampToViewport(
    anchor: AnchorPoint,
    width: number,
    height: number,
    margin: number = VIEWPORT_MARGIN
): AnchorPoint {
    const maxLeft = window.innerWidth - width - margin;
    const maxTop = window.innerHeight - height - margin;
    return {
        x: Math.max(margin, Math.min(anchor.x, maxLeft)),
        y: Math.max(margin, Math.min(anchor.y, maxTop)),
    };
}

/** Measures the portal's content node after layout and clamps `position`
 *  inside the viewport (`clampToViewport`). `sizeDep` is any value that
 *  changes the rendered box's size (row count, choice count, …) — it must be
 *  passed so a picker whose content grows/shrinks re-clamps. */
// eslint-disable-next-line react-refresh/only-export-components
export function useClampedPortalPosition(
    position: AnchorPoint,
    sizeDep: number
): { ref: RefObject<HTMLDivElement | null>; style: AnchorPoint } {
    const ref = useRef<HTMLDivElement>(null);
    const [clamped, setClamped] = useState(position);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        setClamped(clampToViewport(position, width, height));
        // `position.x`/`position.y` (not the object) so a caller passing a
        // fresh `{x,y}` literal every render doesn't re-run this on every
        // paint; `sizeDep` covers a content-size change at the same anchor.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [position.x, position.y, sizeDep]);
    return { ref, style: clamped };
}

/** ESC closes the popover — the board-wide "ESC dismisses the open overlay"
 *  UX (see `data-slot="dialog-content"` below, which is what the board's
 *  global ESC handler keys off to skip opening the pause menu instead). */
// eslint-disable-next-line react-refresh/only-export-components
export function useEscapeToCancel(onCancel: () => void): void {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            onCancel();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onCancel]);
}

export type AnchoredPickerRowProps = {
    onSelect: () => void;
    children: ReactNode;
    className?: string;
    "data-testid"?: string;
};

/** One popover row (ADR 0103 §5 — "Popovers and menus get 44px rows"):
 *  `min-h-[var(--menu-row-h)]` is a FLOOR, not a fixed height, so a
 *  two-line row (label + oracle-text hint) still grows past it instead of
 *  clipping. Shared by every `AnchoredPicker` row across mode / alt-cost /
 *  Phyrexian / additional-cost. */
export function AnchoredPickerRow({
    onSelect,
    children,
    className,
    ...rest
}: AnchoredPickerRowProps) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                "flex min-h-[var(--menu-row-h)] w-full cursor-pointer flex-col items-start justify-center gap-0.5 rounded-sm border border-transparent px-3 py-1.5 text-left transition-colors hover:border-border-subtle hover:bg-surface-elevated",
                className
            )}
            {...rest}
        >
            {children}
        </button>
    );
}

export type AnchoredPickerProps = {
    position: AnchorPoint;
    /** Re-clamp when this changes — pass the row/choice count. */
    rowCount: number;
    onCancel: () => void;
    title?: ReactNode;
    subtitle?: ReactNode;
    children: ReactNode;
    /** Extra classes on the Panel (e.g. a wider `min-w`). */
    className?: string;
};

/** Shared chrome for every anchored cast-time picker (mode CR 700.2, alt-cost
 *  CR 118.9, Phyrexian CR 107.4f, additional-cost CR 601.2b): a `modal-scrim`
 *  backdrop + a fixed portal clamped inside the viewport
 *  (`useClampedPortalPosition`), ESC-to-cancel, the hairline `Panel` frame,
 *  and an optional title/subtitle header over a hairline rule.
 *
 *  Extracted on the FOURTH near-identical copy (issue #2731) —
 *  `mode-picker.tsx`'s `ModePickerPortal`, `alt-cost-picker.tsx`,
 *  `phyrexian-picker.tsx` and `additional-cost-picker.tsx` each carried its
 *  own portal, its own `useLayoutEffect` viewport clamp and its own
 *  hand-rolled row markup — every one of them commented "Modeled on
 *  ModePicker"/"Modeled on AltCostPicker". Rows are `AnchoredPickerRow`
 *  children so each picker still owns its own row CONTENT (a colour pip, the
 *  "Pay mana cost" fallback row, a `data-testid`, …); only the popover shell
 *  is shared.
 *
 *  Every picker now shows the `modal-scrim` backdrop (previously only
 *  Phyrexian's and `ManaChoicePicker`'s did — mode/alt-cost/additional-cost
 *  had a fully transparent click-catcher, the same class of bug
 *  `modal-scrim.guard.test.ts` already fixed for the other two: without the
 *  blur the live board bleeds through an open picker). */
export default function AnchoredPicker({
    position,
    rowCount,
    onCancel,
    title,
    subtitle,
    children,
    className,
}: AnchoredPickerProps) {
    useEscapeToCancel(onCancel);
    const { ref, style } = useClampedPortalPosition(position, rowCount);

    return createPortal(
        <>
            <div
                className="fixed inset-0 z-hud modal-scrim"
                onMouseDown={onCancel}
            />
            {/* `Panel` forwards no props, so the positioning `style`, the
                clamp-measure `ref` and the board-ESC `data-slot` tag stay on
                a plain fixed wrapper; Panel supplies the chrome (hairline +
                material) inside it. */}
            <div
                ref={ref}
                data-slot="dialog-content"
                className="fixed z-modal"
                style={{ left: style.x, top: style.y }}
            >
                <Panel
                    density="compact"
                    className={cn(
                        "flex max-h-[calc(100dvh-16px)] min-w-64 flex-col gap-[var(--menu-row-gap)] overflow-y-auto p-4",
                        className
                    )}
                >
                    {(title || subtitle) && (
                        <div className="mb-1 flex flex-col gap-0.5 px-2">
                            {title && (
                                <p className="text-display text-sm text-parchment">
                                    {title}
                                </p>
                            )}
                            {subtitle && (
                                <p className="text-xs text-text-disabled">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    )}
                    {(title || subtitle) && (
                        <div className="mb-1 h-px w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent" />
                    )}
                    {children}
                </Panel>
            </div>
        </>,
        document.body
    );
}
