import type { CardInstance } from "~/types/game";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";

/** Flashback cast affordance (CR 702.34 — "You may cast this card from your
 *  graveyard by paying its flashback cost. Then exile it."). Rendered over a
 *  card in the viewer's own Graveyard that the projection tagged with
 *  `legalActions` (only flashback-capable cards get the field). Routes through
 *  the SAME commit pipeline as a hand card ({@link useHandCardCommit}) —
 *  `announceCast` locates the graveyard card via `findFlashbackCastable`, pays
 *  the flashback cost, and flags the spell to exile on resolution. The X-cost
 *  prompt, modal mode picker, and keep-priority modifier behave identically.
 *  Calls `onCommitted` after dispatch so the host can close the reveal dialog. */
export default function GraveyardFlashbackButton({
    card,
    onCommitted,
}: {
    card: CardInstance;
    onCommitted?: () => void;
}) {
    const {
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
        phyrexianPickerOverlay,
        costDialogOverlay,
    } = useHandCardCommit(card);

    // CR 702.34c — the projection attaches `legalActions` to the viewer's own
    // flashback cards; "cast" is present only when the flashback cast is legal
    // right now (correct timing AND the flashback cost is affordable). Gate the
    // button so an illegal cast is disabled rather than dispatched and rejected
    // by `assertLegalAction`.
    const enabled = card.legalActions?.includes("cast") ?? false;
    // CR 702.34 vs 702.138 — the projection tags which graveyard-cast keyword
    // surfaced this affordance so the label and disabled-tooltip match.
    const isEscape = card.castKind === "escape";
    const label = isEscape ? "Escape" : "Flashback";
    const disabledTitle = isEscape
        ? "Can't escape yet — not your main phase, or you can't pay the escape cost (mana, or exile enough other cards from your graveyard)."
        : "Can't flash back yet — not your main phase, or you can't pay the flashback cost (mana, sacrifice, or exile-from-hand).";

    return (
        <>
            <button
                type="button"
                disabled={!enabled}
                title={enabled ? undefined : disabledTitle}
                onClick={(e) => {
                    if (!enabled) return;
                    onCastClick(e);
                    onCommitted?.();
                }}
                className="absolute inset-x-0 bottom-0 z-30 rounded-b bg-accent-strong/90 px-1 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted/80 disabled:text-text-muted disabled:shadow-none"
            >
                {label}
            </button>
            {modePickerOverlay}
            {altCostPickerOverlay}
            {phyrexianPickerOverlay}
            {costDialogOverlay}
        </>
    );
}
