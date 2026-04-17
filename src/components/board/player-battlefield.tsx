import { useMemo } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    isCreature,
    isLand,
    getLandManaColor,
    isTargetableCreature,
    groupByName,
} from "~/lib/card-utils";
import { COMBAT_GROUP_RING, COMBAT_GROUP_BG } from "~/lib/combat-colors";
import BattlefieldCard, { type CardVisualState } from "./battlefield-card";
import DamageAssignmentPanel from "./damage-assignment-panel";
import BlockerOrderPanel from "./blocker-order-panel";
import ActionButton from "./action-button";

// ---------------------------------------------------------------------------
// PlayerBattlefield
// ---------------------------------------------------------------------------

export default function PlayerBattlefield({ player }: { player: Player }) {
    const {
        gameId,
        playerId,
        activePlayerId,
        phase,
        pendingCast,
        pendingTarget,
        combat,
        allPlayers,
    } = useGameContext();
    const isMe = player.id === playerId;

    // Mutations
    const tapUntap = useMutation(api.game.tapUntap);
    const tapForPayment = useMutation(api.game.tapForPayment);
    const untapForPayment = useMutation(api.game.untapForPayment);
    const cancelCast = useMutation(api.game.cancelCast);
    const toggleAttacker = useMutation(api.game.toggleAttacker);
    const confirmAttackers = useMutation(api.game.confirmAttackers);
    const selectBlocker = useMutation(api.game.selectBlocker);
    const assignBlockerTarget = useMutation(api.game.assignBlockerTarget);
    const confirmBlockers = useMutation(api.game.confirmBlockers);
    const confirmDamage = useMutation(api.game.confirmDamage);
    const selectTarget = useMutation(api.game.selectTarget);
    const cancelTarget = useMutation(api.game.cancelTarget);

    // --- Interaction modes ---

    const isPayingCast =
        isMe && !!pendingCast && pendingCast.playerId === playerId;

    const isSelectingTarget =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        isTargetableCreature(pendingTarget.targetType);

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

    const isOrderingBlockers =
        phase === "DECLARE_BLOCKERS" &&
        !!combat &&
        combat.blockersConfirmed &&
        combat.blockerOrderConfirmed === false &&
        isMe &&
        playerId === activePlayerId;

    const isAssigningDamage =
        phase === "COMBAT_DAMAGE" &&
        !!combat &&
        combat.damageConfirmed === false &&
        isMe &&
        playerId === activePlayerId;

    // --- Combat derived state ---

    const selectedAttackerIds = combat?.attackerIds ?? [];
    const blockerAssignments = combat?.blockerAssignments ?? {};
    const pendingBlockerId = combat?.pendingBlockerId;

    const combatGroupColors = useMemo(() => {
        const map: Record<string, number> = {};
        if (!combat) return map;
        const attackersWithBlockers = new Set(
            Object.values(combat.blockerAssignments)
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

    const blockersPerAttacker = useMemo(() => {
        const map: Record<string, string[]> = {};
        if (!combat) return map;
        for (const [blockerId, attackerId] of Object.entries(
            combat.blockerAssignments
        )) {
            if (!map[attackerId]) map[attackerId] = [];
            map[attackerId].push(blockerId);
        }
        return map;
    }, [combat]);

    const allDamageAssigned = useMemo(() => {
        if (!isAssigningDamage || !combat) return false;
        for (const attackerId of combat.attackerIds) {
            if ((blockersPerAttacker[attackerId]?.length ?? 0) < 2) continue;
            const attacker = player.battlefield.find(
                (c) => c.id === attackerId
            );
            if (!attacker) continue;
            const power = Math.max(
                0,
                attacker.power ?? attacker.card.power ?? 0
            );
            const total = Object.values(
                combat.damageAssignments?.[attackerId] ?? {}
            ).reduce((s, n) => s + n, 0);
            if (total !== power) return false;
        }
        return true;
    }, [isAssigningDamage, combat, blockersPerAttacker, player.battlefield]);

    // --- Card-level logic ---

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
            const attackerFlies =
                attacker.staticAbilities?.includes("flying") ?? false;
            if (!attackerFlies || hasFlying || hasReach) return true;
        }
        return false;
    }

    function canInteract(card: CardInstance): boolean {
        if (isSelectingTarget && isCreature(card)) return true;

        if (isSelectingAttackers && isCreature(card)) {
            if (selectedAttackerIds.includes(card.id)) return true;
            if (card.staticAbilities?.includes("defender")) return false;
            return !card.isTapped && !card.isSummoningSick;
        }

        if (isSelectingBlockers && isCreature(card)) {
            if (blockerAssignments[card.id] !== undefined) return true;
            if (pendingBlockerId === card.id) return true;
            return !card.isTapped && canBlockAnyAttacker(card);
        }

        if (isBlockerTarget && card.isAttacking) return true;

        if (!isMe || !isLand(card)) return false;
        if (isPayingCast) {
            return card.isTapped
                ? pendingCast!.tappedLandIds.includes(card.id)
                : getLandManaColor(card) !== null;
        }
        return card.isTapped ? !card.manaCommitted : true;
    }

    function getVisualState(card: CardInstance): CardVisualState {
        const creature = isCreature(card);
        const land = isLand(card);

        const interactive =
            (isSelectingTarget && creature) ||
            (isMe &&
                (land ||
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
                blockerAssignments[card.id] === undefined &&
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
            blockerAssignments[card.id] !== undefined ||
            card.isBlocking
        ) {
            combatOffset = towardCenter;
        }

        // Ring class
        let ringClass = "";
        if (pendingBlockerId === card.id) {
            ringClass = "ring-2 ring-amber-400 rounded-lg";
        } else if (
            card.isAttacking &&
            combatGroupColors[card.id] !== undefined
        ) {
            ringClass = `ring-2 ${COMBAT_GROUP_RING[combatGroupColors[card.id]]} rounded-lg`;
        } else {
            const targetAtkId = blockerAssignments[card.id];
            if (targetAtkId && combatGroupColors[targetAtkId] !== undefined) {
                ringClass = `ring-2 ${COMBAT_GROUP_RING[combatGroupColors[targetAtkId]]} rounded-lg`;
            } else if (
                selectedAttackerIds.includes(card.id) &&
                !combat?.confirmed
            ) {
                ringClass = "ring-2 ring-red-500 rounded-lg";
            }
        }
        if (!ringClass && isSelectingTarget && creature) {
            ringClass = "ring-2 ring-orange-400 rounded-lg";
        }

        // Badge
        let badge: { color: string; index: number } | null = null;
        if (combatGroupColors[card.id] !== undefined) {
            badge = {
                color: COMBAT_GROUP_BG[combatGroupColors[card.id]],
                index: combatGroupColors[card.id],
            };
        } else {
            const targetAtkId = blockerAssignments[card.id];
            if (targetAtkId && combatGroupColors[targetAtkId] !== undefined) {
                badge = {
                    color: COMBAT_GROUP_BG[combatGroupColors[targetAtkId]],
                    index: combatGroupColors[targetAtkId],
                };
            }
        }

        return { interactive, enabled, dimmed, combatOffset, ringClass, badge };
    }

    function handleClick(card: CardInstance) {
        if (!canInteract(card)) return;

        if (isSelectingTarget && isCreature(card)) {
            selectTarget({
                gameId,
                playerId,
                targetType: "creature",
                targetId: card.id,
            });
            return;
        }
        if (isSelectingAttackers && isCreature(card)) {
            toggleAttacker({ gameId, playerId, cardInstanceId: card.id });
            return;
        }
        if (isSelectingBlockers && isCreature(card)) {
            selectBlocker({ gameId, playerId, cardInstanceId: card.id });
            return;
        }
        if (isBlockerTarget && card.isAttacking) {
            assignBlockerTarget({ gameId, playerId, attackerId: card.id });
            return;
        }

        // Land tap/untap
        if (isPayingCast) {
            const mut = card.isTapped ? untapForPayment : tapForPayment;
            mut({ gameId, playerId, cardInstanceId: card.id });
        } else {
            tapUntap({ gameId, playerId, cardInstanceId: card.id });
        }
    }

    // --- Rendering ---

    const creatures = player.battlefield.filter(isCreature);
    const lands = player.battlefield.filter((c) => isLand(c) && !isCreature(c));
    const others = player.battlefield.filter(
        (c) => !isCreature(c) && !isLand(c)
    );

    function renderGroup(group: CardInstance[]) {
        if (group.length === 1) {
            const vs = getVisualState(group[0]);
            return (
                <div key={group[0].id} className="flex">
                    <BattlefieldCard
                        card={group[0]}
                        vs={vs}
                        onClick={() => handleClick(group[0])}
                    />
                </div>
            );
        }
        const overlapWidth = `${0.5 * (group.length - 1) + 1}`;
        return (
            <div
                key={group[0].card.name}
                className="flex"
                style={{ width: `calc(8rem * ${overlapWidth})` }}
            >
                {group.map((card, i) => {
                    const vs = getVisualState(card);
                    return (
                        <BattlefieldCard
                            key={card.id}
                            card={card}
                            vs={vs}
                            onClick={() => handleClick(card)}
                            style={{
                                width: "8rem",
                                flexShrink: 0,
                                marginLeft: i > 0 ? "-4rem" : undefined,
                                zIndex: i,
                            }}
                        />
                    );
                })}
            </div>
        );
    }

    function renderZone(cards: CardInstance[]) {
        return groupByName(cards).map(renderGroup);
    }

    const blockerCount = Object.keys(blockerAssignments).length;
    const opponent = allPlayers.find((p) => p.id !== activePlayerId);

    return (
        <div
            className={`absolute w-full h-2/3 p-4 flex flex-col ${isMe ? "top-0" : "bottom-0"}`}
        >
            {isMe ? (
                <div className="flex flex-col gap-2">
                    <div className="flex-1 flex gap-2 justify-center items-center">
                        {renderZone(creatures)}
                    </div>
                    <div className="flex-1 flex">
                        <div className="flex-1 flex gap-2 justify-center items-center">
                            {renderZone(lands)}
                        </div>
                        <div className="flex-1 flex gap-2 justify-center items-center">
                            {renderZone(others)}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex-1 flex">
                        <div className="flex-1 flex gap-2 justify-center items-center">
                            {renderZone(lands)}
                        </div>
                        <div className="flex-1 flex gap-2 justify-center items-center">
                            {renderZone(others)}
                        </div>
                    </div>
                    <div className="flex-1 flex gap-2 justify-center items-center">
                        {renderZone(creatures)}
                    </div>
                </>
            )}

            {isSelectingTarget && (
                <ActionButton
                    onClick={() => cancelTarget({ gameId, playerId })}
                    label="Cancel Target"
                />
            )}
            {isPayingCast && (
                <ActionButton
                    onClick={() => cancelCast({ gameId, playerId })}
                    label="Cancel Cast"
                />
            )}
            {isSelectingAttackers && (
                <ActionButton
                    onClick={() => confirmAttackers({ gameId, playerId })}
                    label={
                        selectedAttackerIds.length > 0
                            ? `Confirm Attackers (${selectedAttackerIds.length})`
                            : "Skip Attack"
                    }
                />
            )}
            {isSelectingBlockers && (
                <ActionButton
                    onClick={() => confirmBlockers({ gameId, playerId })}
                    label={
                        blockerCount > 0
                            ? `Confirm Blockers (${blockerCount})`
                            : "No Blockers"
                    }
                    color="blue"
                />
            )}
            {isOrderingBlockers && (
                <BlockerOrderPanel
                    combat={combat!}
                    opponentBattlefield={opponent?.battlefield ?? []}
                    combatGroupColors={combatGroupColors}
                    gameId={gameId}
                    playerId={playerId}
                />
            )}
            {isAssigningDamage && (
                <>
                    <DamageAssignmentPanel
                        combat={combat!}
                        player={player}
                        opponentBattlefield={opponent?.battlefield ?? []}
                        blockersPerAttacker={blockersPerAttacker}
                        combatGroupColors={combatGroupColors}
                        gameId={gameId}
                        playerId={playerId}
                        defenderId={opponent?.id ?? ""}
                    />
                    <ActionButton
                        onClick={() => confirmDamage({ gameId, playerId })}
                        label="Confirm Damage"
                        disabled={!allDamageAssigned}
                    />
                </>
            )}
        </div>
    );
}
