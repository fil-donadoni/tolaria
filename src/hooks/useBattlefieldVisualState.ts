import { useMemo } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { getDefinition } from "@convex/cards";
import { globalAttackProhibitionReason } from "@convex/cards/attackRestrictions";
import {
    isCreature,
    isPlaneswalker,
    isLandwalkUnblockable,
    hasManaAbility,
    matchesPermanentFilter,
    matchesTargetRequirement,
    matchesTargetController,
    wantsPermanentTarget,
    isTapLockedBySummoningSickness,
    getLandManaColor,
    getActivatedManaColor,
    getManaChoices,
    buildTriggerStateView,
    pendingCastHasImprovise,
    pendingCastRemainingGeneric,
} from "~/lib/card-utils";
import { isUntargetableByPending } from "~/lib/targeting";
import {
    activeSacrificeSelection,
    nextSacrificeRequirement,
} from "~/lib/sacrifice-selection";
import { COMBAT_GROUP_RING, COMBAT_GROUP_BG } from "~/lib/combat-colors";
import type { CardVisualState } from "~/components/board/battlefield-card";

/** Board-coupled visual state for one player's battlefield (PRD #249, slice
 *  #256). This is the single source of truth for how a permanent reads on the
 *  board: combat grouping rings, tap state, marked damage badges, and
 *  legal-target / legal-choice highlighting during selection.
 *
 *  The spatial battlefield (`board-battlefield-card.tsx`) consumes the
 *  `getVisualState` produced here.
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

    // CR 602.5b (issue #947) — viewer-visible board snapshot fed to a mana
    // ability's own `canActivate` precondition (Chrome Mox's imprint gate) so
    // an un-imprinted source doesn't read as a usable mana source here — the
    // same UI-hint convention `getActivatable` already uses (#436).
    const manaGateView = buildTriggerStateView(allPlayers, activePlayerId);

    // --- Interaction modes ---

    const isPayingCast =
        isMe && !!pendingCast && pendingCast.playerId === playerId;
    const isPayingActivation =
        isMe && !!pendingActivation && pendingActivation.playerId === playerId;
    // CR 508.1c/1g — the parked per-attacker MANA attack tax (Propaganda /
    // Collective Restraint): mana sources are tappable toward it like a cast.
    const isPayingAttackTax =
        isMe &&
        !!combat?.pendingAttackManaTax &&
        combat.pendingAttackManaTax.playerId === playerId;
    const isInPayment = isPayingCast || isPayingActivation || isPayingAttackTax;

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

    // Unified sacrifice picker (CR 701.21a) — cast additional cost / Drought,
    // activated-ability sacrifice cost, and the attack-declaration land tax all
    // share one SacrificeSelection. Highlights the candidates of the next unmet
    // requirement.
    const sacrificeSelection = isMe
        ? activeSacrificeSelection(
              pendingCast,
              pendingActivation,
              combat,
              playerId
          )
        : undefined;
    const isPickingSacrifice = !!sacrificeSelection;

    function matchesSacrificePick(card: CardInstance): boolean {
        if (!sacrificeSelection) return false;
        const req = nextSacrificeRequirement(sacrificeSelection);
        if (!req) return false;
        if (sacrificeSelection.picked.includes(card.id)) return false;
        return matchesPermanentFilter(card, req.filter);
    }

    // Exile additional-cost picker (CR 117.9 / 406, Soul Exchange). The
    // sacrifice branch migrated to the unified sacrifice picker above;
    // `additionalCost` is exile-only now.
    const isPickingAdditionalCost =
        isMe &&
        !!pendingCast &&
        pendingCast.playerId === playerId &&
        !!pendingCast.additionalCost &&
        !pendingCast.additionalCost.pickedId;

    // Activated-ability tap-other cost picker: "tap N untapped permanents
    // matching <filter>" (CR 602.1 / 118.8, Hand of Justice). The sacrifice
    // branch migrated to the unified sacrifice picker above.
    const isPickingActivationCost =
        isMe &&
        !!pendingActivation &&
        pendingActivation.playerId === playerId &&
        !!pendingActivation.tapOtherChoice &&
        pendingActivation.tapOtherChoice.pickedIds.length <
            pendingActivation.tapOtherChoice.count;

    /** Eligibility check for the tap-other cost picker — one permanent per call,
     *  gating BOTH `canInteract` (click-through) and the gold ring highlight so
     *  the two surfaces never disagree. Excludes tapped permanents and the
     *  ability's own source, mirroring the server's selectActivationCost
     *  validation. */
    function matchesActivationCostPick(card: CardInstance): boolean {
        if (!pendingActivation) return false;
        const toc = pendingActivation.tapOtherChoice;
        if (toc && toc.pickedIds.length < toc.count) {
            return (
                !card.isTapped &&
                card.id !== pendingActivation.cardInstanceId &&
                !toc.pickedIds.includes(card.id) &&
                matchesPermanentFilter(card, toc.filter)
            );
        }
        return false;
    }

    const isSelectingAttackers =
        phase === "DECLARE_ATTACKERS" &&
        !!combat &&
        !combat.confirmed &&
        // While the mana attack tax is parked the declaration is locked pending
        // payment — mana sources tap toward the tax, they aren't attacker picks.
        !combat.pendingAttackManaTax &&
        isMe &&
        playerId === activePlayerId;

    // CR 508.1a (issue #1220) — while the active player is declaring attackers,
    // the DEFENDING player's planeswalkers are legal attack targets. This board
    // is the defender's (not the viewer's own, and not the active player's), the
    // viewer is the declaring active player, and at least one attacker has been
    // declared to point at a planeswalker.
    const isAttackTargetBoard =
        phase === "DECLARE_ATTACKERS" &&
        !!combat &&
        !combat.confirmed &&
        !combat.pendingAttackManaTax &&
        playerId === activePlayerId &&
        player.id !== activePlayerId &&
        combat.attackerIds.length > 0;

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
    const attackTargets = combat?.attackTargets ?? {};

    // CR 508.1a (issue #1220) — true iff at least one declared attacker is
    // currently attacking this planeswalker.
    function isAttackedPlaneswalker(card: CardInstance): boolean {
        return Object.values(attackTargets).includes(card.id);
    }

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
            // Precomputed allow-list (e.g. legend-keep, CR 704.5j): only the
            // recorded candidates are clickable, even if others match the
            // filter / zone. Mirrors the server's candidateIds enforcement.
            if (
                activeChoice.candidateIds &&
                !activeChoice.candidateIds.includes(card.id)
            ) {
                return false;
            }
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

        if (isPickingSacrifice) {
            return matchesSacrificePick(card);
        }

        if (isPickingAdditionalCost && pendingCast?.additionalCost) {
            return matchesPermanentFilter(
                card,
                pendingCast.additionalCost.filter
            );
        }

        if (isPickingActivationCost) {
            return matchesActivationCostPick(card);
        }

        if (isSelectingTarget) {
            if (
                !pendingTarget ||
                !matchesTargetRequirement(card, pendingTarget.targetType)
            ) {
                return false;
            }
            // CR 109.3 / 102.1 — respect the target's controller filter so a
            // wrong-controller permanent doesn't read as clickable (#904). The
            // chooser is pendingTarget.playerId, not necessarily the viewer.
            if (
                !matchesTargetController(
                    card.controllerId,
                    pendingTarget.playerId,
                    activePlayerId,
                    pendingTarget.controller
                )
            ) {
                return false;
            }
            // CR 702.18 / 611 — a shrouded / "can't be the target" permanent is
            // not a legal target, so it must not read as clickable (#382). The
            // server also rejects it; this just mirrors the gate client-side.
            if (
                isUntargetableByPending(
                    allPlayers,
                    card,
                    pendingTarget.cardInstanceId,
                    pendingTarget.kind,
                    // CR 702.11b — the chooser controls the source; hexproof
                    // bars only an opponent's source, never the own controller.
                    pendingTarget.playerId
                )
            ) {
                return false;
            }
            return true;
        }

        if (isSelectingAttackers && isCreature(card)) {
            if (selectedAttackerIds.includes(card.id)) return true;
            if (card.staticAbilities?.includes("defender")) return false;
            if (card.isTapped) return false;
            // CR 702.10b — haste lets a creature attack ignoring summoning
            // sickness. Mirrors the server gate in
            // `combat.ts` `validateAttackerEligibility` (#937); tapped-ness
            // above is unaffected by haste.
            const hasHaste = card.staticAbilities?.includes("haste") ?? false;
            if (card.isSummoningSick && !hasHaste) return false;
            const attackDef = getDefinition(card.card.id);
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
            // CR 508.1c — battlefield-scanned global attack restrictions
            // declared by OTHER permanents (Moat, Akron Legionnaire). Mirrors
            // the server gate in `validateAttackerEligibility` so the UI grays
            // out creatures the server would reject (#481).
            if (
                globalAttackProhibitionReason(card as never, {
                    players: allPlayers as never,
                }) !== undefined
            ) {
                return false;
            }
            return true;
        }

        if (isSelectingBlockers && isCreature(card)) {
            if ((blockerAssignments[card.id]?.length ?? 0) > 0) return true;
            if (pendingBlockerId === card.id) return true;
            return !card.isTapped && canBlockAnyAttacker(card);
        }

        // CR 508.1a (issue #1220) — the defender's planeswalkers are clickable
        // attack targets while attackers are being declared.
        if (isAttackTargetBoard && isPlaneswalker(card)) return true;

        if (isBlockerTarget && card.isAttacking) return true;

        // CR 702.126 — Improvise: while paying for a spell that declares the
        // keyword, an untapped ARTIFACT the caster controls is a legal
        // alternate payment source for its generic cost even though it has no
        // mana ability of its own (that's the whole point — it isn't tapped
        // FOR mana). Checked before the mana-ability gate below, which would
        // otherwise reject exactly this card. An artifact that ALSO has a
        // mana ability keeps the existing tap-for-mana click as the default
        // (mechanicsRegistry.ts's "improvise" binding note records the scope
        // call) — this branch only ever admits a mana-ability-less artifact.
        if (
            isMe &&
            isPayingCast &&
            pendingCast &&
            !hasManaAbility(card, manaGateView) &&
            (card.types?.includes("Artifact") ?? false) &&
            pendingCastHasImprovise(pendingCast, player)
        ) {
            const tappedForImprovise =
                pendingCast.improviseTappedArtifactIds?.includes(card.id) ??
                false;
            return card.isTapped
                ? tappedForImprovise
                : pendingCastRemainingGeneric(pendingCast) > 0;
        }

        if (!isMe || !hasManaAbility(card, manaGateView)) return false;
        // CR 302.1 — creatures with summoning sickness can't pay {T}, so
        // their mana ability isn't activatable. Untapping (refunding floating
        // mana) is still allowed — it reverses an earlier activation.
        if (isTapLockedBySummoningSickness(card) && !card.isTapped) {
            return false;
        }
        if (isInPayment) {
            const tappedDuringPayment = isPayingCast
                ? pendingCast!.tappedLandIds.includes(card.id)
                : isPayingActivation
                  ? pendingActivation!.tappedLandIds.includes(card.id)
                  : combat!.pendingAttackManaTax!.tappedLandIds.includes(
                        card.id
                    );
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
        const manaSource = hasManaAbility(card, manaGateView);

        const isValidTarget =
            isSelectingTarget &&
            pendingTarget &&
            matchesTargetRequirement(card, pendingTarget.targetType) &&
            matchesTargetController(
                card.controllerId,
                pendingTarget.playerId,
                activePlayerId,
                pendingTarget.controller
            );

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

        const isAttackTargetPw = isAttackTargetBoard && isPlaneswalker(card);

        // CR 702.126 — mirrors the `canInteract` Improvise branch above so a
        // mana-ability-less artifact reads as interactive during an Improvise
        // cast's payment, the same way a mana source does.
        const isImproviseArtifact =
            isPayingCast &&
            !!pendingCast &&
            !manaSource &&
            (card.types?.includes("Artifact") ?? false) &&
            pendingCastHasImprovise(pendingCast, player);

        const interactive = isSelectingChoice
            ? isValidChoice
            : isSelectingTarget
              ? !!isValidTarget
              : (isMe &&
                    (manaSource ||
                        isImproviseArtifact ||
                        (isSelectingAttackers && creature) ||
                        (isSelectingBlockers && creature))) ||
                (isBlockerTarget && !!card.isAttacking) ||
                isAttackTargetPw;

        const enabled = canInteract(card);

        // CR 702.10b — haste exempts a summoning-sick creature from the
        // sickness gate, mirroring the `canInteract` check above (#937).
        const hasHaste = card.staticAbilities?.includes("haste") ?? false;
        const dimmed: boolean =
            !!(
                isSelectingAttackers &&
                creature &&
                !selectedAttackerIds.includes(card.id) &&
                (card.isTapped ||
                    (card.isSummoningSick && !hasHaste) ||
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
        // A legal target of the spell/ability on the stack currently choosing
        // targets reads with the SAME accent-strong glow ring a targetable
        // player nameplate gets (player-nameplate.tsx) — a box-shadow overlay,
        // not a `ringClass` (glow can't be a Tailwind ring). Set below when the
        // faded valid-target branch would otherwise have fired.
        let targetGlow = false;
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
                ringClass = "ring-2 ring-danger rounded-sm";
            }
        }
        if (!ringClass && isTargetSelected) {
            // An already-picked target reads GREEN — the same emerald
            // selection ring the card piles use (`selectionRing`,
            // cards-pile.tsx) — so multi-target picks (Pyrokinesis's divided
            // damage, Force of Vigor's up-to-two destroy) are unmistakable
            // against the faded-gold "valid but unpicked" ring below.
            ringClass = "ring-2 ring-emerald-400 rounded-sm";
        } else if (!ringClass && isValidTarget) {
            // Legal target of a spell/ability on the stack — mirror the player
            // nameplate's accent-strong glow (player-nameplate.tsx) so a
            // targetable permanent reads the SAME as a targetable player.
            targetGlow = true;
        }
        if (!ringClass && isChoiceSelected) {
            // A committed pick reads GREEN — the same emerald selection ring the
            // card piles (`selectionRing`, cards-pile.tsx), the in-hand choice
            // toggle (board-hand-card.tsx) and target-selection (above) use — so
            // the selected permanents are unmistakable against the faded-bronze
            // "valid but unpicked" ring below. Bronze-solid vs bronze/40 differ
            // only in opacity and don't read as a distinct selection.
            ringClass = "ring-2 ring-emerald-400 rounded-sm";
        } else if (!ringClass && isValidChoice) {
            ringClass = "ring-2 ring-accent/40 rounded-sm";
        }

        // Non-mana cost picker highlight (CR 117.9 spell additional cost /
        // CR 602.1 activated-ability sacrifice or tap-other cost). Same gold
        // ring as a resolution choice so eligible permanents read as
        // clickable.
        const isValidSacrificePick =
            (isPickingSacrifice && matchesSacrificePick(card)) ||
            (isPickingAdditionalCost &&
                !!pendingCast?.additionalCost &&
                matchesPermanentFilter(
                    card,
                    pendingCast.additionalCost.filter
                )) ||
            (isPickingActivationCost && matchesActivationCostPick(card));
        // Already-committed picks in a multi-element cost choice (Fireblast's
        // two Mountains, Thwart's three Islands, Hand of Justice's tap-others).
        // `matches*Pick` excludes picked ids, so without this branch a chosen
        // permanent would lose its ring — the player couldn't see what they
        // already selected. Emerald ring mirrors the choose-permanents selected
        // state (`isChoiceSelected` above). CR 701.21a / 602.1.
        const isCostPicked =
            (isPickingSacrifice &&
                !!sacrificeSelection?.picked.includes(card.id)) ||
            (isPickingActivationCost &&
                !!pendingActivation?.tapOtherChoice?.pickedIds.includes(
                    card.id
                ));
        if (!ringClass && isCostPicked) {
            ringClass = "ring-2 ring-emerald-400 rounded-sm";
        } else if (!ringClass && isValidSacrificePick) {
            ringClass = "ring-2 ring-accent/40 rounded-sm";
        }

        // CR 508.1a (issue #1220) — a planeswalker under attack reads GREEN (a
        // committed attack target), the same emerald selection ring targets and
        // choices use; a clickable-but-unchosen defending planeswalker reads with
        // the faded-accent "valid target" ring.
        if (!ringClass && isAttackTargetPw && isAttackedPlaneswalker(card)) {
            ringClass = "ring-2 ring-emerald-400 rounded-sm";
        } else if (!ringClass && isAttackTargetPw) {
            ringClass = "ring-2 ring-accent/50 rounded-sm";
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

        // CR 601.2d — a legal target of an active divide-as-you-choose spell
        // gets an on-card [−] N [+] stepper (not click-to-target). Same
        // legality predicate that drives the candidate ring.
        const divideTarget =
            !!isValidTarget && pendingTarget?.divideTotal !== undefined;

        return {
            interactive,
            enabled,
            dimmed,
            combatOffset,
            ringClass,
            badge,
            tooltip,
            divideTarget,
            targetGlow,
        };
    }

    return { getVisualState, canInteract };
}
