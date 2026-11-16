import { useEffect, useRef, type RefObject } from "react";

/**
 * Backdrop press dismisses the TOPMOST game dialog when dialogs are stacked
 * (issue #9819). A nested base-ui dialog renders no scrim of its own, and a
 * press on the parent's shared scrim is not treated as "outside" by the
 * nested one; before the Popup was sized to its panel, the nested dialog's
 * oversized Popup swallowed that click and emulated the dismissal. A single
 * dialog needs nothing: base-ui's own outside-press handles it, and acting
 * here as well would fire `onDismiss` twice.
 */
export default function useNestedBackdropDismiss(
    open: boolean,
    popupRef: RefObject<HTMLElement | null>,
    onDismiss: () => void
): void {
    const dismiss = useRef(onDismiss);
    useEffect(() => {
        dismiss.current = onDismiss;
    });
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (target?.getAttribute?.("data-slot") !== "dialog-overlay")
                return;
            const popups = document.querySelectorAll(
                '[data-slot="dialog-content"][data-open]'
            );
            if (popups.length < 2) return;
            if (popups[popups.length - 1] !== popupRef.current) return;
            dismiss.current();
        };
        document.addEventListener("click", onClick);
        return () => document.removeEventListener("click", onClick);
    }, [open, popupRef]);
}
