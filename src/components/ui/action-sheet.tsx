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
            className={`fixed inset-0 z-100 transition-colors duration-200 ${animIn ? "bg-black/50" : "bg-transparent"}`}
            onClick={handleClose}
            onTouchEnd={(e) => {
                e.preventDefault();
                handleClose();
            }}
        >
            <div
                className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-zinc-900/95 backdrop-blur-sm shadow-2xl transition-transform duration-200"
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
                    <div className="w-10 h-1 rounded-full bg-zinc-600" />
                </div>
                <div className="px-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
                    {items.map((item) => (
                        <button
                            key={item.key}
                            className="w-full text-left px-4 py-3 min-h-12 text-sm text-zinc-100 rounded-lg active:bg-zinc-700/50 transition-colors"
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
