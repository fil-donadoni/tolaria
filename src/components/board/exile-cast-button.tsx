import type { CardInstance } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";

/** Play-from-exile affordance (CR 601.3e — Ice Cauldron: "You may cast that
 *  card for as long as it remains exiled"; Headliner Scarlett / Expressive
 *  Iteration: "you may play that card this turn"). Rendered over a card in the
 *  Exile zone whose `castableFromExileBy` matches the viewing player. Routes
 *  through the SAME commit pipeline as a hand card ({@link useHandCardCommit}):
 *  a LAND dispatches `playCard` (the backend accepts an exiled land as a play
 *  source, moving exile → battlefield and consuming the CR 305.2 land drop); a
 *  spell dispatches `announceCast` (`findCastableExileCard`). The X-cost prompt,
 *  modal mode picker, and keep-priority modifier all behave identically. Calls
 *  `onCommitted` after dispatch so the host can close the reveal dialog. */
export default function ExileCastButton({
    card,
    onCommitted,
}: {
    card: CardInstance;
    onCommitted?: () => void;
}) {
    const {
        onPlayClick,
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
    } = useHandCardCommit(card);

    // A land in exile is PLAYED (as a land, CR 305.2), everything else is CAST.
    // The button's action follows the card type; its enabled state follows the
    // matching projected legal action.
    const isLand = getDefinition(card.card.id).types.includes("Land");

    // CR 601.3e / 601.2f / 305.2 — the projection attaches `legalActions` to the
    // viewer's own castable-from-exile card (gameProjections). "cast" is present
    // only when the cast is legal right now (correct timing AND affordable,
    // counting instance-keyed noted mana, CR 106.6); "play" only when a land
    // drop remains at sorcery timing. Gate the button so an illegal play/cast is
    // disabled rather than dispatched and rejected by `assertLegalAction`.
    const enabled = isLand
        ? (card.legalActions?.includes("play") ?? false)
        : (card.legalActions?.includes("cast") ?? false);

    const label = isLand ? "Play" : "Cast";
    const disabledTitle = isLand
        ? "Can't play yet — no land drop remaining, or not your main phase."
        : "Can't cast yet — not enough usable mana (the noted mana must match this card's cost).";

    return (
        <>
            <button
                type="button"
                disabled={!enabled}
                title={enabled ? undefined : disabledTitle}
                onClick={(e) => {
                    if (!enabled) return;
                    if (isLand) onPlayClick();
                    else onCastClick(e);
                    onCommitted?.();
                }}
                className="absolute inset-x-1 bottom-1 z-30 rounded bg-accent-strong/90 px-2 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted/80 disabled:text-text-muted disabled:shadow-none"
            >
                {label}
            </button>
            {modePickerOverlay}
            {altCostPickerOverlay}
        </>
    );
}
