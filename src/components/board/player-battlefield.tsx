import { useMemo } from "react";
import type { CardInstance, Player } from "~/types/game";
import type { Color } from "~/types/cards";
import { useGameContext } from "~/hooks/useGameContext";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import CardImage from "../cards/card-image";

type BattlefieldProps = {
    player: Player;
};

function isLand(card: CardInstance): boolean {
    return card.card.types.includes("Land");
}

function isCreature(card: CardInstance): boolean {
    return card.card.types.includes("Creature");
}

const LAND_SUBTYPE_MANA: Record<string, Color> = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
};

function getLandManaColor(card: CardInstance): Color | null {
    for (const subtype of card.card.subtypes ?? []) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) return color;
    }
    return null;
}

/** Groups cards by name, preserving order of first appearance. */
function groupByName(cards: CardInstance[]): CardInstance[][] {
    const groups: Map<string, CardInstance[]> = new Map();
    for (const card of cards) {
        const name = card.card.name;
        const group = groups.get(name);
        if (group) {
            group.push(card);
        } else {
            groups.set(name, [card]);
        }
    }
    return [...groups.values()];
}

/** Color palette for combat groups (attacker + its blockers share a color). */
const COMBAT_GROUP_COLORS = [
    "ring-red-500",
    "ring-blue-500",
    "ring-green-500",
    "ring-yellow-500",
];
const COMBAT_GROUP_BG = [
    "bg-red-500",
    "bg-blue-500",
    "bg-green-500",
    "bg-yellow-500",
];

export default function PlayerBattlefield({ player }: BattlefieldProps) {
    const {
        gameId,
        playerId,
        activePlayerId,
        phase,
        pendingCast,
        combat,
        allPlayers,
    } = useGameContext();
    const isMe = player.id === playerId;
    const tapUntap = useMutation(api.game.tapUntap);
    const tapForPayment = useMutation(api.game.tapForPayment);
    const untapForPayment = useMutation(api.game.untapForPayment);
    const cancelCast = useMutation(api.game.cancelCast);
    const toggleAttacker = useMutation(api.game.toggleAttacker);
    const confirmAttackersMut = useMutation(api.game.confirmAttackers);
    const selectBlockerMut = useMutation(api.game.selectBlocker);
    const assignBlockerTargetMut = useMutation(api.game.assignBlockerTarget);
    const confirmBlockersMut = useMutation(api.game.confirmBlockers);
    const setDamageAssignmentMut = useMutation(api.game.setDamageAssignment);
    const confirmDamageMut = useMutation(api.game.confirmDamage);

    const isPayingCast =
        isMe && !!pendingCast && pendingCast.playerId === playerId;

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

    // Opponent's attacking creatures become clickable as blocker targets
    const isBlockerTarget =
        !isMe &&
        phase === "DECLARE_BLOCKERS" &&
        !!combat &&
        !combat.blockersConfirmed &&
        !!combat.pendingBlockerId &&
        playerId !== activePlayerId;

    const isAssigningDamage =
        phase === "COMBAT_DAMAGE" &&
        !!combat &&
        combat.damageConfirmed === false &&
        isMe &&
        playerId === activePlayerId;

    const selectedAttackerIds = combat?.attackerIds ?? [];
    const blockerAssignments = combat?.blockerAssignments ?? {};
    const pendingBlockerId = combat?.pendingBlockerId;

    // Build combat group color map: attackerId → color index (only for attackers with blockers)
    const combatGroupColors = useMemo(() => {
        const map: Record<string, number> = {};
        if (!combat) return map;
        const attackersWithBlockers = new Set(
            Object.values(combat.blockerAssignments)
        );
        let colorIdx = 0;
        for (const attackerId of combat.attackerIds) {
            if (attackersWithBlockers.has(attackerId)) {
                map[attackerId] = colorIdx % COMBAT_GROUP_COLORS.length;
                colorIdx++;
            }
        }
        return map;
    }, [combat]);

    // Invert blockerAssignments for damage UI: attackerId → blockerId[]
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

    const creatures = player.battlefield.filter(isCreature);
    const lands = player.battlefield.filter((c) => isLand(c) && !isCreature(c));
    const others = player.battlefield.filter(
        (c) => !isCreature(c) && !isLand(c)
    );

    function handleClick(cardInstance: CardInstance) {
        if (!canInteract(cardInstance)) return;

        // Attacker selection
        if (isSelectingAttackers && isCreature(cardInstance)) {
            toggleAttacker({
                gameId,
                playerId,
                cardInstanceId: cardInstance.id,
            });
            return;
        }

        // Blocker selection (own creature)
        if (isSelectingBlockers && isCreature(cardInstance)) {
            selectBlockerMut({
                gameId,
                playerId,
                cardInstanceId: cardInstance.id,
            });
            return;
        }

        // Blocker target assignment (opponent's attacking creature)
        if (isBlockerTarget && cardInstance.isAttacking) {
            assignBlockerTargetMut({
                gameId,
                playerId,
                attackerId: cardInstance.id,
            });
            return;
        }

        // Land tap/untap
        if (isPayingCast) {
            if (cardInstance.isTapped) {
                untapForPayment({
                    gameId,
                    playerId,
                    cardInstanceId: cardInstance.id,
                });
            } else {
                tapForPayment({
                    gameId,
                    playerId,
                    cardInstanceId: cardInstance.id,
                });
            }
        } else {
            tapUntap({ gameId, playerId, cardInstanceId: cardInstance.id });
        }
    }

    function canInteract(cardInstance: CardInstance): boolean {
        // During attacker selection, own creatures are interactive
        if (isSelectingAttackers && isCreature(cardInstance)) {
            if (selectedAttackerIds.includes(cardInstance.id)) return true;
            return !cardInstance.isTapped && !cardInstance.isSummoningSick;
        }

        // During blocker selection, own untapped creatures are interactive
        if (isSelectingBlockers && isCreature(cardInstance)) {
            // Already assigned or pending → can deselect/unassign
            if (blockerAssignments[cardInstance.id] !== undefined) return true;
            if (pendingBlockerId === cardInstance.id) return true;
            // Eligible: untapped creature
            return !cardInstance.isTapped;
        }

        // Opponent's attacking creatures are clickable as blocker targets
        if (isBlockerTarget && cardInstance.isAttacking) {
            return true;
        }

        if (!isMe || !isLand(cardInstance)) return false;
        if (isPayingCast) {
            if (cardInstance.isTapped) {
                return pendingCast!.tappedLandIds.includes(cardInstance.id);
            }
            return getLandManaColor(cardInstance) !== null;
        }
        if (cardInstance.isTapped) {
            return !cardInstance.manaCommitted;
        }
        return true;
    }

    function getCombatRingClass(cardInstance: CardInstance): string {
        // Pending blocker: amber ring
        if (pendingBlockerId === cardInstance.id) {
            return "ring-2 ring-amber-400 rounded-lg";
        }

        // This card is an attacker with blockers → group color ring
        if (
            cardInstance.isAttacking &&
            combatGroupColors[cardInstance.id] !== undefined
        ) {
            return `ring-2 ${COMBAT_GROUP_COLORS[combatGroupColors[cardInstance.id]]} rounded-lg`;
        }

        // This card is an assigned blocker → group color ring (same as its target attacker)
        const targetAttackerId = blockerAssignments[cardInstance.id];
        if (
            targetAttackerId &&
            combatGroupColors[targetAttackerId] !== undefined
        ) {
            return `ring-2 ${COMBAT_GROUP_COLORS[combatGroupColors[targetAttackerId]]} rounded-lg`;
        }

        // Attacker selected (pre-confirmation) → red ring
        if (
            selectedAttackerIds.includes(cardInstance.id) &&
            !combat?.confirmed
        ) {
            return "ring-2 ring-red-500 rounded-lg";
        }

        return "";
    }

    function getCombatOffset(cardInstance: CardInstance): string {
        // Attackers: translate toward center
        if (
            combat &&
            !combat.confirmed &&
            selectedAttackerIds.includes(cardInstance.id)
        ) {
            return isMe ? "-translate-y-8" : "translate-y-8";
        }
        if (cardInstance.isAttacking) {
            return isMe ? "-translate-y-8" : "translate-y-8";
        }

        // Blockers: translate toward center
        if (blockerAssignments[cardInstance.id] !== undefined) {
            return isMe ? "-translate-y-8" : "translate-y-8";
        }
        if (cardInstance.isBlocking) {
            return isMe ? "-translate-y-8" : "translate-y-8";
        }

        return "";
    }

    function getCombatBadge(
        cardInstance: CardInstance
    ): { color: string; index: number } | null {
        // Attacker with blockers
        if (combatGroupColors[cardInstance.id] !== undefined) {
            return {
                color: COMBAT_GROUP_BG[combatGroupColors[cardInstance.id]],
                index: combatGroupColors[cardInstance.id],
            };
        }
        // Blocker assigned to an attacker
        const targetAttackerId = blockerAssignments[cardInstance.id];
        if (
            targetAttackerId &&
            combatGroupColors[targetAttackerId] !== undefined
        ) {
            return {
                color: COMBAT_GROUP_BG[combatGroupColors[targetAttackerId]],
                index: combatGroupColors[targetAttackerId],
            };
        }
        return null;
    }

    function renderCard(cardInstance: CardInstance) {
        const isLandCard = isLand(cardInstance);
        const isCreatureCard = isCreature(cardInstance);
        const interactive =
            (isMe &&
                (isLandCard ||
                    (isSelectingAttackers && isCreatureCard) ||
                    (isSelectingBlockers && isCreatureCard))) ||
            (isBlockerTarget && cardInstance.isAttacking);
        const enabled = canInteract(cardInstance);
        const combatOffset = getCombatOffset(cardInstance);
        const combatRing = getCombatRingClass(cardInstance);
        const badge = getCombatBadge(cardInstance);
        const dimmedSick =
            isSelectingAttackers &&
            isCreatureCard &&
            !selectedAttackerIds.includes(cardInstance.id) &&
            (cardInstance.isTapped || cardInstance.isSummoningSick);

        return (
            <div
                key={cardInstance.id}
                className={`relative w-32 transition-transform duration-150 ${
                    cardInstance.isTapped ? "rotate-90" : ""
                } ${combatOffset} ${combatRing} ${
                    interactive
                        ? enabled
                            ? "cursor-pointer"
                            : "cursor-not-allowed opacity-60"
                        : ""
                } ${dimmedSick ? "opacity-40" : ""}`}
                onClick={() => handleClick(cardInstance)}
            >
                <CardImage card={cardInstance.card} />
                {badge && (
                    <div
                        className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${badge.color} text-white text-xs font-bold flex items-center justify-center z-10`}
                    >
                        {badge.index + 1}
                    </div>
                )}
            </div>
        );
    }

    function renderGroup(group: CardInstance[]) {
        if (group.length === 1) {
            return (
                <div key={group[0].id} className="flex">
                    {renderCard(group[0])}
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
                    const isLandCard = isLand(card);
                    const isCreatureCard = isCreature(card);
                    const interactive =
                        (isMe &&
                            (isLandCard ||
                                (isSelectingAttackers && isCreatureCard) ||
                                (isSelectingBlockers && isCreatureCard))) ||
                        (isBlockerTarget && card.isAttacking);
                    const enabled = canInteract(card);
                    const combatOffset = getCombatOffset(card);
                    const combatRing = getCombatRingClass(card);
                    const badge = getCombatBadge(card);
                    const dimmedSick =
                        isSelectingAttackers &&
                        isCreatureCard &&
                        !selectedAttackerIds.includes(card.id) &&
                        (card.isTapped || card.isSummoningSick);

                    return (
                        <div
                            key={card.id}
                            className={`relative transition-transform duration-150 ${
                                card.isTapped ? "rotate-90" : ""
                            } ${combatOffset} ${combatRing} ${
                                interactive
                                    ? enabled
                                        ? "cursor-pointer"
                                        : "cursor-not-allowed opacity-60"
                                    : ""
                            } ${dimmedSick ? "opacity-40" : ""}`}
                            style={{
                                width: "8rem",
                                flexShrink: 0,
                                marginLeft: i > 0 ? "-4rem" : undefined,
                                zIndex: i,
                            }}
                            onClick={() => handleClick(card)}
                        >
                            <CardImage card={card.card} />
                            {badge && (
                                <div
                                    className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${badge.color} text-white text-xs font-bold flex items-center justify-center z-10`}
                                >
                                    {badge.index + 1}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }

    function renderZone(cards: CardInstance[]) {
        return groupByName(cards).map(renderGroup);
    }

    // Damage assignment UI: for each attacker with 2+ blockers
    function renderDamageAssignment() {
        if (!isAssigningDamage || !combat) return null;

        const attackersNeedingAssignment = combat.attackerIds.filter(
            (id) => (blockersPerAttacker[id]?.length ?? 0) >= 2
        );
        if (attackersNeedingAssignment.length === 0) return null;

        const myPlayer = player; // isMe is true when isAssigningDamage

        return (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 bg-black/90 border border-white/20 rounded-lg p-3 text-white text-sm max-w-md">
                <div className="font-bold mb-2">Assign Combat Damage</div>
                {attackersNeedingAssignment.map((attackerId) => {
                    const attacker = myPlayer.battlefield.find(
                        (c) => c.id === attackerId
                    );
                    if (!attacker) return null;
                    const power = Math.max(0, attacker.card.power ?? 0);
                    const blockerIds = blockersPerAttacker[attackerId] ?? [];
                    const assignments =
                        combat.damageAssignments?.[attackerId] ?? {};
                    const assigned = Object.values(assignments).reduce(
                        (s, n) => s + n,
                        0
                    );
                    const colorIdx = combatGroupColors[attackerId];
                    const groupColor =
                        colorIdx !== undefined
                            ? COMBAT_GROUP_BG[colorIdx]
                            : "bg-gray-500";

                    return (
                        <div key={attackerId} className="mb-2 last:mb-0">
                            <div className="flex items-center gap-2 mb-1">
                                <div
                                    className={`w-3 h-3 rounded-full ${groupColor}`}
                                />
                                <span className="font-medium">
                                    {(attacker.card.name as string) ??
                                        "Attacker"}{" "}
                                    ({power} dmg)
                                </span>
                                <span
                                    className={
                                        assigned === power
                                            ? "text-green-400"
                                            : "text-red-400"
                                    }
                                >
                                    {assigned}/{power}
                                </span>
                            </div>
                            {blockerIds.map((blockerId) => {
                                const blocker =
                                    // Blocker is on the OPPONENT's battlefield
                                    allPlayers
                                        .find((p) => p.id !== activePlayerId)
                                        ?.battlefield.find(
                                            (c) => c.id === blockerId
                                        );
                                const dmg = assignments[blockerId] ?? 0;

                                return (
                                    <div
                                        key={blockerId}
                                        className="flex items-center gap-2 ml-4"
                                    >
                                        <span className="flex-1 truncate">
                                            {(blocker?.card?.name as string) ??
                                                "Blocker"}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (dmg <= 0) return;
                                                const newAssignments = {
                                                    ...assignments,
                                                    [blockerId]: dmg - 1,
                                                };
                                                setDamageAssignmentMut({
                                                    gameId,
                                                    playerId,
                                                    attackerId,
                                                    assignments: newAssignments,
                                                });
                                            }}
                                            className="w-6 h-6 bg-white/20 hover:bg-white/30 rounded text-center leading-6"
                                        >
                                            -
                                        </button>
                                        <span className="w-6 text-center font-mono">
                                            {dmg}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (assigned >= power) return;
                                                const newAssignments = {
                                                    ...assignments,
                                                    [blockerId]: dmg + 1,
                                                };
                                                setDamageAssignmentMut({
                                                    gameId,
                                                    playerId,
                                                    attackerId,
                                                    assignments: newAssignments,
                                                });
                                            }}
                                            className="w-6 h-6 bg-white/20 hover:bg-white/30 rounded text-center leading-6"
                                        >
                                            +
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        );
    }

    // Check if all damage assignments are valid for the confirm button
    const allDamageAssigned = useMemo(() => {
        if (!isAssigningDamage || !combat) return false;
        const attackersNeedingAssignment = combat.attackerIds.filter(
            (id) => (blockersPerAttacker[id]?.length ?? 0) >= 2
        );
        for (const attackerId of attackersNeedingAssignment) {
            const attacker = player.battlefield.find(
                (c) => c.id === attackerId
            );
            if (!attacker) continue;
            const power = Math.max(0, attacker.card.power ?? 0);
            const assignments = combat.damageAssignments?.[attackerId] ?? {};
            const total = Object.values(assignments).reduce((s, n) => s + n, 0);
            if (total !== power) return false;
        }
        return true;
    }, [isAssigningDamage, combat, blockersPerAttacker, player.battlefield]);

    const blockerCount = Object.keys(blockerAssignments).length;

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
            {isPayingCast && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40">
                    <button
                        onClick={() => cancelCast({ gameId, playerId })}
                        className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-1 rounded-lg text-sm transition-colors"
                    >
                        Cancel Cast
                    </button>
                </div>
            )}
            {isSelectingAttackers && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40">
                    <button
                        onClick={() =>
                            confirmAttackersMut({ gameId, playerId })
                        }
                        className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-1 rounded-lg text-sm transition-colors"
                    >
                        {selectedAttackerIds.length > 0
                            ? `Confirm Attackers (${selectedAttackerIds.length})`
                            : "Skip Attack"}
                    </button>
                </div>
            )}
            {isSelectingBlockers && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40">
                    <button
                        onClick={() => confirmBlockersMut({ gameId, playerId })}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-1 rounded-lg text-sm transition-colors"
                    >
                        {blockerCount > 0
                            ? `Confirm Blockers (${blockerCount})`
                            : "No Blockers"}
                    </button>
                </div>
            )}
            {isAssigningDamage && (
                <>
                    {renderDamageAssignment()}
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40">
                        <button
                            onClick={() =>
                                confirmDamageMut({ gameId, playerId })
                            }
                            disabled={!allDamageAssigned}
                            className={`font-bold px-4 py-1 rounded-lg text-sm transition-colors ${
                                allDamageAssigned
                                    ? "bg-red-600 hover:bg-red-500 text-white"
                                    : "bg-gray-600 text-gray-400 cursor-not-allowed"
                            }`}
                        >
                            Confirm Damage
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
