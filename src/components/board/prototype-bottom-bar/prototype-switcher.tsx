import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { isEditableTarget } from "~/lib/editable-target";

const VARIANTS: { key: string; name: string }[] = [
    { key: "a", name: "Steady grid" },
    { key: "b", name: "Morphing CTA" },
    { key: "c", name: "Tab bar" },
    { key: "d", name: "Refined fusion" },
];

/** PROTOTYPE — throwaway (bottom-bar redesign audit 2026-07-28).
 *
 *  Floating variant switcher, pinned TOP-centre (the bottom edge is the thing
 *  being prototyped). Arrows / ← → cycle variants via the `?variant=` search
 *  param (replaceState, reload-stable); X exits back to the real bar. Dev-only:
 *  the gate never mounts this in production builds. */
export default function PrototypeSwitcher({
    current,
    onChange,
    onExit,
}: {
    current: string;
    onChange: (key: string) => void;
    onExit: () => void;
}) {
    const idx = Math.max(
        0,
        VARIANTS.findIndex((v) => v.key === current)
    );
    const cycle = (dir: 1 | -1) =>
        onChange(VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length].key);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (isEditableTarget(e.target)) return;
            if (e.key === "ArrowLeft") cycle(-1);
            if (e.key === "ArrowRight") cycle(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    return (
        <div className="fixed left-1/2 top-1/2 z-[100] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-fuchsia-400 bg-black/90 px-2 py-1 text-xs text-white shadow-xl">
            <button
                type="button"
                aria-label="Previous variant"
                onClick={() => cycle(-1)}
                className="p-1"
            >
                <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[7.5rem] text-center font-mono">
                {VARIANTS[idx].key.toUpperCase()} — {VARIANTS[idx].name}
            </span>
            <button
                type="button"
                aria-label="Next variant"
                onClick={() => cycle(1)}
                className="p-1"
            >
                <ChevronRight className="h-4 w-4" />
            </button>
            <button
                type="button"
                aria-label="Exit prototype"
                onClick={onExit}
                className="ml-1 p-1 text-fuchsia-300"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
