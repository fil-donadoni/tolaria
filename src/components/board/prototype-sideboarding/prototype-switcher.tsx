// PROTOTYPE — throwaway. Floating variant switcher (prototype skill, UI
// branch): ← label →, arrow keys cycle, URL ?variant= is the truth.
import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function PrototypeSwitcher({
    variants,
    current,
    onChange,
}: {
    variants: { key: string; name: string }[];
    current: string;
    onChange: (key: string) => void;
}) {
    const i = Math.max(
        0,
        variants.findIndex((v) => v.key === current)
    );
    const go = (d: number) =>
        onChange(variants[(i + d + variants.length) % variants.length].key);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (
                t instanceof Element &&
                t.closest("input, textarea, select, [contenteditable]")
            )
                return;
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
        };
        // Capture: an open dialog must not swallow the arrows.
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });

    if (!import.meta.env.DEV) return null;
    // Portal: above an open dialog's backdrop, out of the page's stacking context.
    return createPortal(
        <div
            style={{ zIndex: 99999 }}
            className="fixed bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-600 px-4 py-1 text-sm font-semibold text-white shadow-lg"
        >
            <button type="button" onClick={() => go(-1)}>
                ←
            </button>
            <span>
                {variants[i].key} ({variants[i].name})
            </span>
            <button type="button" onClick={() => go(1)}>
                →
            </button>
        </div>,
        document.body
    );
}
