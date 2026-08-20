/** Which face of a card a preview surface is showing. */
export type CardPreviewMode = "computed" | "printed";

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
}: {
    mode: CardPreviewMode;
    onChange: (mode: CardPreviewMode) => void;
    computedLabel?: string;
    printedLabel?: string;
    className?: string;
}) {
    return (
        <div
            className={`flex justify-center gap-1 rounded-sm bg-surface-elevated/60 p-0.5 ${className}`}
        >
            {(["computed", "printed"] as const).map((m) => (
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
                    {m === "computed" ? computedLabel : printedLabel}
                </button>
            ))}
        </div>
    );
}
