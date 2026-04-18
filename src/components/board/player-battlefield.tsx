import { useCallback, useEffect, useMemo, useState } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    isCreature,
    isLand,
    getLandManaColor,
    getActivatedManaColor,
    hasManaAbility,
    getManaChoices,
    getStackAbilities,
    wantsPermanentTarget,
    matchesTargetRequirement,
    groupByName,
} from "~/lib/card-utils";
import { COMBAT_GROUP_RING, COMBAT_GROUP_BG } from "~/lib/combat-colors";
import BattlefieldCard, { type CardVisualState } from "./battlefield-card";
import DamageAssignmentPanel from "./damage-assignment-panel";
import BlockerOrderPanel from "./blocker-order-panel";
import ActionButton from "./action-button";
import ManaChoicePicker from "./mana-choice-picker";

// ---------------------------------------------------------------------------
// PlayerBattlefield
// ---------------------------------------------------------------------------

export default function PlayerBattlefield({ player }: { player: Player }) {
    const {
        gameId,
        playerId,
        activePlayerId,
        priorityPlayerId,
        phase,
        pendingCast,
        pendingTarget,
        undoableBy,
        combat,
        allPlayers,
    } = useGameContext();
    const isMe = player.id === playerId;
    const canUndo = isMe && undoableBy === playerId;

    // Mutations
    const tapUntap = useMutation(api.game.tapUntap);
    const tapForPayment = useMutation(api.game.tapForPayment);
    const untapForPayment = useMutation(api.game.untapForPayment);
    const undoManaAbility = useMutation(api.game.undoManaAbility);
    const cancelCast = useMutation(api.game.cancelCast);
    const toggleAttacker = useMutation(api.game.toggleAttacker);
    const confirmAttackers = useMutation(api.game.confirmAttackers);
    const selectBlocker = useMutation(api.game.selectBlocker);
    const assignBlockerTarget = useMutation(api.game.assignBlockerTarget);
    const confirmBlockers = useMutation(api.game.confirmBlockers);
    const confirmDamage = useMutation(api.game.confirmDamage);
    const selectTarget = useMutation(api.game.selectTarget);
    const activateAbility = useMutation(api.game.activateAbility);

    // Mana choice picker state
    const [manaChoiceState, setManaChoiceState] = useState<{
        cardId: string;
        choices: import("~/types/cards").ManaCost[];
        position: { x: number; y: number };
    } | null>(null);

    // --- Undo shortcut (Ctrl/Cmd+Z) ---

    const handleUndo = useCallback(() => {
        if (canUndo) {
            undoManaAbility({ gameId, playerId });
        }
    }, [canUndo, undoManaAbility, gameId, playerId]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === "z") {
                e.preventDefault();
                handleUndo();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [handleUndo]);

    // --- Interaction modes ---

    const isPayingCast =
        isMe && !!pendingCast && pendingCast.playerId === playerId;

    const isSelectingTarget =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsPermanentTarget(pendingTarget.targetType);

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
        // During target selection, ONLY valid targets are interactive
        if (isSelectingTarget) {
            return (
                !!pendingTarget &&
                matchesTargetRequirement(card, pendingTarget.targetType)
            );
        }

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

        if (!isMe || !hasManaAbility(card)) return false;
        if (isPayingCast) {
            return card.isTapped
                ? pendingCast!.tappedLandIds.includes(card.id)
                : (getLandManaColor(card) ?? getActivatedManaColor(card)) !==
                      null;
        }
        return card.isTapped ? !card.manaCommitted : true;
    }

    function getVisualState(card: CardInstance): CardVisualState {
        const creature = isCreature(card);
        const manaSource = hasManaAbility(card);

        const isValidTarget =
            isSelectingTarget &&
            pendingTarget &&
            matchesTargetRequirement(card, pendingTarget.targetType);

        const interactive = isSelectingTarget
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
        if (!ringClass && isValidTarget) {
            ringClass = "ring-2 ring-orange-400 rounded-lg";
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
            const targetAtkId = blockerAssignments[card.id];
            if (targetAtkId && combatGroupColors[targetAtkId] !== undefined) {
                badge = {
                    color: COMBAT_GROUP_BG[combatGroupColors[targetAtkId]],
                    index: combatGroupColors[targetAtkId],
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

    function handleClick(card: CardInstance) {
        if (!canInteract(card)) return;

        if (
            isSelectingTarget &&
            pendingTarget &&
            matchesTargetRequirement(card, pendingTarget.targetType)
        ) {
            selectTarget({
                gameId,
                playerId,
                targetType: "permanent",
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

        // Mana source tap/untap (lands, mox, etc.)
        if (isPayingCast) {
            const mut = card.isTapped ? untapForPayment : tapForPayment;
            mut({ gameId, playerId, cardInstanceId: card.id });
        } else {
            // Check for mana choices (e.g. Black Lotus) — show picker
            const choices = getManaChoices(card);
            if (choices && !card.isTapped) {
                // We don't have mouse event coords here, so we use a fixed position
                // The event is passed from the card component
                setManaChoiceState({
                    cardId: card.id,
                    choices,
                    position: { x: 0, y: 0 },
                });
            } else {
                tapUntap({ gameId, playerId, cardInstanceId: card.id });
            }
        }
    }

    function handleClickWithEvent(card: CardInstance, e: React.MouseEvent) {
        // During target selection, only allow target clicks — skip all other interactions
        if (isSelectingTarget) {
            handleClick(card);
            return;
        }
        const choices = getManaChoices(card);
        if (
            isMe &&
            choices &&
            !card.isTapped &&
            !isPayingCast &&
            canInteract(card)
        ) {
            setManaChoiceState({
                cardId: card.id,
                choices,
                position: { x: e.clientX, y: e.clientY - 50 },
            });
            return;
        }
        handleClick(card);
    }

    // --- Activated abilities ---

    const hasPriority = isMe && priorityPlayerId === playerId;

    function getActivatable(card: CardInstance) {
        if (!hasPriority || pendingCast || pendingTarget) return [];
        return getStackAbilities(card, player.manaPool);
    }

    function handleActivateAbility(cardInstanceId: string, abilityId: string) {
        activateAbility({ gameId, playerId, cardInstanceId, abilityId });
    }

    // --- Rendering ---

    const creatures = player.battlefield.filter(isCreature);
    const lands = player.battlefield.filter((c) => isLand(c) && !isCreature(c));
    const others = player.battlefield.filter(
        (c) => !isCreature(c) && !isLand(c)
    );

    function renderGroup(group: CardInstance[]) {
        if (group.length === 1) {
            const card = group[0];
            const vs = getVisualState(card);
            const abilities = getActivatable(card);
            return (
                <div key={card.id} className="flex">
                    <BattlefieldCard
                        card={card}
                        vs={vs}
                        onClick={(e) => handleClickWithEvent(card, e)}
                        activatableAbilities={abilities}
                        onActivateAbility={(aId) =>
                            handleActivateAbility(card.id, aId)
                        }
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
                    const abilities = getActivatable(card);
                    return (
                        <BattlefieldCard
                            key={card.id}
                            card={card}
                            vs={vs}
                            onClick={(e) => handleClickWithEvent(card, e)}
                            activatableAbilities={abilities}
                            onActivateAbility={(aId) =>
                                handleActivateAbility(card.id, aId)
                            }
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

            {canUndo && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40">
                    <button
                        onClick={handleUndo}
                        className="font-bold px-3 py-1 rounded-lg text-xs bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
                    >
                        Undo
                        <span className="ml-1 opacity-60">[Ctrl+Z]</span>
                    </button>
                </div>
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
                    shortcut="space"
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
                    shortcut="space"
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

            {manaChoiceState && (
                <ManaChoicePicker
                    choices={manaChoiceState.choices}
                    position={manaChoiceState.position}
                    onSelect={(index) => {
                        tapUntap({
                            gameId,
                            playerId,
                            cardInstanceId: manaChoiceState.cardId,
                            manaChoiceIndex: index,
                        });
                        setManaChoiceState(null);
                    }}
                    onCancel={() => setManaChoiceState(null)}
                />
            )}
        </div>
    );
}
