// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-zoom=B`). Never merge.
// Variant B: no slider, no number. Three named intents instead:
//   Fit all — the whole pack on screen at once, no scrolling
//   Large   — the proposed bigger default (1.5×), the grid may scroll
//   Read    — ONE horizontal row at the largest size, oracle text legible
// The pack grid is reshaped through an injected <style> (an `!important`
// author rule beats the grid's inline template), so the real grid component
// is untouched.
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

type Mode = "fit" | "large" | "read";
const MODES: { key: Mode; label: string; hint: string }[] = [
    { key: "fit", label: "Fit all", hint: "Whole pack, no scrolling" },
    { key: "large", label: "Large", hint: "Bigger cards, grid scrolls" },
    { key: "read", label: "Read", hint: "One row, biggest" },
];

const GAP = 12;
/** The Pool band's own floor under the Booster (`min-h-[17.5rem]`) + chrome. */
const POOL_RESERVE = 280 + 2 * GAP;
const CHROME_RESERVE = 96;

/** Fewest columns at which `count` 5:7 cards fit `width` x `height`. */
function fitColumns(count: number, width: number, height: number): number {
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const cardH = ((width - GAP * (cols - 1)) / cols) * (7 / 5);
        if (rows * cardH + GAP * (rows - 1) <= height) return cols;
    }
    return Math.max(1, count);
}

export default function PrototypeZoomFitModes({
    packSize,
}: {
    packSize: number;
}) {
    const [mode, setMode] = useState<Mode>("large");
    const [columns, setColumns] = useState<number | null>(null);

    useEffect(() => {
        if (mode !== "fit") return;
        const surface = document.querySelector('[data-slot="draft-surface"]');
        if (!surface) return;
        const measure = () => {
            const band = document.querySelector(
                '[data-slot="draft-stacked-booster"]'
            );
            const pool = document.querySelector(
                '[data-slot="draft-stacked-pool"]'
            );
            const width = band?.clientWidth ?? surface.clientWidth;
            const height =
                surface.clientHeight -
                CHROME_RESERVE -
                (pool ? POOL_RESERVE : 0);
            setColumns(fitColumns(packSize, width, Math.max(height, 120)));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(surface);
        return () => observer.disconnect();
    }, [mode, packSize]);

    const css =
        mode === "fit" && columns !== null
            ? `[data-slot="draft-pack-grid"] { grid-template-columns: repeat(${columns}, minmax(0, 1fr)) !important; }`
            : mode === "read"
              ? `[data-slot="draft-pack-grid"] {
    display: flex !important;
    overflow-x: auto;
    padding: 4px 4px 12px;
    scroll-snap-type: x proximity;
}
[data-slot="draft-pack-grid"] > li {
    flex: 0 0 clamp(14rem, 24vw, 22rem);
    scroll-snap-align: start;
}`
              : "";

    return (
        <div
            data-prototype="zoom-fit-modes"
            role="radiogroup"
            aria-label="Booster card size"
            className="flex shrink-0 overflow-hidden rounded-sm border border-border-accent/50"
        >
            {MODES.map((m) => (
                <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.key}
                    title={m.hint}
                    onClick={() => setMode(m.key)}
                    className={cn(
                        "min-h-[var(--control-h)] px-4 text-sm font-semibold transition-colors",
                        mode === m.key
                            ? "bg-accent-strong/25 text-parchment"
                            : "text-text-muted hover:text-parchment"
                    )}
                >
                    {m.label}
                </button>
            ))}
            {css && <style>{css}</style>}
        </div>
    );
}
