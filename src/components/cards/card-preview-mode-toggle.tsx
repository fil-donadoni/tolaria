/** Which face of a card a preview surface is showing. */
export type CardPreviewMode = "computed" | "printed";

/** What a preview mount can SHOW: the persisted modes plus the on-demand
 *  `rulings` view (issue #4816), which is never a Settings default. */
export type CardPreviewView = CardPreviewMode | "rulings";

/** Phase-2 toggle (winner B): the computed live-text face is the default
 *  (modern oracle, granted/lost abilities, effective P/T); the "printed" face
 *  shows the original printing as-is. Hidden by its hosts when the card has no
 *  printed identity (tokens).
 *
 *  Two hosts, two vocabularies (PRD #2405): in a game the computed face is
 *  LIVE text (it reflects what the permanent says right now), while on an
 *  editing surface — deckbuilder, Draft Room — there is no game state, so the
 *  same face is simply the card's ORACLE text. The labels are props rather
 *  than a second component because the behaviour is identical. */
export default function CardPreviewModeToggle({
    mode,
    onChange,
    computedLabel = "Live text",
    printedLabel = "Printed card",
    className = "mx-3 mt-2",
    showRulings = false,
    hideComputed = false,
}: {
    mode: CardPreviewView;
    onChange: (mode: CardPreviewView) => void;
    /** Adds the third `Rulings` entry (issue #4816). */
    showRulings?: boolean;
    /** Drops the computed entry: a Manual Game card has no live text to show
     *  (ADR 0080), so its toggle reads `Printed card | Rulings` (issue #4817). */
    hideComputed?: boolean;
    computedLabel?: string;
    printedLabel?: string;
    className?: string;
}) {
    return (
        <div
            className={`flex justify-center gap-1 rounded-sm bg-surface-elevated/60 p-0.5 ${className}`}
        >
            {(
                [
                    ...(hideComputed ? [] : (["computed"] as const)),
                    "printed",
                    ...(showRulings ? (["rulings"] as const) : []),
                ] as const
            ).map((m) => (
                <button
                    key={m}
                    type="button"
                    data-preview-mode={m}
                    onClick={() => onChange(m)}
                    className={`rounded-sm px-2 py-0.5 text-[10px] ${
                        mode === m
                            ? "bg-accent-soft/50 text-parchment"
                            : "text-text-muted hover:text-parchment"
                    }`}
                >
                    {m === "computed"
                        ? computedLabel
                        : m === "printed"
                          ? printedLabel
                          : "Rulings"}
                </button>
            ))}
        </div>
    );
}
