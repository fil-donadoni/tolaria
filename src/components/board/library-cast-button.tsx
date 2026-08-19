import type { CardInstance } from "~/types/game";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";

/** Cast-from-top-of-library affordance (CR 601.3e-analog — an unconditional,
 *  player-wide permission granted by a battlefield source while it remains in
 *  play, e.g. Bolas's Citadel). Rendered over the NONLAND card on top of the
 *  viewer's own library when the projection tagged it with `legalActions`
 *  (`isCastableLibraryTopSpell`, re-derived live from the battlefield every
 *  projection — the affordance disappears the instant the granting source
 *  leaves play, or a draw/shuffle moves a different card to the top).
 *
 *  Routes through the SAME commit pipeline as a hand-card cast
 *  ({@link useHandCardCommit}): `announceCast` locates the card through
 *  `locateCastSource`'s library branch and, where the permission replaces the
 *  mana cost, charges life equal to the card's mana value instead
 *  (CR 118.9-analog / 119.4). The X-cost prompt, modal mode picker and
 *  keep-priority modifier behave identically.
 *
 *  Sibling of `library-play-land-button.tsx` (the LAND half of the same Oracle
 *  sentence) and of `graveyard-flashback-button.tsx`, deliberately a separate
 *  component rather than a shared one with a prop: they live in different
 *  branches, carry different disabled-state copy, and the one-component-per-
 *  file rule makes the duplication cheaper than the indirection.
 *
 *  `onCommitted` is threaded into the hook and fires at the real dispatch
 *  point (not on click) so a deferred X / kicker cast keeps its dialog mounted
 *  through the choice sequence. */
export default function LibraryCastButton({
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
    } = useHandCardCommit(card, { onCommitted });

    // The projection attaches "cast" only when the cast is legal right now
    // (correct timing AND the cost — life or mana — is payable). Gate the
    // button so an illegal cast is disabled rather than dispatched and
    // rejected by `assertLegalAction`.
    const enabled = card.legalActions?.includes("cast") ?? false;

    return (
        <>
            <button
                type="button"
                disabled={!enabled}
                title={
                    enabled
                        ? undefined
                        : "Can't cast yet — not the right timing, or you can't pay this card's cost."
                }
                onClick={(e) => {
                    if (!enabled) return;
                    onCastClick(e);
                }}
                className="absolute inset-x-0 bottom-0 z-30 rounded-b bg-accent-strong/90 px-1 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-elevated/80 disabled:text-text-muted disabled:shadow-none"
            >
                Cast
            </button>
            {costDialogOverlay}
            {modePickerOverlay}
            {altCostPickerOverlay}
            {phyrexianPickerOverlay}
        </>
    );
}
