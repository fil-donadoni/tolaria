import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ActionSheetItem = {
    key: string;
    label: React.ReactNode;
    onSelect: (e: React.MouseEvent | React.TouchEvent) => void;
};

type ActionSheetProps = {
    open: boolean;
    onClose: () => void;
    items: ActionSheetItem[];
};

const SWIPE_DISMISS_PX = 60;

export default function ActionSheet({
    open,
    onClose,
    items,
}: ActionSheetProps) {
    const [animIn, setAnimIn] = useState(false);
    const [translateY, setTranslateY] = useState(0);
    const swipeStart = useRef<number | null>(null);

    const backdropRef = useCallback((node: HTMLDivElement | null) => {
        if (node) {
            requestAnimationFrame(() => setAnimIn(true));
        }
    }, []);

    const handleClose = useCallback(() => {
        setAnimIn(false);
        setTranslateY(0);
        setTimeout(onClose, 200);
    }, [onClose]);

    const onSwipeStart = useCallback((e: React.TouchEvent) => {
        swipeStart.current = e.touches[0].clientY;
    }, []);

    const onSwipeMove = useCallback((e: React.TouchEvent) => {
        if (swipeStart.current === null) return;
        const dy = e.touches[0].clientY - swipeStart.current;
        if (dy > 0) setTranslateY(dy);
    }, []);

    const onSwipeEnd = useCallback(() => {
        if (translateY > SWIPE_DISMISS_PX) {
            handleClose();
        } else {
            setTranslateY(0);
        }
        swipeStart.current = null;
    }, [translateY, handleClose]);

    if (!open) return null;

    return createPortal(
        <div
            ref={backdropRef}
            // Queryable handle (issue #2584) — the sheet portals to
            // `document.body`, so a test scoping a click to it has nothing
            // else to select on.
            data-action-sheet
            // `modal-scrim` (#1891): shared scrim + heavy backdrop blur. The
            // `transition-colors` still animates the scrim COLOR in; the blur
            // itself pops (backdrop-filter is not color-transitionable) —
            // accepted, the sheet slides in over it in the same frame.
            className={`z-modal fixed inset-0 transition-colors duration-200 ${animIn ? "modal-scrim" : "bg-transparent"}`}
            onClick={handleClose}
            onTouchEnd={(e) => {
                e.preventDefault();
                handleClose();
            }}
        >
            <div
                // v4 (ADR 0103 §5, issue #2731): the hairline frame's top
                // edge, so the sheet reads as the same material as every
                // other re-skinned surface instead of a bare elevated box.
                className="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-[var(--hairline)] bg-surface backdrop-blur-sm shadow-2xl transition-transform duration-200"
                style={{
                    transform: animIn
                        ? `translateY(${translateY}px)`
                        : "translateY(100%)",
                }}
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onTouchStart={onSwipeStart}
                onTouchMove={onSwipeMove}
                onTouchEndCapture={onSwipeEnd}
            >
                <div className="flex justify-center py-3">
                    <div className="w-10 h-1 rounded-full bg-[var(--hairline-strong)]" />
                </div>
                <div className="flex flex-col gap-[var(--menu-row-gap)] px-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
                    {items.map((item) => (
                        <button
                            key={item.key}
                            // `--menu-row-h` (44px, ADR 0103 §5) — a MIN, so a
                            // wrapping label still grows the row.
                            className="w-full min-h-[var(--menu-row-h)] text-left px-4 py-3 text-sm text-text rounded-lg active:bg-surface-elevated transition-colors"
                            onClick={(e) => {
                                item.onSelect(e);
                                handleClose();
                            }}
                            onTouchEnd={(e) => {
                                e.stopPropagation();
                                item.onSelect(e);
                                handleClose();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body
    );
}
