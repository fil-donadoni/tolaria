import { useMemo } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { isEligibleAttacker } from "~/lib/attacker-eligibility";
import { combatDeclarationCap } from "@convex/cards/attackRestrictions";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import {
    isCreature,
    isPlaneswalker,
    isLandwalkUnblockable,
    hasManaAbility,
    matchesPermanentFilter,
    matchesTargetRequirement,
    matchesPermanentTargetFilters,
    wantsPermanentTarget,
    isTapLockedBySummoningSickness,
    canAffordManaAbilityCost,
    getLandManaColor,
    getActivatedManaColor,
    getManaChoices,
    buildTriggerStateView,
    pendingCastHasImprovise,
    pendingCastRemainingGeneric,
} from "~/lib/card-utils";
import { pendingChoiceRoutesToBattlefield } from "~/lib/pending-choice-labels";
import { isUntargetableByPending } from "~/lib/targeting";
import {
    isTapOtherChoicePaid,
    type TapOtherCandidate,
    type TapOtherCostSpec,
} from "@convex/gre/tapOtherCost";
import {
    activeSacrificeSelection,
    nextSacrificeRequirement,
} from "~/lib/sacrifice-selection";
import { COMBAT_GROUP_RING, COMBAT_GROUP_BG } from "~/lib/combat-colors";
import type { CardVisualState } from "~/components/board/battlefield-card";

/** A NON-stack (`useStack: false`) mana ability's `cost.tapOtherFilter` pick,
 *  parked CLIENT-side between the ability-menu click and the single
 *  `activateManaAbility` dispatch that carries the finished `tapOtherIds`
 *  (CR 602.1 / 118.8 / 605.3c, issue #2371 — Urza, Lord High Artificer's "Tap
 *  an untapped artifact you control: Add {U}").
 *
 *  Client-local, unlike its `useStack: true` sibling
 *  `pendingActivation.tapOtherChoice`: a mana ability resolves in ONE mutation
 *  call with no stack item to defer the pick onto (CR 605.3c), so the picks are
 *  collected here and submitted whole. `useBattlefieldInteraction` owns the
 *  state; this hook receives it so `canInteract` and the pick rings agree with
 *  the click router — the two surfaces disagreeing is exactly the "clickable
 *  but rejected" bug the shared `tapOtherCostCandidates` authority exists to
 *  prevent. */
export interface ManaTapOtherPick {
    /** The ability's own source. Never a legal pick (CR 602.1 "another"). */
    sourceId: string;
    abilityId: string;
    spec: TapOtherCostSpec;
    /** Every legal pick, weighed, from `tapOtherCostCandidates`. */
    candidates: TapOtherCandidate[];
    /** Picks committed so far, a subset of `candidates`. */
    picked: TapOtherCandidate[];
}

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
export function useBattlefieldVisualState(
    player: Player,
    /** See {@link ManaTapOtherPick}. Absent/null for every board that is not
     *  mid-pick, which is the byte-identical pre-#2371 behaviour. */
    manaTapOtherPick?: ManaTapOtherPick | null
) {
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
        emblems,
        stackItems,
        engineTurn,
        controlChangedThisTurn,
    } = useGameContext();
    // The two wire fields a "…controlled since the beginning of the turn"
    // choice filter needs (`@convex/gre/controlContinuity`). Passed to every
    // `matchesPermanentFilter` call below so the highlight matches the server's
    // own pending-choice / cost-pick validation exactly.
    //
    // `engineTurn` (the wire `GameState.turn`), NEVER the context's display
    // `turn` (`activePlayer.turnsTaken`): `enteredOnTurn` is stamped from the
    // GLOBAL turn number, so comparing it against the roughly-halved display
    // counter excludes creatures the server accepts — and Keldon Twilight's
    // choice is a MANDATORY `count: 1` with no `candidateIds` allow-list, so a
    // human seat with nothing clickable cannot answer the prompt at all.
    //
    // Fails CLOSED rather than open when `engineTurn` is missing: `board.tsx`
    // always publishes it, but a hand-built context (a component test) can
    // omit it past the `as` cast, and `enteredOnTurn >= undefined` is `false`
    // — i.e. every permanent would read as long-held and the picker would
    // highlight picks the server rejects. Undefined view → the filter's own
    // fail-closed branch.
    const controlContinuity =
        typeof engineTurn === "number"
            ? { turn: engineTurn, controlChangedThisTurn }
            : undefined;
    const bufferCtx = usePendingChoiceBuffer();
    const attackSequence = useAttackSequence();
    const isMe = player.id === playerId;

    // CR 602.5b (issue #947) — viewer-visible board snapshot fed to a mana
    // ability's own `canActivate` precondition (Chrome Mox's imprint gate) so
    // an un-imprinted source doesn't read as a usable mana source here — the
    // same UI-hint convention `getActivatable` already uses (#436).
    const manaGateView = buildTriggerStateView(allPlayers, activePlayerId);

    // CR 106.1 (issue #1889) — `allPlayers` is also handed to `hasManaAbility`
    // below, so a source whose CURRENT unified tap option list is empty (an
    // Everflowing Chalice with no charge counters) stops reading as a tappable
    // payment source here, off the same list the server resolves the index
    // against. Every player's battlefield, not just the controller's: a
    // board-conditional chooser (Fellwar Stone) reads the opponents' lands.

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

    // CR 601.2c (issue #1104) — the cross-slot same-controller constraint's
    // sibling controllerId is now resolved INSIDE `matchesPermanentTargetFilters`
    // (issue #1697), which builds it the same way this used to inline (scan
    // both battlefields for the first selected permanent under a
    // `sameController`-constrained requirement).

    const activeChoice = pendingChoices?.[0];
    const isViewerChoosing =
        !!activeChoice && activeChoice.playerId === playerId;
    const choiceZoneOwnerId = activeChoice
        ? (activeChoice.zoneOwnerId ?? activeChoice.playerId)
        : undefined;
    const isSelectingChoice =
        isViewerChoosing &&
        pendingChoiceRoutesToBattlefield(activeChoice!) &&
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
        return matchesPermanentFilter(card, req.filter, controlContinuity);
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
        !isTapOtherChoicePaid(pendingActivation.tapOtherChoice);

    /** Eligibility check for the tap-other cost picker — one permanent per call,
     *  gating BOTH `canInteract` (click-through) and the gold ring highlight so
     *  the two surfaces never disagree. Excludes tapped permanents and the
     *  ability's own source, mirroring the server's selectActivationCost
     *  validation. */
    function matchesActivationCostPick(card: CardInstance): boolean {
        if (!pendingActivation) return false;
        const toc = pendingActivation.tapOtherChoice;
        if (toc && !isTapOtherChoicePaid(toc)) {
            return (
                !card.isTapped &&
                card.id !== pendingActivation.cardInstanceId &&
                !toc.pickedIds.includes(card.id) &&
                matchesPermanentFilter(card, toc.filter, controlContinuity)
            );
        }
        return false;
    }

    // Non-stack MANA ability tap-other cost picker (CR 602.1 / 118.8 / 605.3c,
    // issue #2371 — Urza, Lord High Artificer). Client-local sibling of
    // `isPickingActivationCost` above; see {@link ManaTapOtherPick}.
    const isPickingManaTapOther = isMe && !!manaTapOtherPick;

    /** Eligibility for the mana-ability tap-other picker — one permanent per
     *  call, gating BOTH `canInteract` and the gold ring so the two never
     *  disagree. The candidate set was computed ONCE by the shared
     *  `tapOtherCostCandidates` (source excluded, tapped excluded, filter
     *  applied), so this is pure set membership minus what is already picked —
     *  there is deliberately no second copy of the eligibility rule here. */
    function matchesManaTapOtherPick(card: CardInstance): boolean {
        if (!manaTapOtherPick) return false;
        if (manaTapOtherPick.picked.some((p) => p.id === card.id)) return false;
        return manaTapOtherPick.candidates.some((c) => c.id === card.id);
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

    // CR 508.1a / 509.1a (issue #1127) — a battlefield-wide cap on how many
    // creatures may be DECLARED this combat (Caverns of Despair at two, Dueling
    // Grounds at one). Read from the SAME scanner the server gates on
    // (`convex/cards/attackRestrictions.ts`), so the board can never offer a
    // declaration the mutation would refuse. Computed once per render rather
    // than per card — it is a board-wide scan, not a per-permanent predicate.
    //
    // Both flags mean "a NEW participant would exceed the cap": an
    // already-declared attacker stays clickable (deselecting is what frees the
    // slot) and an already-blocking creature may still take another attacker,
    // because the block cap counts distinct CREATURES, not assignments.
    const attackCapReached = (() => {
        const cap = combatDeclarationCap(
            { players: allPlayers as never },
            "attack"
        );
        return cap !== undefined && selectedAttackerIds.length >= cap.max;
    })();
    const blockCapReached = (() => {
        const cap = combatDeclarationCap(
            { players: allPlayers as never },
            "block"
        );
        if (cap === undefined) return false;
        const distinct = Object.values(blockerAssignments).filter(
            (ids) => (ids?.length ?? 0) > 0
        ).length;
        return distinct >= cap.max;
    })();
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
        // The mana-ability tap-other pick is MODAL while it is open (CR 602.1 —
        // the cost is being paid; nothing else on the board is a legal click),
        // so it takes precedence over every branch below, exactly as the
        // server-parked pickers lock the board for their own duration.
        if (isPickingManaTapOther) {
            return matchesManaTapOtherPick(card);
        }
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
                !matchesPermanentFilter(
                    card,
                    activeChoice.filter,
                    controlContinuity
                )
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
                pendingCast.additionalCost.filter,
                controlContinuity
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
            // CR 109.1/.3/102.1/202/205/601.2c/613/701.20/702 (issue #1697) —
            // every PERMANENT-kind filter dimension (supertype/subtype/color/
            // tapped/combat role/keyword/power/toughness/mv/controller/
            // sameController/exclude-types/exclude-instance), routed through
            // the SAME shared registry `getLegalTargets`/`selectTarget` use, so
            // a permanent can't read as clickable when the server would
            // reject it (#904 and the Karakas "target legendary creature" gap).
            if (
                !matchesPermanentTargetFilters(
                    card,
                    pendingTarget,
                    allPlayers,
                    activePlayerId,
                    controlContinuity,
                    emblems
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
                    // CR 405 — a triggered ability's source is an on-stack
                    // item, resolvable only from here.
                    stackItems,
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
            // An already-declared attacker stays clickable (to deselect).
            if (selectedAttackerIds.includes(card.id)) return true;
            // CR 508.1a — the battlefield-wide declared-attacker cap is full,
            // so every further creature would be refused by the server and none
            // of them may read as clickable.
            if (attackCapReached) return false;
            // Otherwise defer to the shared eligibility predicate — the single
            // authority the "Attack with all" button also uses, so what the
            // board grays out and what the button declares can't drift.
            const defender = allPlayers.find((p) => p.id !== player.id);
            return isEligibleAttacker(
                card,
                defender?.battlefield ?? [],
                allPlayers
            );
        }

        if (isSelectingBlockers && isCreature(card)) {
            if ((blockerAssignments[card.id]?.length ?? 0) > 0) return true;
            if (pendingBlockerId === card.id) return true;
            // CR 509.1a — the declared-blocker cap is full, so this creature
            // (not already blocking, per the two checks above) can't join.
            if (blockCapReached) return false;
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
            !hasManaAbility(card, manaGateView, allPlayers) &&
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

        if (!isMe || !hasManaAbility(card, manaGateView, allPlayers))
            return false;
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
        // CR 601.2f / 601.2g — a mana ability with its own MANA cost leg (Mana
        // Cylix "{1}, {T}: Add one mana of any color", Chromatic Star, Fire
        // Sprites) needs that mana paid before it adds any. The server
        // auto-taps other sources to fund it, so this only hides the hopeless
        // case: empty pool AND no other untapped mana source. Gate the TAP
        // only — an untap toggle reverses an earlier activation (and refunds
        // that cost), so it stays available.
        if (
            !card.isTapped &&
            !canAffordManaAbilityCost(
                card,
                player.manaPool,
                player.battlefield,
                manaGateView
            )
        ) {
            return false;
        }
        return card.isTapped ? !card.manaCommitted : true;
    }

    function getVisualState(card: CardInstance): CardVisualState {
        const creature = isCreature(card);
        const manaSource = hasManaAbility(card, manaGateView, allPlayers);

        const isValidTarget =
            isSelectingTarget &&
            pendingTarget &&
            matchesTargetRequirement(card, pendingTarget.targetType) &&
            matchesPermanentTargetFilters(
                card,
                pendingTarget,
                allPlayers,
                activePlayerId,
                controlContinuity,
                emblems
            ) &&
            // CR 702.16b / 702.18 / 611 (issue #1120) — a permanent the server
            // would reject must not GLOW as a target either. This is the same
            // gate the click handler (`useBattlefieldInteraction`) and
            // `canInteract` above already apply; folding it in here keeps the
            // faded-gold "valid target" ring and the click in agreement, so a
            // creature with protection from the source's quality (Tsabo
            // Tavoc's "protection from legendary creatures") reads as the
            // non-target it is instead of glowing and doing nothing.
            !isUntargetableByPending(
                allPlayers,
                card,
                pendingTarget.cardInstanceId,
                pendingTarget.kind,
                stackItems,
                pendingTarget.playerId
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
                matchesPermanentFilter(
                    card,
                    activeChoice.filter,
                    controlContinuity
                ));

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
                // CR 508.1a (#1127) — a spent declared-attacker cap dims the
                // creatures it locks out, the same way an unusable (tapped /
                // sick / defender) creature is dimmed: the board must SHOW why
                // nothing happens on click, not merely swallow the click.
                (attackCapReached ||
                    card.isTapped ||
                    (card.isSummoningSick && !hasHaste) ||
                    card.staticAbilities?.includes("defender"))
            ) ||
            !!(
                isSelectingBlockers &&
                creature &&
                !blockerAssignments[card.id]?.length &&
                pendingBlockerId !== card.id &&
                // CR 509.1a (#1127) — same for the declared-blocker cap.
                (blockCapReached || card.isTapped || !canBlockAnyAttacker(card))
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
        // "Attack with all" destination sequence (design 2026-07-23) — the
        // attacker currently choosing its target reads with a DEDICATED
        // pulsing emerald ring, distinct from the static red "declared" ring
        // below, so the player can tell "already declared" from "now assigning
        // this one's target". Highest priority during the sequence.
        const isCurrentSequenceAttacker =
            attackSequence.active &&
            attackSequence.currentAttackerId === card.id;
        if (isCurrentSequenceAttacker) {
            ringClass = "ring-2 ring-signal-self animate-pulse rounded-sm";
        } else if (pendingBlockerId === card.id) {
            ringClass = "ring-2 ring-signal-pending rounded-sm";
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
            ringClass = "ring-2 ring-signal-self rounded-sm";
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
            ringClass = "ring-2 ring-signal-self rounded-sm";
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
                    pendingCast.additionalCost.filter,
                    controlContinuity
                )) ||
            (isPickingActivationCost && matchesActivationCostPick(card)) ||
            (isPickingManaTapOther && matchesManaTapOtherPick(card));
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
                )) ||
            (isPickingManaTapOther &&
                !!manaTapOtherPick?.picked.some((p) => p.id === card.id));
        if (!ringClass && isCostPicked) {
            ringClass = "ring-2 ring-signal-self rounded-sm";
        } else if (!ringClass && isValidSacrificePick) {
            ringClass = "ring-2 ring-accent/40 rounded-sm";
        }

        // CR 508.1a (issue #1220) — a planeswalker under attack reads GREEN (a
        // committed attack target), the same emerald selection ring targets and
        // choices use; a clickable-but-unchosen defending planeswalker reads with
        // the faded-accent "valid target" ring.
        if (!ringClass && isAttackTargetPw && isAttackedPlaneswalker(card)) {
            ringClass = "ring-2 ring-signal-self rounded-sm";
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
