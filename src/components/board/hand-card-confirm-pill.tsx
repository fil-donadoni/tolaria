import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TAP_STAGE_KEEP_ATTR } from "~/hooks/useTapStageConfirm";

/** Gap (px) between the top of the staged card and the bottom of the pill. */
const ANCHOR_GAP_PX = 10;
/** Viewport margin the pill is clamped inside. */
const MARGIN_PX = 8;

/** Confirm affordance for a STAGED hand card on touch (issue #1767).
 *
 * The second half of "tap = stage, tap again = confirm": pressing this pill
 * commits the staged play/cast, exactly as a second tap on the card itself
 * does. It exists so the confirmation is a real, unambiguous target rather than
 * a second tap on a card that may be only a few millimetres wide in the
 * portrait hand — `min-h-11` / `min-w-24` keep it at or above the 44px touch
 * target floor.
 *
 * Rendered through a PORTAL, not inside the card. The hand strip clips the band
 * directly above it (the same clip the drag lift is clamped against, #271
 * fix 4), so a pill nested in the card would be invisible on exactly the layout
 * that needs it most. It carries {@link TAP_STAGE_KEEP_ATTR} so the staging
 * hook's tap-away listener treats a press on it as part of the stage instead of
 * a cancel — without that marker the pill would un-stage itself on pointerdown
 * and unmount before its own click could fire. */
export default function HandCardConfirmPill({
    anchorRef,
    label,
    onConfirm,
}: {
    /** The staged card element the pill is positioned above. */
    anchorRef: React.RefObject<HTMLElement | null>;
    /** "Play" for a land drop (CR 305), "Cast" for a spell (CR 601). */
    label: string;
    onConfirm: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
    const pillRef = useRef<HTMLButtonElement | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    // Measure after layout so the pill is centred on the card and fully inside
    // the viewport — a card at the left or right edge of the portrait hand fan
    // would otherwise push it off-screen.
    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const pill = pillRef.current;
        if (!anchor || !pill) return;
        const a = anchor.getBoundingClientRect();
        const p = pill.getBoundingClientRect();
        const maxLeft = Math.max(
            MARGIN_PX,
            window.innerWidth - p.width - MARGIN_PX
        );
        const left = Math.min(
            Math.max(MARGIN_PX, a.left + a.width / 2 - p.width / 2),
            maxLeft
        );
        const top = Math.max(MARGIN_PX, a.top - p.height - ANCHOR_GAP_PX);
        setPos({ left, top });
    }, [anchorRef, label]);

    // React bubbles portal events through the COMPONENT tree, so every gesture
    // on this pill would otherwise also reach the card's own drag / click
    // handlers — and the card's click handler would re-stage the card the
    // instant the pill un-staged it. The pill owns its gestures outright.
    return createPortal(
        <button
            ref={pillRef}
            type="button"
            {...{ [TAP_STAGE_KEEP_ATTR]: "" }}
            data-hand-confirm-pill=""
            className="fixed z-modal min-h-11 min-w-24 rounded-full border border-accent-strong bg-accent px-5 text-sm font-beleren tracking-wide text-surface-base shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
            style={{
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                visibility: pos ? undefined : "hidden",
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.stopPropagation();
                onConfirm(e);
            }}
        >
            {label}
        </button>,
        document.body
    );
}
