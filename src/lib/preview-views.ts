/** Which face of a card a preview surface is showing. */
export type CardPreviewMode = "computed" | "printed";

/** What a preview mount can SHOW: the persisted modes plus the on-demand
 *  `rulings` view (issue #4816), which is never a Settings default. */
export type CardPreviewView = CardPreviewMode | "rulings";

/** The views the toggle offers, in tab order. */
export function previewViewsOf(
    showRulings: boolean,
    hideComputed: boolean
): CardPreviewView[] {
    return [
        ...(hideComputed ? [] : (["computed"] as const)),
        "printed",
        ...(showRulings ? (["rulings"] as const) : []),
    ];
}

/** The view one ←/→ step away, wrapping at both ends. */
export function cyclePreviewView(
    views: readonly CardPreviewView[],
    current: CardPreviewView,
    step: 1 | -1
): CardPreviewView {
    const idx = Math.max(0, views.indexOf(current));
    return views[(idx + step + views.length) % views.length];
}
