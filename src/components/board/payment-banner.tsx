import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingActivation, PendingCast, Player } from "~/types/game";
import type { PermanentFilter } from "@convex/cards/filters";
import { getDefinition } from "@convex/cards";
import { useDraggable } from "~/hooks/useDraggable";
import { isManaCostCovered } from "~/lib/card-utils";

/** Minimal noun phrase for a permanent filter, e.g. "a creature" (types:
 *  "Creature") or "a Swamp" (subtypes: ["Swamp"]). Subtypes win over types
 *  when both are present (more specific). Deliberately terse — matches the
 *  level of detail `TargetSelectionBanner`'s `TARGET_LABEL` gives for target
 *  types; the exact legal set is already visible via battlefield
 *  highlighting (`useBattlefieldVisualState`). */
function formatFilterLabel(filter: PermanentFilter): string {
    const subtypes = filter.subtypes
        ? Array.isArray(filter.subtypes)
            ? filter.subtypes
            : [filter.subtypes]
        : [];
    if (subtypes.length > 0) return `a ${subtypes.join(" or ")}`;
    const types = filter.types
        ? Array.isArray(filter.types)
            ? filter.types
            : [filter.types]
        : [];
    if (types.length > 0) return `a ${types.join(" or ").toLowerCase()}`;
    return "a permanent";
}

/** Subtitle for a pending activation whose mana leg is fully covered (or
 *  absent) — the "Auto-tap" affordance below is hidden in that case, so this
 *  describes the still-outstanding non-mana pick instead (#939). Falls back
 *  to the generic phrasing if somehow called with nothing left to pick (the
 *  activation would already have auto-committed server-side by then). */
function describeActivationCostChoice(pa: PendingActivation): string {
    const sc = pa.sacrificeChoice;
    if (sc && !sc.pickedId) {
        return `sacrifice ${formatFilterLabel(sc.filter)}`;
    }
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
    const { offset, dragHandlers } = useDraggable();
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
        subtitle = "pay the casting costs";
    } else {
        const source = props.me?.battlefield.find(
            (c) => c.id === props.pendingActivation.cardInstanceId
        );
        cardName = source ? getDefinition(source.card.id).name : "ability";
        manaOwed =
            Object.keys(props.pendingActivation.manaCost).length > 0 &&
            !isManaCostCovered(
                props.me?.manaPool ?? {},
                props.pendingActivation.manaCost
            );
        subtitle = manaOwed
            ? "pay the activation costs"
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
        <div
            className="absolute top-1/2 left-1/2 z-100"
            style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
        >
            <div
                {...dragHandlers}
                className="relative bg-surface border border-border-subtle backdrop-blur-md rounded-sm px-5 py-3 shadow-[0_0_50px_rgba(0,0,0,0.8)] cursor-move select-none"
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-border-accent/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-border-accent/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-border-accent/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-border-accent/40" />

                <p className="font-beleren text-sm tracking-wide text-parchment">
                    {cardName}
                </p>
                <div className="h-[1px] w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent my-1.5" />
                <p className="text-text-muted text-xs">{subtitle}</p>
                {manaOwed && (
                    <button
                        type="button"
                        onClick={handleAutoTap}
                        onPointerDown={(e) => e.stopPropagation()}
                        disabled={busy}
                        className="mt-2 w-full rounded-sm border border-success bg-success-soft px-2 py-1 text-xs font-semibold uppercase tracking-wide text-success-strong hover:bg-success-soft/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Auto-tap
                    </button>
                )}
            </div>
        </div>
    );
}
