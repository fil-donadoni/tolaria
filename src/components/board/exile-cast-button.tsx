import type { CardInstance } from "~/types/game";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";

/** Cast-from-exile affordance (CR 601.3e — Ice Cauldron: "You may cast that
 *  card for as long as it remains exiled"). Rendered over a card in the Exile
 *  zone whose `castableFromExileBy` matches the viewing player. Routes through
 *  the SAME commit pipeline as a hand card ({@link useHandCardCommit} →
 *  `announceCast`), so the X-cost prompt, modal mode picker, and keep-priority
 *  modifier all behave identically — the backend cast mutation already accepts
 *  the exile origin (`findCastableExileCard`). Calls `onCommitted` after
 *  dispatch so the host can close the reveal dialog. */
export default function ExileCastButton({
    card,
    onCommitted,
}: {
    card: CardInstance;
    onCommitted?: () => void;
}) {
    const { onCastClick, modePickerOverlay } = useHandCardCommit(card);

    // CR 601.3e / 601.2f — the projection attaches `legalActions` to the
    // viewer's own castable-from-exile card (gameProjections). "cast" is present
    // only when the cast is actually legal right now — correct timing AND
    // affordable, counting the instance-keyed noted mana (CR 106.6). Gate the
    // button on it so an unpayable cast (e.g. noted mana of the wrong colour)
    // is disabled rather than dispatched and rejected by `assertLegalAction`.
    const canCast = card.legalActions?.includes("cast") ?? false;

    return (
        <>
            <button
                type="button"
                disabled={!canCast}
                title={
                    canCast
                        ? undefined
                        : "Can't cast yet — not enough usable mana (the noted mana must match this card's cost)."
                }
                onClick={(e) => {
                    if (!canCast) return;
                    onCastClick(e);
                    onCommitted?.();
                }}
                className="absolute inset-x-1 bottom-1 z-30 rounded bg-accent-strong/90 px-2 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted/80 disabled:text-text-muted disabled:shadow-none"
            >
                Cast
            </button>
            {modePickerOverlay}
        </>
    );
}
