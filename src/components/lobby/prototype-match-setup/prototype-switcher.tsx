// PROTOTYPE — throwaway. Floating variant switcher (mattpocock prototype
// skill, UI branch): ← label →, arrow keys cycle, URL ?variant= is the truth.
import { useEffect } from "react";

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
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (!import.meta.env.DEV) return null;
    return (
        <div className="fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-600 px-4 py-1.5 text-sm font-semibold text-white shadow-lg">
            <button type="button" onClick={() => go(-1)}>
                ←
            </button>
            <span>
                {variants[i].key} ({variants[i].name})
            </span>
            <button type="button" onClick={() => go(1)}>
                →
            </button>
        </div>
    );
}
