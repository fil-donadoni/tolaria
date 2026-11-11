import { useEffect } from "react";

interface RatingKeys {
    enabled: boolean;
    rating: number;
    disabled: boolean;
    onRate: (rating: number) => void;
    onNext: () => void;
    onPrev: (() => void) | null;
    onSwitchTab: () => void;
}

/** The dialog's keyboard: 0–5 set, +/− nudge, ↵ or j next, k prev, p tab.
 *  Typing in a field and activating a focused button are left alone. */
export function useRatingKeys(keys: RatingKeys): void {
    useEffect(() => {
        if (!keys.enabled) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target;
            if (
                target instanceof Element &&
                target.closest(
                    "input, textarea, select, [contenteditable], button, [role=button], [role=radio]"
                )
            )
                return;
            const { rating, disabled } = keys;
            if (/^[0-5]$/.test(event.key)) {
                if (!disabled) keys.onRate(Number(event.key));
            } else if (event.key === "+" || event.key === "=") {
                if (!disabled) keys.onRate(Math.min(5, rating + 0.5));
            } else if (event.key === "-") {
                if (!disabled) keys.onRate(Math.max(0, rating - 0.5));
            } else if (event.key === "j" || event.key === "Enter") {
                event.preventDefault();
                keys.onNext();
            } else if (event.key === "k") {
                keys.onPrev?.();
            } else if (event.key === "p") {
                keys.onSwitchTab();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });
}
