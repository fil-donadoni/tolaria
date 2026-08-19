// PROTOTYPE — throwaway. Floating variant switcher: a high-contrast pill at
// bottom-centre with ‹ / › arrows and a label. Cycles the `?variant=` search
// param (shareable, reload-stable) and mirrors it to the ← / → arrow keys.
// Hidden in production builds so a stray merge can't ship it.
import { useEffect } from "react";

export type VariantEntry = { key: string; name: string };

export default function PrototypeSwitcher({
    variants,
    current,
    onChange,
    extra,
}: {
    variants: VariantEntry[];
    current: string;
    onChange: (key: string) => void;
    /** Optional second row (e.g. surface tabs). */
    extra?: React.ReactNode;
}) {
    const idx = Math.max(
        0,
        variants.findIndex((v) => v.key === current)
    );
    const go = (delta: number) => {
        const next = (idx + delta + variants.length) % variants.length;
        onChange(variants[next].key);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = document.activeElement;
            if (
                el instanceof HTMLInputElement ||
                el instanceof HTMLTextAreaElement ||
                (el instanceof HTMLElement && el.isContentEditable)
            )
                return;
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (import.meta.env.PROD) return null;

    const active = variants[idx];
    return (
        <div className="fixed top-1 left-1 z-[9999] flex flex-col items-start gap-1 opacity-90">
            {extra}
            <div className="flex items-center gap-1 rounded-full bg-white px-1.5 py-1 text-neutral-900 shadow-[0_6px_24px_rgba(0,0,0,0.5)] ring-1 ring-black/20">
                <button
                    type="button"
                    onClick={() => go(-1)}
                    className="h-7 w-7 rounded-full text-base leading-none hover:bg-neutral-200"
                    aria-label="Previous variant"
                >
                    ‹
                </button>
                <span className="min-w-[9rem] text-center text-[11px] font-semibold tabular-nums">
                    {active.key} — {active.name}
                </span>
                <button
                    type="button"
                    onClick={() => go(1)}
                    className="h-7 w-7 rounded-full text-base leading-none hover:bg-neutral-200"
                    aria-label="Next variant"
                >
                    ›
                </button>
            </div>
        </div>
    );
}
