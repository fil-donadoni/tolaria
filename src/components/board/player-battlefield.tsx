import { useMemo, useState } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getCardById } from "@convex/cards";
import {
    isCreature,
    isLand,
    isLandwalkUnblockable,
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
import ManaChoicePicker from "./mana-choice-picker";
import ValidationToast from "./validation-toast";
import { extractMutationErrorMessage } from "~/lib/mutation-error";

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
        pendingActivation,
        pendingTarget,
        combat,
        allPlayers,
    } = useGameContext();
    const isMe = player.id === playerId;

    // Mutations
    const tapUntap = useMutation(api.game.tapUntap);
    const tapForPayment = useMutation(api.game.tapForPayment);
    const untapForPayment = useMutation(api.game.untapForPayment);
    const tapForActivationPayment = useMutation(
        api.game.tapForActivationPayment
    );
    const untapForActivationPayment = useMutation(
        api.game.untapForActivationPayment
    );
    const toggleAttacker = useMutation(api.game.toggleAttacker);
    const selectBlocker = useMutation(api.game.selectBlocker);
    const assignBlockerTarget = useMutation(api.game.assignBlockerTarget);
    const selectTarget = useMutation(api.game.selectTarget);
    const activateAbility = useMutation(api.game.activateAbility);

    // Mana choice picker state. `inPayment` routes the selection to
    // tapForPayment (committing the cast) vs tapUntap (floating mana).
    const [manaChoiceState, setManaChoiceState] = useState<{
        cardId: string;
        choices: import("~/types/cards").ManaCost[];
        position: { x: number; y: number };
        inPayment: boolean;
    } | null>(null);

    const [validationError, setValidationError] = useState<string | null>(null);

    function guardMutation(promise: Promise<unknown>) {
        promise.catch((err) => {
            setValidationError(extractMutationErrorMessage(err));
        });
    }

    // --- Interaction modes ---

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
        (phase === "COMBAT_DAMAGE" || phase === "FIRST_STRIKE_DAMAGE") &&
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
            // Landwalk (CR 702.13b): attacker is unblockable if defender
            // controls a land of the matching subtype.
            if (isLandwalkUnblockable(attacker, player.battlefield)) continue;
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
            ringClass = "ring-2 ring-amber-400 rounded-sm";
        } else if (
            card.isAttacking &&
            combatGroupColors[card.id] !== undefined
        ) {
            ringClass = `ring-2 ${COMBAT_GROUP_RING[combatGroupColors[card.id]]} rounded-sm`;
        } else {
            const targetAtkId = blockerAssignments[card.id];
            if (targetAtkId && combatGroupColors[targetAtkId] !== undefined) {
                ringClass = `ring-2 ${COMBAT_GROUP_RING[combatGroupColors[targetAtkId]]} rounded-sm`;
            } else if (
                selectedAttackerIds.includes(card.id) &&
                !combat?.confirmed
            ) {
                ringClass = "ring-2 ring-red-500 rounded-sm";
            }
        }
        if (!ringClass && isValidTarget) {
            ringClass = "ring-2 ring-orange-400 rounded-sm";
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
            guardMutation(
                selectTarget({
                    gameId,
                    playerId,
                    targetType: "permanent",
                    targetId: card.id,
                })
            );
            return;
        }
        if (isSelectingAttackers && isCreature(card)) {
            // CR 508.1d: can't deselect a creature required to attack.
            // Pre-check client-side for instant feedback (the server also
            // rejects this via toggleAttacker).
            const alreadySelected = selectedAttackerIds.includes(card.id);
            const mustAttackClient =
                alreadySelected &&
                (card.staticAbilities?.includes("attacks-if-able") ?? false) &&
                !card.isTapped &&
                !card.isSummoningSick;
            if (mustAttackClient) {
                const name = getCardById(card.card.id).name;
                setValidationError(`${name} must attack this combat if able`);
                return;
            }
            guardMutation(
                toggleAttacker({ gameId, playerId, cardInstanceId: card.id })
            );
            return;
        }
        if (isSelectingBlockers && isCreature(card)) {
            guardMutation(
                selectBlocker({ gameId, playerId, cardInstanceId: card.id })
            );
            return;
        }
        if (isBlockerTarget && card.isAttacking) {
            guardMutation(
                assignBlockerTarget({
                    gameId,
                    playerId,
                    attackerId: card.id,
                })
            );
            return;
        }

        // Mana source tap/untap (lands, mox, etc.)
        if (isInPayment) {
            const tapMutation = isPayingCast
                ? tapForPayment
                : tapForActivationPayment;
            const untapMutation = isPayingCast
                ? untapForPayment
                : untapForActivationPayment;
            if (card.isTapped) {
                guardMutation(
                    untapMutation({
                        gameId,
                        playerId,
                        cardInstanceId: card.id,
                    })
                );
                return;
            }
            const choices = getManaChoices(card);
            if (choices) {
                setManaChoiceState({
                    cardId: card.id,
                    choices,
                    position: { x: 0, y: 0 },
                    inPayment: true,
                });
            } else {
                guardMutation(
                    tapMutation({
                        gameId,
                        playerId,
                        cardInstanceId: card.id,
                    })
                );
            }
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
                    inPayment: false,
                });
            } else {
                guardMutation(
                    tapUntap({ gameId, playerId, cardInstanceId: card.id })
                );
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
        if (isMe && choices && !card.isTapped && canInteract(card)) {
            setManaChoiceState({
                cardId: card.id,
                choices,
                position: { x: e.clientX, y: e.clientY - 50 },
                inPayment: isInPayment,
            });
            return;
        }
        handleClick(card);
    }

    // --- Activated abilities ---

    function getActivatable(card: CardInstance) {
        if (!hasPriority || pendingCast || pendingActivation || pendingTarget) {
            return [];
        }
        // UX: while this player is the one picking attackers/blockers, the
        // context menu would compete with the declaration click target.
        // Suppress it for the declarer only — the other player can still
        // respond with their own abilities.
        const isActivePlayer = playerId === activePlayerId;
        if (phase === "DECLARE_ATTACKERS" && isActivePlayer) return [];
        if (phase === "DECLARE_BLOCKERS" && !isActivePlayer) return [];
        return getStackAbilities(card, phase);
    }

    function handleActivateAbility(
        cardInstanceId: string,
        abilityId: string,
        keepPriority: boolean
    ) {
        guardMutation(
            activateAbility({
                gameId,
                playerId,
                cardInstanceId,
                abilityId,
                keepPriority: keepPriority || undefined,
            })
        );
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
                <div key={card.id} className="flex h-full">
                    <BattlefieldCard
                        card={card}
                        vs={vs}
                        onClick={(e) => handleClickWithEvent(card, e)}
                        activatableAbilities={abilities}
                        onActivateAbility={(aId, keep) =>
                            handleActivateAbility(card.id, aId, keep)
                        }
                    />
                </div>
            );
        }
        const overlapWidth = `${0.5 * (group.length - 1) + 1}`;
        return (
            <div
                key={getCardById(group[0].card.id).name}
                className="flex shrink-0 h-full"
                style={{ width: `calc(var(--card-w) * ${overlapWidth})` }}
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
                            onActivateAbility={(aId, keep) =>
                                handleActivateAbility(card.id, aId, keep)
                            }
                            style={{
                                width: "var(--card-w)",
                                flexShrink: 0,
                                marginLeft:
                                    i > 0
                                        ? "calc(var(--card-w) * -0.5)"
                                        : undefined,
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

    const opponent = allPlayers.find((p) => p.id !== activePlayerId);

    return (
        <div
            className={`flex-1 min-h-0 w-full px-4 py-2 flex flex-col gap-2 relative ${isMe ? "" : "flex-col-reverse"}`}
        >
            <div className="flex-1 min-h-0 flex gap-2 justify-center items-center">
                {renderZone(creatures)}
            </div>
            <div className="flex-1 min-h-0 flex">
                <div className="flex-1 flex gap-2 justify-center items-center">
                    {renderZone(lands)}
                </div>
                <div className="flex-1 flex gap-2 justify-center items-center">
                    {renderZone(others)}
                </div>
            </div>

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
            )}

            {manaChoiceState && (
                <ManaChoicePicker
                    choices={manaChoiceState.choices}
                    position={manaChoiceState.position}
                    onSelect={(index) => {
                        const args = {
                            gameId,
                            playerId,
                            cardInstanceId: manaChoiceState.cardId,
                            manaChoiceIndex: index,
                        };
                        if (manaChoiceState.inPayment) {
                            const mutation = isPayingCast
                                ? tapForPayment
                                : tapForActivationPayment;
                            guardMutation(mutation(args));
                        } else {
                            guardMutation(tapUntap(args));
                        }
                        setManaChoiceState(null);
                    }}
                    onCancel={() => setManaChoiceState(null)}
                />
            )}
            <ValidationToast
                message={validationError}
                onDismiss={() => setValidationError(null)}
            />
        </div>
    );
}
