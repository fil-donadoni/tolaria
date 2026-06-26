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

    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    onCastClick(e);
                    onCommitted?.();
                }}
                className="absolute inset-x-1 bottom-1 z-30 rounded bg-accent-strong/90 px-2 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong"
            >
                Cast
            </button>
            {modePickerOverlay}
        </>
    );
}
