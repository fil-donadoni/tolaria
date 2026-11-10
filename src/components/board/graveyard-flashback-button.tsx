import { useRef, useState } from "react";
import {
    cardHasLegalAction,
    graveyardActionSources,
} from "~/lib/card-actionable";
import type { CardInstance } from "~/types/game";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";
import { useGameContext } from "~/hooks/useGameContext";
import { V4_ZONE_CTA } from "~/lib/board-chrome-v4";
import { harmonizeCreatureOptions } from "~/lib/harmonize-creatures";
import HarmonizeCreatureDialog from "./harmonize-creature-dialog";

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
    // CR 702.180b — the harmonize creature is chosen before the cast pipeline
    // starts and read back at its dispatch point.
    const harmonizeCreatureRef = useRef<string | undefined>(undefined);
    const [harmonizeClick, setHarmonizeClick] = useState<
        React.MouseEvent | undefined
    >(undefined);
    const game = useGameContext();
    const {
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
        phyrexianPickerOverlay,
        additionalCostPickerOverlay,
        costDialogOverlay,
    } = useHandCardCommit(card, {
        onCommitted,
        harmonizeCreatureId: () => harmonizeCreatureRef.current,
    });

    // CR 702.34a flashback — the projection attaches `legalActions` to the viewer's own
    // flashback cards; "cast" is present only when the flashback cast is legal
    // right now (correct timing AND the flashback cost is affordable). Gate the
    // button so an illegal cast is disabled rather than dispatched and rejected
    // by `assertLegalAction`.
    const enabled = cardHasLegalAction(true, graveyardActionSources(card, 0));
    // CR 702.34 vs 702.138 vs 305.1-analog vs 118.9 — the projection
    // tags which graveyard-cast mechanism surfaced this affordance so the
    // label and disabled-tooltip match.
    const isEscape = card.castKind === "escape";
    // CR 601.3 (ADR 0093) — a graveyard play permission cast (Yawgmoth's
    // Will, Lurrus of the Dream-Den) pays the card's NORMAL printed mana
    // cost, not an alternative one. CR 601.3 / 118.9 (issue #1344) — a
    // SPECIFIC-CARD grant (Malcolm, Alluring Scoundrel) renders identically —
    // "Cast", gated purely by `legalActions` (which is already free when the
    // grant waives the mana cost, `castRawManaCost`'s graveyard-grant branch).
    // CR 601.3 / 118.9b (issue #2074) — the card's OWN permission (Hogaak;
    // Detective's Phoenix, whose scope to its bestow cost the alt-cost picker
    // enforces via `printedCostCastUnavailable`) renders the same "Cast".
    const isPermissionCast =
        card.castKind === "graveyard-permission" ||
        card.castKind === "graveyard-grant" ||
        card.castKind === "graveyard-intrinsic";
    // CR 702.81a (issue #2358) — a RETRACE cast is the only graveyard mechanism
    // that pays the card's PRINTED mana cost *plus* an extra cost (discard a
    // land card), so it needs its own label and its own disabled explanation.
    // The chain below defaults to "Flashback", so a new `castKind` that is not
    // handled here renders a silently WRONG label with no type error — every
    // member of the union in `convex/gameProjections.ts` must appear in this
    // dispatch.
    const isRetrace = card.castKind === "retrace";
    const isJumpStart = card.castKind === "jump-start";
    // CR 702.180a — harmonize pays its own cost, reduced by the power of up to
    // one creature tapped for it, asked before the cast is announced.
    const isHarmonize = card.castKind === "harmonize";
    const harmonizeCreatures = isHarmonize
        ? harmonizeCreatureOptions(game)
        : [];
    const label = isEscape
        ? "Escape"
        : isRetrace
          ? "Retrace"
          : isJumpStart
            ? "Jump-start"
            : isHarmonize
              ? "Harmonize"
              : isPermissionCast
                ? "Cast"
                : "Flashback";
    const disabledTitle = isEscape
        ? "Can't escape yet — not your main phase, or you can't pay the escape cost (mana, or exile enough other cards from your graveyard)."
        : isRetrace
          ? "Can't retrace yet — not your main phase, or you can't pay this card's mana cost plus discarding a land card from your hand."
          : isJumpStart
            ? "Can't jump-start yet — not your main phase, or you can't pay this card's mana cost plus discarding a card from your hand."
            : isHarmonize
              ? "Can't harmonize yet — not your main phase, or you can't pay the harmonize cost, even reduced by tapping your strongest untapped creature."
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
                    if (isHarmonize && harmonizeCreatures.length > 0) {
                        setHarmonizeClick(e);
                        return;
                    }
                    harmonizeCreatureRef.current = undefined;
                    onCastClick(e);
                }}
                className={V4_ZONE_CTA}
            >
                {label}
            </button>
            {harmonizeClick && (
                <HarmonizeCreatureDialog
                    creatures={harmonizeCreatures}
                    onPick={(creatureId) => {
                        harmonizeCreatureRef.current = creatureId;
                        const click = harmonizeClick;
                        setHarmonizeClick(undefined);
                        onCastClick(click);
                    }}
                    onCancel={() => setHarmonizeClick(undefined)}
                />
            )}
            {modePickerOverlay}
            {altCostPickerOverlay}
            {phyrexianPickerOverlay}
            {additionalCostPickerOverlay}
            {costDialogOverlay}
        </>
    );
}
