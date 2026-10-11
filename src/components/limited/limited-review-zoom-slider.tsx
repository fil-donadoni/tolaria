import { ZoomIn, ZoomOut } from "lucide-react";

export const REVIEW_ZOOM_MIN = 70;
export const REVIEW_ZOOM_MAX = 220;
export const REVIEW_ZOOM_DEFAULT = 120;

/** The review's card-size slider (issue #5392): small ↔ big card glyphs around
 *  a native range, value in px of card width. */
export default function LimitedReviewZoomSlider({
    value,
    onChange,
}: {
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="flex items-center gap-2 text-text-muted">
            <ZoomOut className="size-4 shrink-0" aria-hidden />
            <input
                type="range"
                min={REVIEW_ZOOM_MIN}
                max={REVIEW_ZOOM_MAX}
                step={5}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                aria-label="Card size"
                className="h-1 w-24 cursor-pointer accent-(--color-accent) sm:w-32"
            />
            <ZoomIn className="size-4 shrink-0" aria-hidden />
        </label>
    );
}
