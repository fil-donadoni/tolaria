import { ZOOM_STEP } from "./useCardZoom";

interface CardZoomSliderProps {
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
    /** Accessible label, e.g. "Maindeck card size". */
    label: string;
}

/** MTGO-style card-size control: a small-card glyph, a range slider, a
 *  large-card glyph. Drives a per-zone zoom multiplier. */
export default function CardZoomSlider({
    value,
    min,
    max,
    onChange,
    label,
}: CardZoomSliderProps) {
    return (
        <label
            className="flex items-center gap-1.5 text-text-muted"
            title={label}
        >
            <span className="text-[10px] leading-none" aria-hidden>
                ▪
            </span>
            <input
                type="range"
                min={min}
                max={max}
                step={ZOOM_STEP}
                value={value}
                aria-label={label}
                onChange={(e) => onChange(Number.parseFloat(e.target.value))}
                className="h-1 w-24 cursor-pointer accent-accent"
            />
            <span className="text-sm leading-none" aria-hidden>
                ▪
            </span>
        </label>
    );
}
