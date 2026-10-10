// PROTOTYPE — throwaway. Card-size slider (small card ↔ big card glyphs).
import { ZoomIn, ZoomOut } from "lucide-react";

export default function ZoomSlider({
    value,
    onChange,
}: {
    value: number;
    onChange: (v: number) => void;
}) {
    return (
        <label className="flex items-center gap-2 text-text-muted">
            <ZoomOut className="size-4 shrink-0" aria-hidden />
            <input
                type="range"
                min={70}
                max={220}
                step={5}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                aria-label="Card size"
                className="h-1 w-24 cursor-pointer accent-[var(--color-accent)] sm:w-32"
            />
            <ZoomIn className="size-4 shrink-0" aria-hidden />
        </label>
    );
}
