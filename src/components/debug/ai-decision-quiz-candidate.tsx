// One candidate in the verdict quiz (issue #3405).
//
// A button, not a radio: the whole row is the target, because the surface has
// to work at 390px with a thumb, and a 13px radio dot beside a sentence-long
// move description is the control nobody hits.

export default function AiDecisionQuizCandidate({
    description,
    isBotPick,
    selected,
    disabled,
    onSelect,
}: {
    description: string;
    /** The move the Bot actually played — marked, never pre-selected: a quiz
     *  that opens with the Bot's own answer already filled in is a quiz whose
     *  easiest gesture agrees with it. */
    isBotPick: boolean;
    selected: boolean;
    disabled: boolean;
    onSelect: () => void;
}) {
    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                disabled={disabled}
                aria-pressed={selected}
                className={`flex w-full items-baseline gap-1.5 rounded-sm border px-1.5 py-1 text-left text-[11px] leading-snug transition-colors disabled:opacity-50 ${
                    selected
                        ? "border-accent text-accent-strong"
                        : "border-border-subtle text-text-muted hover:border-accent hover:text-parchment"
                }`}
            >
                <span className="min-w-0 break-words">{description}</span>
                {isBotPick && (
                    <span className="ml-auto shrink-0 text-[10px] text-signal-self">
                        Bot played this
                    </span>
                )}
            </button>
        </li>
    );
}
