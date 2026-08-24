import { CURVE_LABELS } from "~/lib/deckStats";

/**
 * The bottom bar's MINI CURVE (issue #2584): the Stats dialog's mana curve
 * reduced to a ~24px sparkline, so the shape of the deck is readable without
 * opening a dialog on a screen that has no room for one.
 *
 * Same input as `DeckStatsCurveChart` (`DeckStats.curve`, lands excluded,
 * already bucketed by `computeDeckStats`) and the same single piece of
 * arithmetic — bar height as a fraction of the tallest bucket. It is a
 * separate component rather than a `size` prop on that chart because the two
 * differ in what they DROP: this one has no axis labels and no per-bar text,
 * which is the whole reason it fits.
 */
export default function DeckMiniCurve({ curve }: { curve: number[] }) {
    const max = Math.max(1, ...curve);
    const total = curve.reduce((sum, n) => sum + n, 0);
    if (total === 0) return null;
    return (
        <div
            role="group"
            aria-label="Maindeck mana curve"
            className="flex h-6 shrink-0 items-end gap-0.5"
        >
            {curve.map((count, index) => (
                // No `aria-label` (issue #2671): a bare `<span>` has no
                // implicit role, and axe's `aria-prohibited-attr` rule flags
                // `aria-label` on an element whose role doesn't support
                // accessible naming — this shape only ever renders once a
                // populated deck exists, which the browser-verification
                // lane's own fixture never seeded before this issue. The
                // parent `role="group"` above already names the whole
                // sparkline; `title` stays as the sighted-hover per-bucket
                // detail, the same tradeoff `DeckStatsCurveChart` (the full
                // Stats dialog chart this is a reduced twin of) already
                // makes for its own bars.
                <span
                    key={CURVE_LABELS[index]}
                    title={`${CURVE_LABELS[index]}: ${count}`}
                    className="w-1 rounded-t-[1px] bg-accent/70"
                    style={{
                        // A floor of 2px keeps an empty bucket visible as a
                        // gap in the shape rather than as nothing at all.
                        height: `${Math.max(2, Math.round((count / max) * 24))}px`,
                    }}
                />
            ))}
        </div>
    );
}
