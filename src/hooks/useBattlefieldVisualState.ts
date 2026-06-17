import { useMemo } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { getCardById } from "@convex/cards";
import {
    isCreature,
    isLandwalkUnblockable,
    hasManaAbility,
    matchesPermanentFilter,
    matchesTargetRequirement,
    wantsPermanentTarget,
    isTapLockedBySummoningSickness,
    getLandManaColor,
    getActivatedManaColor,
    getManaChoices,
} from "~/lib/card-utils";
import { COMBAT_GROUP_RING, COMBAT_GROUP_BG } from "~/lib/combat-colors";
import type { CardVisualState } from "~/components/board/battlefield-card";

/** Board-coupled visual state for one player's battlefield (PRD #249, slice
 *  #256). This is the single source of truth for how a permanent reads on the
 *  board: combat grouping rings, tap state, marked damage badges, and
 *  legal-target / legal-choice highlighting during selection.
 *
 *  Both the classic battlefield (`player-battlefield.tsx`) and the new spatial
 *  board (`board-next-battlefield-card.tsx`) consume the SAME `getVisualState`
 *  produced here — the computation is reused as-is; only the rendering differs.
 *
 *  Reads ONLY projected (`PublicGameState` / `FullGameState`) fields exposed
 *  through `useGameContext()` — no GRE engine import, consistent with the
 *  wire-format rule in CLAUDE.md. */
export function useBattlefieldVisualState(player: Player) {
    const {
        playerId,
        activePlayerId,
        priorityPlayerId,
        phase,
        pendingCast,
        pendingActivation,
        pendingTarget,
        pendingChoices,
        combat,
        allPlayers,
    } = useGameContext();
    const bufferCtx = usePendingChoiceBuffer();
    const isMe = player.id === playerId;

    // --- Interaction modes (mirrors player-battlefield.tsx) ---

    const isPayingCast =
        isMe && !!pendingCast && pendingCast.playerId === playerId;
    const isPayingActivation =
        isMe && !!pendingActivation && pendingActivation.playerId === playerId;
    const isInPayment = isPayingCast || isPayingActivation;

    const hasPriority = isMe && priorityPlayerId === playerId;

    const isSelectingTarget =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsPermanentTarget(pendingTarget.targetType);

    const activeChoice = pendingChoices?.[0];
    const isViewerChoosing =
        !!activeChoice && activeChoice.playerId === playerId;
    const choiceZoneOwnerId = activeChoice
        ? (activeChoice.zoneOwnerId ?? activeChoice.playerId)
        : undefined;
    const isSelectingChoice =
        isViewerChoosing &&
        activeChoice!.zone === "battlefield" &&
        (activeChoice!.allControllers === true ||
            choiceZoneOwnerId === player.id);

    const isPickingAdditionalCost =
        isMe &&
        !!pendingCast &&
        pendingCast.playerId === playerId &&
        !!pendingCast.additionalCost &&
        !pendingCast.additionalCost.pickedId;

    const isSelectingAttackers =
        phase === "DECLARE_ATTACKERS" &&
        !!combat &&
        !combat.confirmed &&
        isMe &&
        playerId === activePlayerId;

    const isSelectingBlockers =
        phase === "DECLARE_BLOCKERS" &&
        !!combat &&
        !combat.blockersConfirmed &&
        isMe &&
        playerId !== activePlayerId;

    const isBlockerTarget =
        !isMe &&
        phase === "DECLARE_BLOCKERS" &&
        !!combat &&
        !combat.blockersConfirmed &&
        !!combat.pendingBlockerId &&
        playerId !== activePlayerId;

    // --- Combat derived state ---

    const selectedAttackerIds = combat?.attackerIds ?? [];
    const blockerAssignments = combat?.blockerAssignments ?? {};
    const pendingBlockerId = combat?.pendingBlockerId;

    const combatGroupColors = useMemo(() => {
        const map: Record<string, number> = {};
        if (!combat) return map;
        const attackersWithBlockers = new Set(
            Object.values(combat.blockerAssignments).flat()
        );
        let colorIdx = 0;
        for (const attackerId of combat.attackerIds) {
            if (attackersWithBlockers.has(attackerId)) {
                map[attackerId] = colorIdx % COMBAT_GROUP_RING.length;
                colorIdx++;
            }
        }
        return map;
    }, [combat]);

    function canBlockAnyAttacker(blocker: CardInstance): boolean {
        if (!combat) return false;
        const hasFlying = blocker.staticAbilities?.includes("flying") ?? false;
        const hasReach = blocker.staticAbilities?.includes("reach") ?? false;
        const attackingPlayer = allPlayers.find((p) => p.id === activePlayerId);
        if (!attackingPlayer) return false;
        for (const attackerId of combat.attackerIds) {
            const attacker = attackingPlayer.battlefield.find(
                (c) => c.id === attackerId
            );
            if (!attacker) continue;
            if (isLandwalkUnblockable(attacker, player.battlefield)) continue;
            const attackerFlies =
                attacker.staticAbilities?.includes("flying") ?? false;
            if (!attackerFlies || hasFlying || hasReach) return true;
        }
        return false;
    }

    function canInteract(card: CardInstance): boolean {
        if (isSelectingChoice && activeChoice) {
            if (bufferCtx.buffer.includes(card.id)) return true;
            if (
                activeChoice.filter &&
                !matchesPermanentFilter(card, activeChoice.filter)
            ) {
                return false;
            }
            if (activeChoice.kind === "untap-pick") {
                if (!card.isTapped) return false;
                if (card.staticAbilities?.includes("does-not-untap")) {
                    return false;
                }
            }
            return true;
        }

        if (isPickingAdditionalCost && pendingCast?.additionalCost) {
            return matchesPermanentFilter(
                card,
                pendingCast.additionalCost.filter
            );
        }

        if (isSelectingTarget) {
            return (
                !!pendingTarget &&
                matchesTargetRequirement(card, pendingTarget.targetType)
            );
        }

        if (isSelectingAttackers && isCreature(card)) {
            if (selectedAttackerIds.includes(card.id)) return true;
            if (card.staticAbilities?.includes("defender")) return false;
            if (card.isTapped || card.isSummoningSick) return false;
            const attackDef = getCardById(card.card.id);
            if (attackDef.staticEffects) {
                const defender = allPlayers.find((p) => p.id !== player.id);
                for (const eff of attackDef.staticEffects) {
                    if (eff.kind !== "attack-restriction") continue;
                    if (
                        !eff.predicate(
                            card as never,
                            (defender?.battlefield ?? []) as never
                        )
                    )
                        return false;
                }
            }
            return true;
        }

        if (isSelectingBlockers && isCreature(card)) {
            if ((blockerAssignments[card.id]?.length ?? 0) > 0) return true;
            if (pendingBlockerId === card.id) return true;
            return !card.isTapped && canBlockAnyAttacker(card);
        }

        if (isBlockerTarget && card.isAttacking) return true;

        if (!isMe || !hasManaAbility(card)) return false;
        // CR 302.1 — creatures with summoning sickness can't pay {T}, so
        // their mana ability isn't activatable. Untapping (refunding floating
        // mana) is still allowed — it reverses an earlier activation.
        if (isTapLockedBySummoningSickness(card) && !card.isTapped) {
            return false;
        }
        if (isInPayment) {
            const tappedDuringPayment = isPayingCast
                ? pendingCast!.tappedLandIds.includes(card.id)
                : pendingActivation!.tappedLandIds.includes(card.id);
            return card.isTapped
                ? tappedDuringPayment
                : getLandManaColor(card) !== null ||
                      getActivatedManaColor(card) !== null ||
                      getManaChoices(card) !== null;
        }
        // CR 605.3b: mana abilities require priority (outside payment).
        if (!hasPriority) return false;
        return card.isTapped ? !card.manaCommitted : true;
    }

    function getVisualState(card: CardInstance): CardVisualState {
        const creature = isCreature(card);
        const manaSource = hasManaAbility(card);

        const isValidTarget =
            isSelectingTarget &&
            pendingTarget &&
            matchesTargetRequirement(card, pendingTarget.targetType);

        const isTargetSelected =
            isSelectingTarget &&
            !!pendingTarget &&
            pendingTarget.selected.some(
                (t) => t.type === "permanent" && t.id === card.id
            );

        const isValidChoice =
            isSelectingChoice &&
            !!activeChoice &&
            (!activeChoice.filter ||
                matchesPermanentFilter(card, activeChoice.filter));

        const isChoiceSelected =
            isSelectingChoice &&
            !!activeChoice &&
            bufferCtx.buffer.includes(card.id);

        const interactive = isSelectingChoice
            ? isValidChoice
            : isSelectingTarget
              ? !!isValidTarget
              : (isMe &&
                    (manaSource ||
                        (isSelectingAttackers && creature) ||
                        (isSelectingBlockers && creature))) ||
                (isBlockerTarget && !!card.isAttacking);

        const enabled = canInteract(card);

        const dimmed: boolean =
            !!(
                isSelectingAttackers &&
                creature &&
                !selectedAttackerIds.includes(card.id) &&
                (card.isTapped ||
                    card.isSummoningSick ||
                    card.staticAbilities?.includes("defender"))
            ) ||
            !!(
                isSelectingBlockers &&
                creature &&
                !blockerAssignments[card.id]?.length &&
                pendingBlockerId !== card.id &&
                (card.isTapped || !canBlockAnyAttacker(card))
            );

        // Combat offset (translate toward center)
        let combatOffset = "";
        const towardCenter = isMe ? "-translate-y-8" : "translate-y-8";
        if (
            (combat &&
                !combat.confirmed &&
                selectedAttackerIds.includes(card.id)) ||
            card.isAttacking ||
            (blockerAssignments[card.id]?.length ?? 0) > 0 ||
            card.isBlocking
        ) {
            combatOffset = towardCenter;
        }

        // Ring class
        let ringClass = "";
        if (pendingBlockerId === card.id) {
            ringClass = "ring-2 ring-amber-400 rounded-sm";
        } else if (
            card.isAttacking &&
            combatGroupColors[card.id] !== undefined
        ) {
            ringClass = `ring-2 ${COMBAT_GROUP_RING[combatGroupColors[card.id]]} rounded-sm`;
        } else {
            const targetAtkIds = blockerAssignments[card.id];
            const firstAtkId = targetAtkIds?.[0];
            if (firstAtkId && combatGroupColors[firstAtkId] !== undefined) {
                ringClass = `ring-2 ${COMBAT_GROUP_RING[combatGroupColors[firstAtkId]]} rounded-sm`;
            } else if (
                selectedAttackerIds.includes(card.id) &&
                !combat?.confirmed
            ) {
                ringClass = "ring-2 ring-[#a04040] rounded-sm";
            }
        }
        if (!ringClass && isTargetSelected) {
            ringClass = "ring-2 ring-[#c8a060] rounded-sm";
        } else if (!ringClass && isValidTarget) {
            ringClass = "ring-2 ring-[#c8a060]/50 rounded-sm";
        }
        if (!ringClass && isChoiceSelected) {
            ringClass = "ring-2 ring-[#c8a060] rounded-sm";
        } else if (!ringClass && isValidChoice) {
            ringClass = "ring-2 ring-[#c8a060]/40 rounded-sm";
        }

        // Tooltip for ineligible creatures
        let tooltip: string | undefined;
        if (dimmed) {
            if (isSelectingAttackers && creature) {
                if (card.staticAbilities?.includes("defender"))
                    tooltip = "Can't attack — has defender";
                else if (card.isSummoningSick)
                    tooltip = "Can't attack — summoning sick";
                else if (card.isTapped) tooltip = "Can't attack — tapped";
            } else if (isSelectingBlockers && creature) {
                if (card.isTapped) tooltip = "Can't block — tapped";
                else if (!canBlockAnyAttacker(card))
                    tooltip = "Can't block — no valid target";
            }
        }

        // Badge
        let badge: { color: string; index: number } | null = null;
        if (combatGroupColors[card.id] !== undefined) {
            badge = {
                color: COMBAT_GROUP_BG[combatGroupColors[card.id]],
                index: combatGroupColors[card.id],
            };
        } else {
            const targetAtkIds = blockerAssignments[card.id];
            const firstAtkId = targetAtkIds?.[0];
            if (firstAtkId && combatGroupColors[firstAtkId] !== undefined) {
                badge = {
                    color: COMBAT_GROUP_BG[combatGroupColors[firstAtkId]],
                    index: combatGroupColors[firstAtkId],
                };
            }
        }

        return {
            interactive,
            enabled,
            dimmed,
            combatOffset,
            ringClass,
            badge,
            tooltip,
        };
    }

    return { getVisualState, canInteract };
}
