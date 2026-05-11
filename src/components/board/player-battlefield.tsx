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
    getActivatedManaMenuEntry,
    canRefundManaTap,
    getStackAbilities,
    wantsPermanentTarget,
    matchesPermanentFilter,
    matchesTargetRequirement,
    groupByName,
    isTapLockedBySummoningSickness,
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
        pendingChoices,
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
    const selectResolutionChoice = useMutation(api.game.selectResolutionChoice);
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

    // Mid-resolution choice targeting a battlefield zone (CR 608.2). Only the
    // chooser's own battlefield receives click routing; the opponent's board
    // stays inert even for the chooser's own cards on their opponent's side
    // (Balance never picks from the opponent).
    const activeChoice = pendingChoices?.[0];
    const isSelectingChoice =
        isMe &&
        !!activeChoice &&
        activeChoice.playerId === playerId &&
        activeChoice.zone === "battlefield";

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
        // Mid-resolution choice: only the chooser's own battlefield cards
        // matching the filter are interactive. Already-picked ids stay clickable
        // so the player can deselect (not supported yet — future toggle).
        if (isSelectingChoice && activeChoice) {
            if (activeChoice.selected.includes(card.id)) return false;
            return (
                !activeChoice.filter ||
                matchesPermanentFilter(card, activeChoice.filter)
            );
        }

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
            if (card.isTapped || card.isSummoningSick) return false;
            // CR 508.1c — conditional attack restriction tied to a defender
            // subtype. Server enforces; UI mirrors so the option isn't even
            // offered.
            for (const ab of card.staticAbilities ?? []) {
                const m = ab.match(
                    /^cant-attack-unless-defender-controls-(.+)$/
                );
                if (!m) continue;
                const requiredSubtype = m[1];
                const defender = allPlayers.find((p) => p.id !== player.id);
                const ok = !!defender?.battlefield.some((c) =>
                    c.subtypes?.includes(requiredSubtype)
                );
                if (!ok) return false;
            }
            return true;
        }

        if (isSelectingBlockers && isCreature(card)) {
            if (blockerAssignments[card.id] !== undefined) return true;
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
            activeChoice.selected.includes(card.id);

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
        if (!ringClass && isTargetSelected) {
            ringClass = "ring-2 ring-emerald-400 rounded-sm";
        } else if (!ringClass && isValidTarget) {
            ringClass = "ring-2 ring-orange-400 rounded-sm";
        }
        if (!ringClass && isChoiceSelected) {
            ringClass = "ring-2 ring-emerald-400 rounded-sm";
        } else if (!ringClass && isValidChoice) {
            ringClass = "ring-2 ring-violet-400/60 rounded-sm";
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

        if (isSelectingChoice) {
            guardMutation(
                selectResolutionChoice({
                    gameId,
                    playerId,
                    cardInstanceId: card.id,
                })
            );
            return;
        }

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
        // During mid-resolution choice or target selection, the click is a
        // pick — skip mana-ability pickers and route straight to handleClick.
        if (isSelectingChoice || isSelectingTarget) {
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
        if (
            !hasPriority ||
            pendingCast ||
            pendingActivation ||
            pendingTarget ||
            (pendingChoices && pendingChoices.length > 0)
        ) {
            return [];
        }
        // UX: while this player is the one picking attackers/blockers, the
        // context menu would compete with the declaration click target.
        // Suppress it for the declarer only — the other player can still
        // respond with their own abilities.
        const isActivePlayer = playerId === activePlayerId;
        if (phase === "DECLARE_ATTACKERS" && isActivePlayer) return [];
        if (phase === "DECLARE_BLOCKERS" && !isActivePlayer) return [];
        const stack = getStackAbilities(card, phase);
        // When a card carries BOTH a mana ability and at least one stack
        // ability (Basalt Monolith, Mana Vault), surface the mana ability as
        // an explicit menu entry too — otherwise a left click would silently
        // tap-for-mana and then the {3}: Untap option still appears, which
        // confuses the player. The mana ability is gated by the same
        // tap/sickness rules `canInteract` already enforces for a direct tap.
        // When the card is already tapped from this mana ability (and mana is
        // not yet committed to a cost), the same entry flips to a refund —
        // `tapUntap` toggles in both directions so reusing the ability id is
        // sufficient on the server side; only the label changes here.
        if (stack.length === 0) return stack;
        const mana = getActivatedManaMenuEntry(card);
        if (!mana) return stack;
        if (card.isTapped) {
            if (!canRefundManaTap(card, player.manaPool)) return stack;
            return [
                { id: mana.id, oracleText: "Untap and refund mana" },
                ...stack,
            ];
        }
        if (isTapLockedBySummoningSickness(card)) return stack;
        return [mana, ...stack];
    }

    function handleActivateAbility(
        cardInstanceId: string,
        abilityId: string,
        keepPriority: boolean
    ) {
        const card = player.battlefield.find((c) => c.id === cardInstanceId);
        if (!card) return;
        const def = getCardById(card.card.id);
        const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
        // Mana ability selected from the menu (useStack:false) — route through
        // the mana-ability flow (`tapUntap`, or the mana picker for sources
        // with `manaChoices`) instead of the activated-ability mutation.
        if (ability && !ability.useStack) {
            const choices = getManaChoices(card);
            if (choices) {
                setManaChoiceState({
                    cardId: card.id,
                    choices,
                    position: { x: 0, y: 0 },
                    inPayment: false,
                });
                return;
            }
            guardMutation(
                tapUntap({ gameId, playerId, cardInstanceId: card.id })
            );
            return;
        }
        // CR 107.3 / 601.2b: if the ability has X in its mana cost, the
        // activator chooses X before announcement. Prompt the user — same
        // pattern as the spell-cast path in selectable-card.tsx.
        const hasX =
            ability?.cost.mana?.X !== undefined &&
            typeof ability.cost.mana.X === "string";
        let chosenX: number | undefined;
        if (hasX) {
            const raw = window.prompt(
                `Choose X for ${def.name} (${ability!.oracleText})`,
                "0"
            );
            if (raw === null) return;
            const parsed = Number.parseInt(raw, 10);
            if (!Number.isFinite(parsed) || parsed < 0) return;
            chosenX = parsed;
        }
        guardMutation(
            activateAbility({
                gameId,
                playerId,
                cardInstanceId,
                abilityId,
                keepPriority: keepPriority || undefined,
                chosenX,
            })
        );
    }

    // --- Rendering ---

    const creatures = player.battlefield.filter(isCreature);
    const lands = player.battlefield.filter((c) => isLand(c) && !isCreature(c));
    // Auras attached to a host render alongside that host (not in `others`).
    // The aura's controller may differ from the host's (e.g. Warp Artifact on
    // an opponent's artifact, CR 303.4): scan all battlefields for auras
    // whose host sits on this side, not just `player.battlefield`.
    // Ungrouped Aura leftovers (attachedTo unset or host nowhere on the
    // board) fall through to `others` so they remain visible.
    const attachedAurasByHost = useMemo(() => {
        const map = new Map<string, CardInstance[]>();
        const hostsOnThisSide = new Set(player.battlefield.map((c) => c.id));
        for (const p of allPlayers) {
            for (const c of p.battlefield) {
                if (!c.attachedTo) continue;
                if (!hostsOnThisSide.has(c.attachedTo)) continue;
                const bucket = map.get(c.attachedTo);
                if (bucket) bucket.push(c);
                else map.set(c.attachedTo, [c]);
            }
        }
        return map;
    }, [player.battlefield, allPlayers]);
    const hostExistsAnywhere = useMemo(() => {
        const ids = new Set<string>();
        for (const p of allPlayers) {
            for (const c of p.battlefield) ids.add(c.id);
        }
        return ids;
    }, [allPlayers]);
    const others = player.battlefield.filter(
        (c) =>
            !isCreature(c) &&
            !isLand(c) &&
            !(c.attachedTo && hostExistsAnywhere.has(c.attachedTo))
    );

    function renderAttachedAura(aura: CardInstance, index: number) {
        const vs = getVisualState(aura);
        const abilities = getActivatable(aura);
        // Auras peek out from behind the host, up-and-left. Each additional
        // aura fans further up-left so the stack remains visible. Rendered
        // BEFORE the host in DOM order so natural painting puts the host on
        // top (no negative z-index needed).
        const offset = 22 * (index + 1);
        return (
            <div
                key={aura.id}
                className="absolute h-full pointer-events-auto"
                style={{
                    top: `-${offset}px`,
                    left: `-${offset}px`,
                    // Explicit width — without it, an absolute box with
                    // `width: auto` collapses to 0 because the child also
                    // resolves its width from its parent (host's `width: auto`
                    // + aspect-ratio chain). Manifested as the aura disappearing
                    // for the controller while opponent saw it correctly.
                    width: "var(--card-w)",
                }}
            >
                <BattlefieldCard
                    card={aura}
                    vs={vs}
                    onClick={(e) => handleClickWithEvent(aura, e)}
                    activatableAbilities={abilities}
                    onActivateAbility={(aId, keep) =>
                        handleActivateAbility(aura.id, aId, keep)
                    }
                />
            </div>
        );
    }

    function renderGroup(group: CardInstance[]) {
        // Creatures with attached auras render as individual columns (no
        // by-name stacking, since each instance's auras are distinct). The
        // aura overlays the host up-and-left via absolute positioning.
        const anyHasAuras = group.some((c) => attachedAurasByHost.has(c.id));
        if (group.length === 1 || anyHasAuras) {
            return (
                <div key={group[0].id} className="flex h-full gap-1">
                    {group.map((card) => {
                        const vs = getVisualState(card);
                        const abilities = getActivatable(card);
                        const attached = attachedAurasByHost.get(card.id) ?? [];
                        return (
                            <div key={card.id} className="relative flex h-full">
                                {attached.map((a, i) =>
                                    renderAttachedAura(a, i)
                                )}
                                <BattlefieldCard
                                    card={card}
                                    vs={vs}
                                    onClick={(e) =>
                                        handleClickWithEvent(card, e)
                                    }
                                    activatableAbilities={abilities}
                                    onActivateAbility={(aId, keep) =>
                                        handleActivateAbility(
                                            card.id,
                                            aId,
                                            keep
                                        )
                                    }
                                />
                            </div>
                        );
                    })}
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
