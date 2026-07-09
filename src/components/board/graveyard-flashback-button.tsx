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
    const { onCastClick, modePickerOverlay, altCostPickerOverlay } =
        useHandCardCommit(card);

    // CR 702.34c — the projection attaches `legalActions` to the viewer's own
    // flashback cards; "cast" is present only when the flashback cast is legal
    // right now (correct timing AND the flashback cost is affordable). Gate the
    // button so an illegal cast is disabled rather than dispatched and rejected
    // by `assertLegalAction`.
    const enabled = card.legalActions?.includes("cast") ?? false;

    return (
        <>
            <button
                type="button"
                disabled={!enabled}
                title={
                    enabled
                        ? undefined
                        : "Can't flash back yet — not your main phase, or not enough mana for the flashback cost."
                }
                onClick={(e) => {
                    if (!enabled) return;
                    onCastClick(e);
                    onCommitted?.();
                }}
                className="absolute inset-x-1 bottom-1 z-30 rounded bg-accent-strong/90 px-2 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted/80 disabled:text-text-muted disabled:shadow-none"
            >
                Flashback
            </button>
            {modePickerOverlay}
            {altCostPickerOverlay}
        </>
    );
}
