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
 *  `onCommitted` is threaded into the hook and fires at the real dispatch point
 *  (not on click) so a deferred X / kicker / alt-cost cast keeps its dialog
 *  mounted through the choice sequence instead of the host closing the reveal
 *  early and unmounting the dialog. */
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
    } = useHandCardCommit(card, { onCommitted });

    // CR 702.34c — the projection attaches `legalActions` to the viewer's own
    // flashback cards; "cast" is present only when the flashback cast is legal
    // right now (correct timing AND the flashback cost is affordable). Gate the
    // button so an illegal cast is disabled rather than dispatched and rejected
    // by `assertLegalAction`.
    const enabled = card.legalActions?.includes("cast") ?? false;
    // CR 702.34 vs 702.138 vs 305.1-analog vs 117.6-analog — the projection
    // tags which graveyard-cast mechanism surfaced this affordance so the
    // label and disabled-tooltip match.
    const isEscape = card.castKind === "escape";
    // CR 305.1-analog / 601 (issue #1149) — a BROAD permission cast
    // (Yawgmoth's Will) pays the card's NORMAL printed mana cost, not an
    // alternative one. CR 601.3e / 117.6-analog (issue #1344) — a
    // SPECIFIC-CARD grant (Malcolm, Alluring Scoundrel) renders identically —
    // "Cast", gated purely by `legalActions` (which is already free when the
    // grant waives the mana cost, `castRawManaCost`'s graveyard-grant branch).
    // CR 702.139 (issue #1392) — Lurrus's STATIC, once-per-turn,
    // permanent-cards-only permission also pays the normal printed mana
    // cost and renders identically.
    const isPermissionCast =
        card.castKind === "graveyard-permission" ||
        card.castKind === "graveyard-grant" ||
        card.castKind === "graveyard-permanent-permission";
    const label = isEscape ? "Escape" : isPermissionCast ? "Cast" : "Flashback";
    const disabledTitle = isEscape
        ? "Can't escape yet — not your main phase, or you can't pay the escape cost (mana, or exile enough other cards from your graveyard)."
        : isPermissionCast
          ? "Can't cast yet — not your main phase, or you can't pay this card's mana cost."
          : "Can't flash back yet — not your main phase, or you can't pay the flashback cost (mana, sacrifice, or exile-from-hand).";

    return (
        <>
            <button
                type="button"
                disabled={!enabled}
                title={enabled ? undefined : disabledTitle}
                onClick={(e) => {
                    if (!enabled) return;
                    // CR 601.2b — do NOT close the reveal here: a flashback cast
                    // gated behind the X / kicker / alt-cost dialog is deferred,
                    // and the dialog overlays live in this component. The hook
                    // fires `onCommitted` at the real dispatch point instead, so
                    // the dialog survives the choice sequence.
                    onCastClick(e);
                }}
                className="absolute inset-x-0 bottom-0 z-30 rounded-b bg-accent-strong/90 px-1 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-elevated/80 disabled:text-text-muted disabled:shadow-none"
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
