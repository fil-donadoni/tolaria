import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingActivation, PendingCast, Player } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { displayCardId, isManaCostCovered } from "~/lib/card-utils";
import { isTapOtherChoicePaid } from "@convex/gre/tapOtherCost";
import { describeTapOtherProgress } from "~/lib/tap-other-progress";
import {
    spendablePoolForAbility,
    spendablePoolForSpell,
} from "@convex/gre/state";
import {
    describeSacrificeChoice,
    isSacrificeComplete,
} from "~/lib/sacrifice-selection";

/** Subtitle for a pending activation whose mana leg is fully covered (or
 *  absent) — the "Auto-tap" affordance below is hidden in that case, so this
 *  describes the still-outstanding non-mana pick instead (#939). Falls back
 *  to the generic phrasing if somehow called with nothing left to pick (the
 *  activation would already have auto-committed server-side by then). */
function describeActivationCostChoice(pa: PendingActivation): string {
    const toc = pa.tapOtherChoice;
    if (toc && !isTapOtherChoicePaid(toc)) {
        // Shared with the client-local mana-ability tap-other picker's banner
        // (issue #2371) — see `lib/tap-other-progress.ts`.
        return describeTapOtherProgress(
            toc,
            toc.pickedIds.length,
            toc.pickedPower ?? 0
        );
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
    // Issue #1813 — always pinned: paying this cost routes clicks to the
    // battlefield (lands to tap for mana, `tapOtherChoice`/`additionalCost`
    // permanent picks — `useBattlefieldVisualState`), so a vertically
    // centered panel would sit directly on top of what the player must tap.
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition({ pinned: true });
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
        const castCardDef = cardInHand
            ? getDefinition(cardInHand.card.id)
            : undefined;
        cardName = castCardDef ? castCardDef.name : "spell";
        // CR 701.21a — when the cast is parked on a sacrifice choice, hide the
        // Auto-tap affordance once the mana leg is covered and name the pick.
        const castSac = props.pendingCast.sacrificeSelection;
        // CR 106.6 (issue #1713) — restricted mana already eligible for this
        // spell (Mishra's Workshop / Soldevi Machinist-style buckets) counts
        // toward coverage here too, mirroring the server's
        // `spendablePoolForSpell` check at the cast-commit sites
        // (`convex/game.ts`) instead of reading the raw `manaPool`.
        const castManaCovered =
            Object.keys(props.pendingCast.manaCost).length === 0 ||
            (props.me !== undefined &&
                isManaCostCovered(
                    spendablePoolForSpell(
                        props.me,
                        castCardDef?.types ?? [],
                        props.pendingCast.cardInstanceId,
                        castCardDef?.supertypes ?? []
                    ),
                    props.pendingCast.manaCost
                ));
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
        const onBattlefield = props.me?.battlefield.find(
            (c) => c.id === pa.cardInstanceId
        );
        const inGraveyard = props.me?.graveyard?.find(
            (c) => c.id === pa.cardInstanceId
        );
        const source =
            onBattlefield ??
            props.me?.hand.find(
                (c) => c !== null && c.id === pa.cardInstanceId
            ) ??
            inGraveyard;
        cardName = source
            ? getDefinition(displayCardId(source)).name
            : "ability";
        // CR 106.6 (issue #1713) — restricted mana eligible for an ability of
        // THIS source (Soldevi Machinist's artifact-ability mana) counts
        // toward coverage here too, mirroring the server's
        // `spendablePoolForAbility` check at the activation-commit sites
        // (`convex/game.ts`) instead of reading the raw `manaPool`.
        //
        // The eligibility key must mirror the server's `activationSourceTypes`
        // EXACTLY, and that helper searches battlefields + graveyards only —
        // a HAND source (Cycling / any `fromHand` ability) yields `[]`, which
        // makes every restriction ineligible. Reusing `source` here (which
        // also looks in hand, purely so the banner can NAME the card) would
        // let the client conclude "covered" and hide Auto-tap while the server
        // refuses to auto-commit — a dead banner.
        const sourceTypes = onBattlefield?.types ?? inGraveyard?.types ?? [];
        manaOwed =
            Object.keys(props.pendingActivation.manaCost).length > 0 &&
            !(
                props.me !== undefined &&
                isManaCostCovered(
                    spendablePoolForAbility(props.me, sourceTypes),
                    props.pendingActivation.manaCost
                )
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
                    {/* v4 (ADR 0103 §4, issue #2730): source name off Beleren
                        onto the chrome display face; the rule below is the
                        shared `.panel-rule` hairline (Panel's own header
                        rule) rather than the repeated gold-gradient divider
                        recipe six prompt bars carried independently. */}
                    <p className="text-display text-sm text-text">{cardName}</p>
                    <div className="panel-rule my-1.5 h-px w-full" />
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
