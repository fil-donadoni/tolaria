import { useCallback, useEffect, useRef, useState } from "react";

// Draggable horizontal split ratio for a two-pane deckbuilder surface. Stores
// the *fraction of width given to the LEFT (Maindeck) pane* and persists it
// per-zone in localStorage, mirroring the per-zone persistence of
// `useCardZoom`. The right (Sideboard) pane fills the remainder, so the default
// 0.667 yields the requested 2/3 main · 1/3 side split.
const STORAGE_PREFIX = "tolaria:deckbuilderSplit:";
const MIN = 0.2;
const MAX = 0.8;
const KEY_STEP = 0.02;

function clamp(n: number): number {
    return Math.min(MAX, Math.max(MIN, n));
}

function read(zone: string, fallback: number): number {
    try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + zone);
        if (raw === null) return fallback;
        const n = Number.parseFloat(raw);
        if (Number.isNaN(n)) return fallback;
        return clamp(n);
    } catch {
        return fallback;
    }
}

export function useSplitRatio(zone: string, initial: number) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [ratio, setRatio] = useState(() => read(zone, initial));
    const dragging = useRef(false);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_PREFIX + zone, String(ratio));
        } catch {
            // best-effort persistence
        }
    }, [zone, ratio]);

    const updateFromClientX = useCallback((clientX: number) => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        setRatio(clamp((clientX - rect.left) / rect.width));
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }, []);

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!dragging.current) return;
            updateFromClientX(e.clientX);
        },
        [updateFromClientX]
    );

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        dragging.current = false;
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }, []);

    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            setRatio((r) => clamp(r - KEY_STEP));
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setRatio((r) => clamp(r + KEY_STEP));
        }
    }, []);

    return {
        containerRef,
        ratio,
        dividerProps: {
            role: "separator" as const,
            "aria-orientation": "vertical" as const,
            "aria-valuemin": Math.round(MIN * 100),
            "aria-valuemax": Math.round(MAX * 100),
            "aria-valuenow": Math.round(ratio * 100),
            tabIndex: 0,
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onKeyDown,
        },
    };
}
