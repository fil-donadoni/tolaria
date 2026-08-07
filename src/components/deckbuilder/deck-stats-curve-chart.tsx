import { CURVE_LABELS } from "~/lib/deckStats";

/** Chart height budget in px — bars scale to a fraction of this, never a raw
 *  chromatic value; only layout arithmetic (PRD #1617, issue #1631). */
const CHART_HEIGHT_PX = 72;

export interface DeckStatsCurveChartProps {
    /** `DeckStats.curve` as-is — lands already excluded, `{X}` already 0
     *  (`computeDeckStats`, `src/lib/deckStats.ts`). This component does no
     *  counting, only bar-height layout. */
    curve: number[];
}

/**
 * The Maindeck's mana curve (PRD #1617 § "Stats dialog"): one bar per
 * {@link CURVE_LABELS} bucket (mana value 0..6, plus a 7+ catch-all), height
 * proportional to the bucket's count. All counting already happened in
 * `computeDeckStats` — the only arithmetic here is the bar height as a
 * fraction of the tallest bucket.
 */
export default function DeckStatsCurveChart({
    curve,
}: DeckStatsCurveChartProps) {
    const max = Math.max(1, ...curve);

    return (
        // `role="group"` rather than `role="img"` (issue #1631 fixup F5):
        // `img` removes every descendant from the accessibility tree, so a
        // screen-reader user got the chart's existence and none of its
        // per-bucket counts (the `title` attributes below are sighted-hover
        // only). `group` keeps the label AND exposes each bar's own
        // accessible text.
        <div
            role="group"
            aria-label="Mana curve by mana value, lands excluded"
            className="flex items-end gap-1.5"
        >
            {curve.map((count, i) => (
                <div
                    key={CURVE_LABELS[i]}
                    className="flex flex-1 flex-col items-center gap-1"
                    title={`Mana value ${CURVE_LABELS[i]}: ${count} card${count === 1 ? "" : "s"}`}
                >
                    <span className="text-xs text-text-muted">{count}</span>
                    <div
                        className="w-full rounded-t-sm bg-accent"
                        style={{
                            height: `${Math.round((count / max) * CHART_HEIGHT_PX)}px`,
                        }}
                    />
                    <span className="text-[10px] tracking-wide text-text-muted">
                        {CURVE_LABELS[i]}
                    </span>
                </div>
            ))}
        </div>
    );
}
