import { useState } from "react";
import type { CardInstance, Player } from "~/types/game";
import type { ManaCost } from "~/types/cards";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useBattlefieldVisualState } from "~/hooks/useBattlefieldVisualState";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getDefinition } from "@convex/cards";
import {
    isCreature,
    isPlaneswalker,
    getManaChoices,
    getNonTapManaChoices,
    getActivatedManaMenuEntry,
    canRefundManaTap,
    getStackAbilities,
    getAnyPlayerStackAbilities,
    buildTriggerStateView,
    wantsPermanentTarget,
    matchesTargetRequirement,
    matchesTargetExclusions,
    matchesTargetController,
    isTapLockedBySummoningSickness,
    hasManaAbility,
    pendingCastHasImprovise,
} from "~/lib/card-utils";
import { isUntargetableByPending } from "~/lib/targeting";
import { activeSacrificeSelection } from "~/lib/sacrifice-selection";
import { outstandingDamageAssigner } from "~/lib/priority";
import { extractMutationError, type MutationError } from "~/lib/mutation-error";
import type { ActivatableAbility } from "~/components/board/battlefield-card";
import ManaChoicePicker from "~/components/board/mana-choice-picker";
import CastCostDialog from "~/components/cards/cast-cost-dialog";
import ErrorToast from "~/components/board/error-toast";

/** Battlefield interaction controller for one player's battlefield (PRD #249,
 *  slice #272). Mirrors how {@link useBattlefieldVisualState} (#256) was
 *  extracted so the classic board and the spatial board (`?board=next`) share a
 *  single source of truth — here for the *interaction* layer (clicks, mana
 *  payment, the mana-choice picker and the validation toast) rather than the
 *  *visual* layer.
 *
 *  This hook OWNS, for one battlefield:
 *  - the Convex mutations (`tapUntap`, `tapForPayment`/`untapForPayment`,
 *    `tapForActivationPayment`/`untapForActivationPayment`, plus the
 *    target/choice/combat/activation mutations the follow-up slices need),
 *  - the per-card click handlers (`handleClick` / `handleClickWithEvent`),
 *  - the activated-ability menu (`getActivatable` + `handleActivateAbility`),
 *  - the mana-choice-picker state (multi-color sources: Black Lotus, Birds),
 *  - the client-side validation-error state.
 *
 *  Both `PlayerBattlefield` (classic) and the spatial battlefield consume the
 *  identical handler set, so a tap / in-payment tap / mana-choice pick
 *  dispatches the SAME mutation with the SAME args on either board.
 *
 *  The follow-up battlefield slices (#278 ability menu / #279 targeting+choice /
 *  #281 combat) reuse the handlers untouched: their click branches and the
 *  `getActivatable`/`handleActivateAbility` pair are kept here intact. THIS
 *  slice only requires the spatial card to wire tap/pay + the mana picker +
 *  the validation toast.
 *
 *  Reads ONLY projected (`PublicGameState` / `FullGameState`) fields exposed by
 *  `useGameContext()` — no GRE engine import, consistent with the wire-format
 *  rule in CLAUDE.md.
 *
 *  Returns the handlers plus `getVisualState`/`canInteract` (re-exposed from the
 *  shared visual-state hook so a consumer needs a single call) and an
 *  `overlays` node bundling the mana-choice picker + validation toast, which the
 *  caller mounts wherever its layout needs them (classic: in the battlefield
 *  root; spatial: in the board root). */
export function useBattlefieldInteraction(player: Player) {
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
        meleeCombat,
        allPlayers,
        cannotActivateAbilitiesThisTurn,
        lifeGainedThisTurn,
    } = useGameContext();
    const isMe = player.id === playerId;
    // Melee (#669) — under `meleeCombat` the attacking (active) player declares
    // blocks; otherwise the defending (non-active) player does.
    const blockDeclarerId = meleeCombat
        ? activePlayerId
        : allPlayers.find((p) => p.id !== activePlayerId)?.id;

    // Mutations
    const tapUntap = useMutation(api.game.tapUntap);
    const tapForPayment = useMutation(api.game.tapForPayment);
    const untapForPayment = useMutation(api.game.untapForPayment);
    // CR 702.126 — Improvise: tap/untap an untapped artifact toward the
    // generic portion of a cast's cost, alongside (not instead of) the mana
    // taps above.
    const tapArtifactForImprovise = useMutation(
        api.game.tapArtifactForImprovise
    );
    const untapArtifactForImprovise = useMutation(
        api.game.untapArtifactForImprovise
    );
    const tapForActivationPayment = useMutation(
        api.game.tapForActivationPayment
    );
    const untapForActivationPayment = useMutation(
        api.game.untapForActivationPayment
    );
    const tapForAttackTax = useMutation(api.game.tapForAttackTax);
    const untapForAttackTax = useMutation(api.game.untapForAttackTax);
    const toggleAttacker = useMutation(api.game.toggleAttacker);
    const selectBlocker = useMutation(api.game.selectBlocker);
    const assignBlockerTarget = useMutation(api.game.assignBlockerTarget);
    const selectTarget = useMutation(api.game.selectTarget);
    const selectAdditionalCost = useMutation(api.game.selectAdditionalCost);
    const selectActivationCost = useMutation(api.game.selectActivationCost);
    const selectSacrifice = useMutation(api.game.selectSacrifice);
    const activateAbility = useMutation(api.game.activateAbility);
    const activateManaAbility = useMutation(api.game.activateManaAbility);
    const bufferCtx = usePendingChoiceBuffer();

    // Board-coupled visual state (combat rings, tap, damage, legal-target
    // highlight) and the interaction predicate live in the shared visual-state
    // hook so both boards read identical state (#256). Re-exposed here so a
    // consumer gets visuals + interaction from one call.
    const { getVisualState, canInteract } = useBattlefieldVisualState(player);

    // Mana choice picker state. `inPayment` routes the selection to
    // tapForPayment (committing the cast) vs tapUntap (floating mana).
    // `nonTapAbilityId` (issue #1179) instead routes a NON-tap choice-based
    // mana ability's (Vivi Ornitier) pick to `activateManaAbility` with the
    // chosen `manaChoiceIndex`, bypassing the tap mutations entirely.
    const [manaChoiceState, setManaChoiceState] = useState<{
        cardId: string;
        choices: ManaCost[];
        position?: { x: number; y: number };
        inPayment: boolean;
        nonTapAbilityId?: string;
    } | null>(null);

    const [validationError, setValidationError] =
        useState<MutationError | null>(null);

    // CR 601.2b — X in an activated ability's mana cost is chosen before the
    // ability goes on the stack. Parked here while the in-game cost dialog
    // collects the value (replacing the old native `window.prompt`); the
    // confirm handler dispatches `activateAbility` with the chosen X.
    const [abilityXChoiceState, setAbilityXChoiceState] = useState<{
        cardInstanceId: string;
        abilityId: string;
        cardName: string;
        oracleText?: string;
        keepPriority: boolean;
    } | null>(null);

    function guardMutation(promise: Promise<unknown>) {
        promise.catch((err) => {
            setValidationError(extractMutationError(err));
        });
    }

    // --- Interaction modes ---

    const isPayingCast =
        isMe && !!pendingCast && pendingCast.playerId === playerId;

    const isPayingActivation =
        isMe && !!pendingActivation && pendingActivation.playerId === playerId;

    // CR 508.1c/1g — the parked per-attacker MANA attack tax (Propaganda /
    // Collective Restraint): the attacking player taps mana sources toward the
    // tax the same way a cast payment does (via tapForAttackTax).
    const isPayingAttackTax =
        isMe &&
        !!combat?.pendingAttackManaTax &&
        combat.pendingAttackManaTax.playerId === playerId;

    const isInPayment = isPayingCast || isPayingActivation || isPayingAttackTax;

    // CR 602.5b — same viewer-visible board snapshot `useBattlefieldVisualState`
    // feeds `hasManaAbility` as `manaGateView`, reused here so the Improvise
    // routing branch below (`handleClick`) agrees with the `canInteract` gate
    // that decided the click was legal in the first place.
    const manaGateView = buildTriggerStateView(allPlayers, activePlayerId);

    // A mana-choice picker opened to pay a cast/activation cost is anchored to
    // that payment. If the payment ends by another route — the player presses
    // Auto-tap (PaymentBanner), or the cost is cancelled/completed — the picker
    // is stale and must close. Detect the payment window closing and drop the
    // stale picker during render (the React-blessed "adjust state on prop
    // change" pattern, not a setState-in-effect), covering all three cases
    // without cross-component wiring to the Auto-tap button.
    const [prevInPayment, setPrevInPayment] = useState(isInPayment);
    if (isInPayment !== prevInPayment) {
        setPrevInPayment(isInPayment);
        if (!isInPayment && manaChoiceState?.inPayment) {
            setManaChoiceState(null);
        }
    }

    const hasPriority = isMe && priorityPlayerId === playerId;
    // CR 113.3c — "any player may activate" abilities (Ifh-Bíff Efreet) can be
    // fired by the viewer even on an OPPONENT's permanent. Surface those on the
    // opponent's block whenever the viewer holds priority. Distinct from
    // `hasPriority` (which is gated on `isMe`) so the controller-only default is
    // unaffected.
    const viewerHasPriority = priorityPlayerId === playerId;

    const isSelectingTarget =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsPermanentTarget(pendingTarget.targetType);

    // Mid-resolution choice targeting a battlefield zone (CR 608.2). The
    // chooser (viewer == activeChoice.playerId) clicks on the battlefield
    // belonging to `zoneOwnerId ?? activeChoice.playerId`. Default behavior
    // — the chooser picks from their own battlefield — keeps `zoneOwnerId`
    // unset. Cross-player picks (e.g. Demonic Hordes: opponent picks one of
    // controller's lands) set `zoneOwnerId` to the zone owner.
    const activeChoice = pendingChoices?.[0];
    const isViewerChoosing =
        !!activeChoice && activeChoice.playerId === playerId;
    const choiceZoneOwnerId = activeChoice
        ? (activeChoice.zoneOwnerId ?? activeChoice.playerId)
        : undefined;
    // `allControllers` choices (CR 707 — Clone / Copy Artifact "any creature /
    // artifact on the battlefield") let the chooser pick from EVERY player's
    // battlefield, so every battlefield is interactive; the per-card filter
    // below still restricts which cards are clickable.
    const isSelectingChoice =
        isViewerChoosing &&
        activeChoice!.zone === "battlefield" &&
        (activeChoice!.allControllers === true ||
            choiceZoneOwnerId === player.id);

    // Unified sacrifice picker (CR 701.21a). Active whenever a SacrificeSelection
    // for this viewer is parked and incomplete — the same structure for a cast
    // additional cost / Drought, an activated-ability sacrifice cost, and the
    // attack-declaration land tax. Routes clicks to selectSacrifice.
    const sacrificeSelection = isMe
        ? activeSacrificeSelection(
              pendingCast,
              pendingActivation,
              combat,
              playerId
          )
        : undefined;
    const isPickingSacrifice = !!sacrificeSelection;

    // Exile additional-cost picker (CR 117.9 / 406, Soul Exchange). Active when
    // this player's pendingCast is waiting for them to exile a permanent.
    // `additionalCost` is exile-only now (the sacrifice branch migrated to the
    // unified sacrifice picker above). Routes clicks to selectAdditionalCost.
    const isPickingAdditionalCost =
        isMe &&
        !!pendingCast &&
        pendingCast.playerId === playerId &&
        !!pendingCast.additionalCost &&
        !pendingCast.additionalCost.pickedId;

    // Activated-ability tap-other cost picker: "tap N untapped permanents
    // matching <filter>" (CR 602.1 / 118.8, Hand of Justice). The sacrifice
    // branch migrated to the unified sacrifice picker above. Eligibility is
    // enforced by `canInteract` (shared visual-state hook, #939); this flag
    // only decides whether a click routes here at all.
    const isPickingActivationCost =
        isMe &&
        !!pendingActivation &&
        pendingActivation.playerId === playerId &&
        !!pendingActivation.tapOtherChoice &&
        pendingActivation.tapOtherChoice.pickedIds.length <
            pendingActivation.tapOtherChoice.count;

    const isSelectingAttackers =
        phase === "DECLARE_ATTACKERS" &&
        !!combat &&
        !combat.confirmed &&
        // While the mana attack tax is parked the declaration is locked pending
        // payment — clicks are taps toward the tax, not attacker toggles.
        !combat.pendingAttackManaTax &&
        isMe &&
        playerId === activePlayerId;

    // CR 508.1a (issue #1220) — while the active player is declaring attackers,
    // the DEFENDING player's planeswalkers are legal attack targets. This board
    // is the defender's, the viewer is the declaring active player, and at least
    // one attacker has been declared to point at a planeswalker.
    const isAttackTargetBoard =
        phase === "DECLARE_ATTACKERS" &&
        !!combat &&
        !combat.confirmed &&
        !combat.pendingAttackManaTax &&
        playerId === activePlayerId &&
        player.id !== activePlayerId &&
        combat.attackerIds.length > 0;

    // The declarer selects from the DEFENDING player's creatures, so the
    // clickable battlefield is always the non-active player's — even under Melee
    // where the attacker is the one choosing.
    const defenderId = allPlayers.find((p) => p.id !== activePlayerId)?.id;
    const isSelectingBlockers =
        phase === "DECLARE_BLOCKERS" &&
        !!combat &&
        !combat.blockersConfirmed &&
        playerId === blockDeclarerId &&
        player.id === defenderId;

    const isBlockerTarget =
        phase === "DECLARE_BLOCKERS" &&
        !!combat &&
        !combat.blockersConfirmed &&
        !!combat.pendingBlockerId &&
        playerId === blockDeclarerId &&
        player.id !== defenderId;

    // CR 702.21j-k: the player who assigns may be the defender, so gate on the
    // outstanding assigner rather than always the active player.
    const isAssigningDamage =
        (phase === "COMBAT_DAMAGE" || phase === "FIRST_STRIKE_DAMAGE") &&
        !!combat &&
        combat.damageConfirmed === false &&
        isMe &&
        playerId ===
            outstandingDamageAssigner({
                playerId,
                activePlayerId,
                priorityPlayerId: activePlayerId,
                phase,
                combat,
            });

    // --- Combat derived state ---

    const selectedAttackerIds = combat?.attackerIds ?? [];

    // --- Card-level logic ---

    function handleClick(card: CardInstance) {
        if (!canInteract(card)) return;

        if (isSelectingChoice) {
            bufferCtx.toggle(card.id);
            return;
        }

        if (isPickingSacrifice) {
            guardMutation(
                selectSacrifice({
                    gameId,
                    playerId,
                    cardInstanceId: card.id,
                })
            );
            return;
        }

        if (isPickingAdditionalCost) {
            guardMutation(
                selectAdditionalCost({
                    gameId,
                    playerId,
                    cardInstanceId: card.id,
                })
            );
            return;
        }

        if (isPickingActivationCost) {
            guardMutation(
                selectActivationCost({
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
            // CR 601.2d — a divide-as-you-choose spell is NOT click-to-target:
            // each legal target carries an on-card [−] N [+] stepper (the divide
            // buffer) and the banner "Deal damage" finalizes. Clicking the card
            // is inert here; the stepper owns assignment.
            pendingTarget.divideTotal === undefined &&
            matchesTargetRequirement(card, pendingTarget.targetType) &&
            matchesTargetExclusions(card, pendingTarget) &&
            // CR 109.3 / 102.1 — don't fire selectTarget for a wrong-controller
            // permanent; `useBattlefieldVisualState` already dims it, so firing
            // the doomed mutation just surfaces an error toast (#904). Mirror
            // the visual-state gate: chooser is pendingTarget.playerId.
            matchesTargetController(
                card.controllerId,
                pendingTarget.playerId,
                activePlayerId,
                pendingTarget.controller
            ) &&
            // CR 702.18 / 611 — don't fire selectTarget for a shrouded /
            // "can't be the target" permanent; the server would reject it
            // anyway (#382).
            !isUntargetableByPending(
                allPlayers,
                card,
                pendingTarget.cardInstanceId,
                pendingTarget.kind,
                // CR 702.11b — the chooser controls the source; hexproof bars
                // only an opponent's source, never the controller's own.
                pendingTarget.playerId
            )
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
            const reqDef = getDefinition(card.card.id);
            const hasAttackReq = !!reqDef.staticEffects?.some(
                (e) => e.kind === "attack-requirement"
            );
            const mustAttackClient =
                alreadySelected &&
                hasAttackReq &&
                !card.isTapped &&
                !card.isSummoningSick;
            if (mustAttackClient) {
                const name = getDefinition(card.card.id).name;
                const msg = `${name} must attack this combat if able`;
                setValidationError({ title: msg, detail: msg });
                return;
            }
            guardMutation(
                toggleAttacker({ gameId, playerId, cardInstanceId: card.id })
            );
            return;
        }
        if (isAttackTargetBoard && isPlaneswalker(card)) {
            // CR 508.1a (issue #1220) — direct a declared attacker at this
            // planeswalker. Pick the most-recently declared attacker not already
            // attacking it (retargeting from the player or another planeswalker);
            // repeated clicks pile attackers onto the planeswalker. Re-declaring
            // the attacker on the own board sends it back to the player.
            const targets = combat?.attackTargets ?? {};
            const attackerId = [...(combat?.attackerIds ?? [])]
                .reverse()
                .find((id) => targets[id] !== card.id);
            if (!attackerId) return;
            guardMutation(
                toggleAttacker({
                    gameId,
                    playerId,
                    cardInstanceId: attackerId,
                    planeswalkerId: card.id,
                })
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

        // CR 702.126 — Improvise: a mana-ability-less artifact reaching this
        // point (canInteract already gated it — useBattlefieldVisualState's
        // matching branch) pays the cast's generic cost by tapping, not by
        // adding mana. Routes to the dedicated pair instead of the mana-tap
        // mutations below, which reject a card with no mana ability outright.
        if (
            isInPayment &&
            isPayingCast &&
            pendingCast &&
            !hasManaAbility(card, manaGateView) &&
            (card.types?.includes("Artifact") ?? false) &&
            pendingCastHasImprovise(pendingCast, player)
        ) {
            guardMutation(
                (card.isTapped
                    ? untapArtifactForImprovise
                    : tapArtifactForImprovise)({
                    gameId,
                    playerId,
                    cardInstanceId: card.id,
                })
            );
            return;
        }

        // Mana source tap/untap (lands, mox, etc.)
        if (isInPayment) {
            const tapMutation = isPayingCast
                ? tapForPayment
                : isPayingActivation
                  ? tapForActivationPayment
                  : tapForAttackTax;
            const untapMutation = isPayingCast
                ? untapForPayment
                : isPayingActivation
                  ? untapForActivationPayment
                  : untapForAttackTax;
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
            const choices = getManaChoices(card, allPlayers);
            if (choices) {
                setManaChoiceState({
                    cardId: card.id,
                    choices,
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
            const choices = getManaChoices(card, allPlayers);
            if (choices && !card.isTapped) {
                // No mouse event here — omit `position` so the picker centres
                // on screen instead of pinning to the top-left corner.
                setManaChoiceState({
                    cardId: card.id,
                    choices,
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
        // Same for combat sub-states where the click is a declaration
        // (CR 508.1 / 509.1): otherwise a multi-color mana source like Birds
        // of Paradise would open its color picker instead of being declared
        // as a blocker.
        if (
            isSelectingChoice ||
            isSelectingTarget ||
            isSelectingAttackers ||
            isSelectingBlockers ||
            isBlockerTarget ||
            isAssigningDamage
        ) {
            handleClick(card);
            return;
        }
        const choices = getManaChoices(card, allPlayers);
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

    function getActivatable(card: CardInstance): ActivatableAbility[] {
        // Activation is blocked entirely while any payment/target/choice is in
        // progress, regardless of whose permanent this is.
        if (
            pendingCast ||
            pendingActivation ||
            pendingTarget ||
            (pendingChoices && pendingChoices.length > 0)
        ) {
            return [];
        }
        // CR 602.5b — viewer-visible state fed to each ability's `canActivate`
        // predicate so player/board-reading gates (Library of Alexandria's
        // seven-card hand, Pestilence's creature-present, Nettling Imp's
        // active-player check) evaluate correctly as a UI hint (#436). Server
        // validation against the full GameState remains authoritative.
        const stateView = buildTriggerStateView(
            allPlayers,
            activePlayerId,
            cannotActivateAbilitiesThisTurn,
            lifeGainedThisTurn
        );
        // CR 113.3c — on an OPPONENT's permanent, the viewer may only activate
        // "any player may activate" abilities, and only while holding priority.
        // Controller-only abilities and mana abilities stay hidden there.
        if (!isMe) {
            if (!viewerHasPriority) return [];
            // CR 118.4 — the viewer (not the permanent's controller) pays an
            // any-player ability's life cost, so gate on the viewer's own life.
            const viewerLife = allPlayers.find((p) => p.id === playerId)?.life;
            return getAnyPlayerStackAbilities(
                card,
                phase,
                stateView,
                viewerLife
            );
        }
        if (!hasPriority) {
            return [];
        }
        // CR 508.1 / 509.1 — declaring attackers and declaring blockers are
        // turn-based actions: no player has priority while they're in
        // progress, so no activated ability (including mana abilities) can
        // be used. Priority opens only after the choice is locked in
        // (CR 508.2 / 509.2).
        if (phase === "DECLARE_ATTACKERS" && combat && !combat.confirmed) {
            return [];
        }
        if (
            phase === "DECLARE_BLOCKERS" &&
            combat &&
            !combat.blockersConfirmed
        ) {
            return [];
        }
        // Jandor's Ring discard cost (CR 118.3): payable only while the
        // controller's last-drawn-this-turn card is still in hand.
        const canDiscardLastDrawn =
            player.lastDrawnCardId !== undefined &&
            player.hand.some(
                (c) => c !== null && c.id === player.lastDrawnCardId
            );
        const stack = getStackAbilities(
            card,
            phase,
            canDiscardLastDrawn,
            stateView,
            // CR 118.4 — controller's own ability: the controller (this `player`,
            // the viewer on the isMe path) pays the life cost.
            player.life,
            // CR 602.1 / 118.3 — the `discardFilter` cost (Survival of the
            // Fittest) is always paid from the CONTROLLER's own hand; this
            // `isMe` path's `player.hand` is the real (non-nulled) hand.
            player.hand.filter((c): c is CardInstance => c !== null)
        );
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
        // CR 605.1a / 601.2f / 605.3c (issue #1179) — a mana ability must NOT
        // be a silent left-click tap-for-mana when EITHER: (a) its cost
        // includes MANA, tap or not (Chromatic Star "{1}, {T}, Sacrifice: Add
        // any", Farrelite Priest "{1}: Add {W}") — the player has to choose to
        // pay it; OR (b) it has no {T}/sacrifice component at all (Vivi
        // Ornitier's free "{0}:" runtime {U}/{R} split) — there is no tap
        // toggle to reach it through in the first place. Surface it as an
        // explicit menu entry either way. Selecting it routes through the
        // colour picker + `tapUntap` (tap) or `activateManaAbility` (non-tap)
        // in `handleActivateAbility`, so the cost is charged / the choice is
        // resolved. Independent of the plain `getActivatedManaMenuEntry` tap
        // toggle below (free-to-activate, no-mana-cost TAP mana sources).
        // Repeatable, so always offered.
        const manaCostAbility = getDefinition(
            card.card.id
        ).activatedAbilities?.find(
            (a) =>
                !a.useStack &&
                a.oracleText &&
                (!!a.cost.mana || (!a.cost.tap && !a.cost.sacrifice))
        );
        const manaCostEntry: ActivatableAbility[] = manaCostAbility
            ? [
                  {
                      id: manaCostAbility.id,
                      oracleText: manaCostAbility.oracleText,
                  },
              ]
            : [];
        // The plain tap-for-mana toggle (Basalt Monolith / Mana Vault: surfaced
        // as a menu entry only when a stack ability co-exists, so a click isn't
        // ambiguous). A cost-bearing mana ability is already in `manaCostEntry`,
        // so never double-list it here.
        const mana = getActivatedManaMenuEntry(card, stateView);
        const manaToggle =
            mana && mana.id !== manaCostAbility?.id ? mana : null;
        if (stack.length === 0) return manaCostEntry;
        if (!manaToggle) return [...manaCostEntry, ...stack];
        if (card.isTapped) {
            if (!canRefundManaTap(card, player.manaPool))
                return [...manaCostEntry, ...stack];
            return [
                { id: manaToggle.id, oracleText: "Untap and refund mana" },
                ...manaCostEntry,
                ...stack,
            ];
        }
        if (isTapLockedBySummoningSickness(card))
            return [...manaCostEntry, ...stack];
        return [manaToggle, ...manaCostEntry, ...stack];
    }

    function handleActivateAbility(
        cardInstanceId: string,
        abilityId: string,
        keepPriority: boolean
    ) {
        const card = player.battlefield.find((c) => c.id === cardInstanceId);
        if (!card) return;
        const def = getDefinition(card.card.id);
        const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
        // Mana ability selected from the menu (useStack:false) — route through
        // the mana-ability flow (`tapUntap`, or the mana picker for sources
        // with `manaChoices`) instead of the activated-ability mutation.
        if (ability && !ability.useStack) {
            // CR 605.1a / 605.3c (issue #1179) — a NON-tap, non-sacrifice
            // mana ability (Farrelite Priest's mana cost, or Vivi Ornitier's
            // free "{0}:") is not a tap toggle: it resolves immediately via
            // `activateManaAbility` rather than `tapUntap`. When it ALSO
            // declares a runtime CHOICE (Vivi's {U}/{R} split), open the
            // picker first and submit the chosen index alongside the
            // mutation instead of firing it directly.
            if (!ability.cost.tap && !ability.cost.sacrifice) {
                const nonTapChoices = getNonTapManaChoices(card, allPlayers);
                if (nonTapChoices) {
                    setManaChoiceState({
                        cardId: card.id,
                        choices: nonTapChoices,
                        inPayment: false,
                        nonTapAbilityId: abilityId,
                    });
                    return;
                }
                guardMutation(
                    activateManaAbility({
                        gameId,
                        playerId,
                        cardInstanceId: card.id,
                        abilityId,
                    })
                );
                return;
            }
            // Board-conditional choosers (Fellwar Stone) derive their colours
            // from every player's battlefield, so pass `allPlayers` (CR 106.1).
            const choices = getManaChoices(card, allPlayers);
            if (choices) {
                setManaChoiceState({
                    cardId: card.id,
                    choices,
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
        // activator chooses X before announcement. Open the in-game cost dialog
        // (same one the spell-cast path uses); the confirm handler dispatches
        // `activateAbility` with the chosen X.
        const hasX =
            ability?.cost.mana?.X !== undefined &&
            typeof ability.cost.mana.X === "string";
        if (hasX) {
            setAbilityXChoiceState({
                cardInstanceId,
                abilityId,
                cardName: def.name,
                oracleText: ability?.oracleText,
                keepPriority,
            });
            return;
        }
        guardMutation(
            activateAbility({
                gameId,
                playerId,
                cardInstanceId,
                abilityId,
                keepPriority: keepPriority || undefined,
                chosenX: undefined,
            })
        );
    }

    // --- Overlays (mana-choice picker + validation toast) ---
    // Bundled as one node so each board mounts the interaction surfaces where
    // its layout needs them (classic: battlefield root; spatial: board root).
    const overlays = (
        <>
            {manaChoiceState && (
                <ManaChoicePicker
                    choices={manaChoiceState.choices}
                    position={manaChoiceState.position}
                    onSelect={(index) => {
                        // CR 605.1a / 605.3c (issue #1179) — a NON-tap choice-
                        // based mana ability (Vivi Ornitier) submits its pick
                        // to `activateManaAbility`, not a tap mutation.
                        if (manaChoiceState.nonTapAbilityId) {
                            guardMutation(
                                activateManaAbility({
                                    gameId,
                                    playerId,
                                    cardInstanceId: manaChoiceState.cardId,
                                    abilityId: manaChoiceState.nonTapAbilityId,
                                    manaChoiceIndex: index,
                                })
                            );
                            setManaChoiceState(null);
                            return;
                        }
                        const args = {
                            gameId,
                            playerId,
                            cardInstanceId: manaChoiceState.cardId,
                            manaChoiceIndex: index,
                        };
                        if (manaChoiceState.inPayment) {
                            const mutation = isPayingCast
                                ? tapForPayment
                                : isPayingActivation
                                  ? tapForActivationPayment
                                  : tapForAttackTax;
                            guardMutation(mutation(args));
                        } else {
                            guardMutation(tapUntap(args));
                        }
                        setManaChoiceState(null);
                    }}
                    onCancel={() => setManaChoiceState(null)}
                />
            )}
            {abilityXChoiceState && (
                <CastCostDialog
                    open
                    cardName={abilityXChoiceState.cardName}
                    subtitle={abilityXChoiceState.oracleText}
                    askX
                    onConfirm={({ chosenX }) => {
                        const s = abilityXChoiceState;
                        setAbilityXChoiceState(null);
                        guardMutation(
                            activateAbility({
                                gameId,
                                playerId,
                                cardInstanceId: s.cardInstanceId,
                                abilityId: s.abilityId,
                                keepPriority: s.keepPriority || undefined,
                                chosenX,
                            })
                        );
                    }}
                    onCancel={() => setAbilityXChoiceState(null)}
                />
            )}
            <ErrorToast
                error={validationError}
                gameId={gameId}
                onDismiss={() => setValidationError(null)}
            />
        </>
    );

    // Whether a per-instance battlefield SELECTION is active for THIS player's
    // board — a mid-resolution `choose-permanents` pick (Frantic Search's untap),
    // a sacrifice cost (Fireblast's two Mountains), an exile additional cost, or
    // an activated-ability tap-other cost. When true the board must UN-STACK
    // identical permanents (like the divide-target case) so each candidate gets
    // its own slot and its selection ring is visible — a selected card can't read
    // as "picked" while buried in a fan of identical copies.
    const isSelectingOnThisBoard =
        isSelectingChoice ||
        isPickingSacrifice ||
        isPickingAdditionalCost ||
        isPickingActivationCost;

    return {
        getVisualState,
        canInteract,
        handleClick,
        handleClickWithEvent,
        getActivatable,
        handleActivateAbility,
        isSelectingOnThisBoard,
        overlays,
    };
}
