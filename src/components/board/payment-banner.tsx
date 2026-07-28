import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingActivation, PendingCast, Player } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { isManaCostCovered } from "~/lib/card-utils";
import {
    describeSacrificeChoice,
    formatFilterLabel,
    isSacrificeComplete,
} from "~/lib/sacrifice-selection";

/** Subtitle for a pending activation whose mana leg is fully covered (or
 *  absent) — the "Auto-tap" affordance below is hidden in that case, so this
 *  describes the still-outstanding non-mana pick instead (#939). Falls back
 *  to the generic phrasing if somehow called with nothing left to pick (the
 *  activation would already have auto-committed server-side by then). */
function describeActivationCostChoice(pa: PendingActivation): string {
    const toc = pa.tapOtherChoice;
    if (toc && toc.pickedIds.length < toc.count) {
        const remaining = toc.count - toc.pickedIds.length;
        const label = formatFilterLabel(toc.filter);
        if (remaining > 1) {
            // Strip the leading article ("a"/"an") before pluralizing —
            // formatFilterLabel returns "a creature", and "tap 3 more a
            // creatures" reads as broken English (#954 review).
            const bare = label.replace(/^an? /, "");
            const plural = bare.endsWith("s") ? bare : `${bare}s`;
            return `tap ${remaining} more ${plural}`;
        }
        return `tap ${label}`;
    }
    return "pay the activation costs";
}

type Props = {
    gameId: Id<"games">;
    playerId: string;
} & (
    | {
          kind: "cast";
          pendingCast: PendingCast;
          me: Player | undefined;
      }
    | {
          kind: "activation";
          pendingActivation: PendingActivation;
          me: Player | undefined;
      }
);

export default function PaymentBanner(props: Props) {
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition();
    const autoTap = useMutation(api.game.autoTapForPayment);
    const [busy, setBusy] = useState(false);

    let cardName: string;
    let subtitle: string;
    // Gates the "Auto-tap" affordance below. A cast's mana leg is always
    // real — spells in the catalogue don't ship mana-less costs — so casts
    // keep the affordance unconditionally. An activation can land here purely
    // because of a sacrifice/tap-other cost picker (CR 602.1) with the mana
    // leg already covered or altogether absent (Goblin Bombardment, Sylvan
    // Safekeeper): Auto-tap would have nothing to do, so it's hidden and the
    // subtitle instead names the outstanding non-mana pick (#939). The legal
    // permanents themselves are highlighted/clickable on the battlefield via
    // `useBattlefieldVisualState` regardless of this banner.
    let manaOwed = true;

    if (props.kind === "cast") {
        const cardInHand = props.me?.hand.find(
            (c) => c !== null && c.id === props.pendingCast.cardInstanceId
        );
        cardName = cardInHand
            ? getDefinition(cardInHand.card.id).name
            : "spell";
        // CR 701.21a — when the cast is parked on a sacrifice choice, hide the
        // Auto-tap affordance once the mana leg is covered and name the pick.
        const castSac = props.pendingCast.sacrificeSelection;
        const castManaCovered =
            Object.keys(props.pendingCast.manaCost).length === 0 ||
            isManaCostCovered(
                props.me?.manaPool ?? {},
                props.pendingCast.manaCost
            );
        if (castSac && !isSacrificeComplete(castSac) && castManaCovered) {
            manaOwed = false;
            subtitle = describeSacrificeChoice(castSac);
        } else {
            subtitle = "pay the casting costs";
        }
    } else {
        // CR 113.6 / 702.29a — the source is normally on the battlefield, but a
        // zone-restricted activated ability pays from another zone while its
        // source still sits there: Cycling (`fromHand`) from the hand, Ashen
        // Ghoul (`fromGraveyard`) from the graveyard. Search all three so the
        // banner names the card (e.g. "Raugrin Triome") instead of a bare
        // "ability".
        const pa = props.pendingActivation;
        const source =
            props.me?.battlefield.find((c) => c.id === pa.cardInstanceId) ??
            props.me?.hand.find(
                (c) => c !== null && c.id === pa.cardInstanceId
            ) ??
            props.me?.graveyard?.find((c) => c.id === pa.cardInstanceId);
        cardName = source ? getDefinition(source.card.id).name : "ability";
        manaOwed =
            Object.keys(props.pendingActivation.manaCost).length > 0 &&
            !isManaCostCovered(
                props.me?.manaPool ?? {},
                props.pendingActivation.manaCost
            );
        const actSac = props.pendingActivation.sacrificeSelection;
        subtitle = manaOwed
            ? "pay the activation costs"
            : actSac && !isSacrificeComplete(actSac)
              ? describeSacrificeChoice(actSac)
              : describeActivationCostChoice(props.pendingActivation);
    }

    async function handleAutoTap() {
        if (busy) return;
        setBusy(true);
        try {
            await autoTap({ gameId: props.gameId, playerId: props.playerId });
        } catch {
            // No valid combination (server-side guard) — leave the banner up so
            // the player can tap manually. The validation toast surfaces nothing
            // here by design; manual tapping remains available.
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel density="compact" className="px-5 py-3">
                    <p className="font-beleren text-sm tracking-wide text-parchment">
                        {cardName}
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent my-1.5" />
                    <p className="text-text-muted text-xs">{subtitle}</p>
                    {manaOwed && (
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={handleAutoTap}
                            onPointerDown={(e) => e.stopPropagation()}
                            disabled={busy}
                            className="mt-2 w-full"
                        >
                            Auto-tap
                        </Button>
                    )}
                </Panel>
            </div>
        </div>
    );
}
