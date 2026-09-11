import type { CardInstance } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { exileCastPermission } from "@convex/gre/castCost";
import { useGameContext } from "~/hooks/useGameContext";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";
import { V4_ZONE_CTA_DISABLED, V4_ZONE_CTA_PLATE } from "~/lib/board-chrome-v4";

/** Play-from-exile affordance (CR 601.3 / 305.1-analog — Ice Cauldron: "You may cast that
 *  card for as long as it remains exiled"; Headliner Scarlett / Expressive
 *  Iteration: "you may play that card this turn"). Rendered over a card in the
 *  Exile zone whose `castableFromExileBy` matches the viewing player. Routes
 *  through the SAME commit pipeline as a hand card ({@link useHandCardCommit}):
 *  a LAND dispatches `playCard` (the backend accepts an exiled land as a play
 *  source, moving exile → battlefield and consuming the CR 305.2 land drop); a
 *  spell dispatches `announceCast` (`findCastableExileCard`). The X-cost prompt,
 *  modal mode picker, and keep-priority modifier all behave identically.
 *  `onCommitted` is threaded into the hook and fires at the real dispatch point
 *  (not on click) so a deferred X / kicker / alt-cost cast keeps its dialog
 *  mounted through the choice sequence. */
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
        phyrexianPickerOverlay,
        additionalCostPickerOverlay,
        costDialogOverlay,
    } = useHandCardCommit(card, { onCommitted });
    // The ENGINE turn (the wire `GameState.turn`), the only number a
    // client-side engine predicate may be handed — see `useGameContext`.
    const { engineTurn } = useGameContext();

    // A land in exile is PLAYED (as a land, CR 305.2), everything else is CAST.
    // The button's action follows the card type; its enabled state follows the
    // matching projected legal action.
    const isLand = getDefinition(card.card.id).types.includes("Land");

    // CR 305.9 (issue #1689) — a cast permission alone does NOT authorize
    // playing a LAND; a land is never cast, so `castableFromExileBy` is
    // meaningless for one unless `castableFromExileIncludesLand` is ALSO set
    // (Headliner Scarlett / Expressive Iteration / Dauthi Voidwalker say
    // "play", not "cast"). Render nothing rather than a permanently-disabled
    // button with a misleading tooltip — the card genuinely has no action.
    if (isLand && card.castableFromExileIncludesLand !== true) return null;

    // CR 702.185a (issue #3294) — the disabled REASON, asked of the SAME
    // authority the projection gated `legalActions` on rather than re-derived
    // here: a grant whose lower bound has not been reached is refused for the
    // window, not for the mana. `castableFromExileBy` is the caster by
    // construction (the render gate upstream matched it against the viewer), so
    // a `false` here can only mean the window. Undefined = no bound, or open.
    // `engineTurn` is read defensively, the way every other consumer does
    // (`useBattlefieldVisualState`): `undefined >= N` is false, so a context
    // carrying anything but a number would report the WINDOW for a cast that is
    // merely unaffordable — the exact wrong reason this branch exists to stop.
    // `GameContext` types the field as required, so no test can reach this
    // without defeating the type; it carries none rather than a double cast.
    const windowOpensOnTurn =
        typeof engineTurn === "number" &&
        card.castableFromExileBy !== undefined &&
        !exileCastPermission(card, card.castableFromExileBy, engineTurn)
            ? card.castableFromExileFromTurn
            : undefined;

    // CR 601.3 / 601.2f / 305.2 — the projection attaches `legalActions` to the
    // viewer's own castable-from-exile card (gameProjections). "cast" is present
    // only when the cast is legal right now (correct timing AND affordable,
    // counting instance-keyed noted mana, CR 106.6); "play" only when a land
    // drop remains at sorcery timing. Gate the button so an illegal play/cast is
    // disabled rather than dispatched and rejected by `assertLegalAction`.
    const enabled = isLand
        ? (card.legalActions?.includes("play") ?? false)
        : (card.legalActions?.includes("cast") ?? false);

    const label = isLand ? "Play" : "Cast";
    const disabledTitle = windowOpensOnTurn
        ? // CR 702.185a — the grant EXISTS but has not opened yet (Warp: "its
          // owner may cast this card after the current turn has ended"). The
          // projection withholds `legalActions` entirely in this window, so
          // without this branch the button blamed the mana for a wait.
          `Can't ${label.toLowerCase()} yet — not available from exile until turn ${windowOpensOnTurn}.`
        : isLand
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
                    // CR 601.2b — do NOT close the reveal here: a cast gated
                    // behind the X / kicker / alt-cost dialog is deferred and
                    // its overlays live in this component. The hook fires
                    // `onCommitted` at the real dispatch point (a land play is
                    // immediate) so the dialog survives the choice sequence.
                    if (isLand) onPlayClick();
                    else onCastClick(e);
                }}
                className={`absolute inset-x-1 bottom-1 z-30 rounded px-2 py-1 ${V4_ZONE_CTA_PLATE} ${V4_ZONE_CTA_DISABLED}`}
            >
                {label}
            </button>
            {modePickerOverlay}
            {altCostPickerOverlay}
            {phyrexianPickerOverlay}
            {additionalCostPickerOverlay}
            {costDialogOverlay}
        </>
    );
}
