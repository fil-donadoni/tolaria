/* eslint-disable -- PROTOTYPE, throwaway branch */
// PROTOTYPE — throwaway (player-feedback 2026-11). Lives only on branch
// prototype/player-feedback-2026-11; never merge to the base.
//
// One floating bar per prototyped surface. Each surface owns a URL param
// (`?pv-<surface>=<key>`); with no param the real component renders untouched.
// Several bars stack at the bottom-left; ←/→ cycle the bar marked `primary`.
import { useEffect, useSyncExternalStore } from "react";

export interface PrototypeVariant {
    key: string;
    label: string;
}

const EVENT = "prototype-variant-change";

function subscribe(cb: () => void): () => void {
    window.addEventListener(EVENT, cb);
    window.addEventListener("popstate", cb);
    return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("popstate", cb);
    };
}

export function usePrototypeVariant(param: string): string | null {
    const value = useSyncExternalStore(
        subscribe,
        () => new URLSearchParams(window.location.search).get(param),
        () => null
    );
    return import.meta.env.DEV ? value : null;
}

export function setPrototypeVariant(param: string, key: string | null): void {
    const url = new URL(window.location.href);
    if (key == null) url.searchParams.delete(param);
    else url.searchParams.set(param, key);
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(EVENT));
}

interface Props {
    title: string;
    param: string;
    variants: PrototypeVariant[];
    /** Stack slot, 0 = lowest bar. */
    slot?: number;
    primary?: boolean;
}

export function PrototypeSwitcher({
    title,
    param,
    variants,
    slot = 0,
    primary = false,
}: Props) {
    const current = usePrototypeVariant(param);
    // "off" = the real, unmodified component.
    const keys = ["off", ...variants.map((v) => v.key)];
    const idx = Math.max(0, keys.indexOf(current ?? "off"));
    const cycle = (d: number) => {
        const next = keys[(idx + d + keys.length) % keys.length];
        setPrototypeVariant(param, next === "off" ? null : next);
    };

    useEffect(() => {
        if (!primary) return;
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (
                t &&
                (t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.isContentEditable)
            )
                return;
            if (!e.altKey) return;
            if (e.key === "ArrowLeft") cycle(-1);
            if (e.key === "ArrowRight") cycle(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (!import.meta.env.DEV) return null;
    const label =
        idx === 0
            ? "off (current)"
            : `${keys[idx]} — ${variants[idx - 1].label}`;
    return (
        <div
            data-prototype-switcher={param}
            style={{
                position: "fixed",
                left: 12,
                bottom: 12 + slot * 44,
                zIndex: 2147483000,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 999,
                background: "#ff00aa",
                color: "white",
                font: "600 12px/1.2 system-ui, sans-serif",
                boxShadow: "0 4px 16px rgba(0,0,0,.5)",
            }}
        >
            <span style={{ opacity: 0.8 }}>{title}</span>
            <button
                type="button"
                onClick={() => cycle(-1)}
                aria-label="Previous variant"
            >
                ◀
            </button>
            <span style={{ minWidth: 160, textAlign: "center" }}>{label}</span>
            <button
                type="button"
                onClick={() => cycle(1)}
                aria-label="Next variant"
            >
                ▶
            </button>
        </div>
    );
}
