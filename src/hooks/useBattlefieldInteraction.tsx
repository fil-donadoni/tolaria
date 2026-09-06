import { useState } from "react";
import type { CardInstance, Player } from "~/types/game";
import type { ManaCost } from "~/types/cards";
import type { AbilityMode } from "@convex/cards/types";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import {
    useBattlefieldVisualState,
    type ManaTapOtherPick,
} from "~/hooks/useBattlefieldVisualState";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getDefinition } from "@convex/cards";
import {
    isCreature,
    isPlaneswalker,
    getManaChoices,
    getNonTapManaChoices,
    getActivatedManaMenuEntry,
    getEffectiveClientAbilities,
    getManaCostMenuAbility,
    tapOtherCostCandidates,
    canRefundManaTap,
    getStackAbilities,
    getAnyPlayerStackAbilities,
    buildTriggerStateView,
    wantsPermanentTarget,
    matchesTargetRequirement,
    matchesPermanentTargetFilters,
    isTapLockedBySummoningSickness,
    manaActivationRequiresTap,
    hasManaAbility,
    pendingCastHasImprovise,
    displayCardId,
} from "~/lib/card-utils";
import { pendingChoiceRoutesToBattlefield } from "~/lib/pending-choice-labels";
import { isUntargetableByPending } from "~/lib/targeting";
import { activeSacrificeSelection } from "~/lib/sacrifice-selection";
import { outstandingDamageAssigner } from "~/lib/priority";
import { extractMutationError, type MutationError } from "~/lib/mutation-error";
import {
    hasPendingGameIntent,
    trackGameIntent,
} from "~/lib/pending-intent-store";
import {
    canPayTapOtherCost,
    isTapOtherChoicePaid,
    isTapOtherPickForced,
    isTapOtherSelectionComplete,
    type TapOtherCandidate,
} from "@convex/gre/tapOtherCost";
import type { ActivatableAbility } from "~/components/board/battlefield-card";
import ManaChoicePicker from "~/components/board/mana-choice-picker";
import ManaTapOtherBanner from "~/components/board/mana-tap-other-banner";
import CastCostDialog from "~/components/cards/cast-cost-dialog";
import ModePicker from "~/components/cards/mode-picker";
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
 *  `BoardBattlefield` (`src/components/board/board-battlefield.tsx`) is the
 *  sole caller: a tap / in-payment tap / mana-choice pick dispatches the SAME
 *  mutation with the SAME args regardless of which seat's battlefield it
 *  fired from. `BoardBattlefield` never calls this hook by name — it reads
 *  the hook FUNCTION from `useBattlefieldInteractionContext`
 *  (`src/hooks/useBattlefieldInteractionContext.ts`), which defaults to this
 *  hook and lets a non-GRE board (the Manual Game, PRD #2162) supply its own
 *  without forking the component.
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
 *  caller mounts wherever its layout needs them. */
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
        emblems,
        stackItems,
        engineTurn,
        controlChangedThisTurn,
        continuousEffects,
    } = useGameContext();
    // CR 302.6 / 400.7 (issue #1824) — the continuity facts a
    // `controlledSinceTurnStart` target filter is evaluated against. Must be
    // `engineTurn` (the wire `GameState.turn`), never the context's display
    // `turn`, since `enteredOnTurn` is stamped from the global turn number.
    // Undefined when the engine turn is unknown → the filter fails CLOSED, so
    // the click handler never fires `selectTarget` for a target the server
    // would reject.
    const controlContinuity =
        typeof engineTurn === "number"
            ? { turn: engineTurn, controlChangedThisTurn }
            : undefined;
    const isMe = player.id === playerId;
    // The VIEWER's own player row. Usually identical to `player` (this board is
    // the viewer's), but an attached permanent renders on its HOST's board
    // (`attachedAurasByHost` in `board-battlefield.tsx` is built from every
    // battlefield), so a card the viewer controls can be rendered by the
    // OPPONENT's board instance — and vice versa. Every activation affordance
    // is judged against the viewer's own hand/life/mana, never the board's.
    const viewer = allPlayers.find((p) => p.id === playerId) ?? player;
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
    const attackSequence = useAttackSequence();

    // CR 602.1 / 118.8 / 605.3c (issue #2371) — a NON-stack mana ability's
    // `cost.tapOtherFilter` picks ("Tap an untapped artifact you control: Add
    // {U}", Urza, Lord High Artificer). Parked here between the ability-menu
    // click and the single `activateManaAbility` dispatch that carries the
    // finished `tapOtherIds`: unlike its `useStack: true` sibling there is no
    // stack item to defer the pick onto server-side
    // (`pendingActivation.tapOtherChoice`) because a mana ability resolves
    // inside one mutation call. See {@link ManaTapOtherPick}.
    const [manaTapOtherPick, setManaTapOtherPick] =
        useState<ManaTapOtherPick | null>(null);

    // Board-coupled visual state (combat rings, tap, damage, legal-target
    // highlight) and the interaction predicate live in the shared visual-state
    // hook so both boards read identical state (#256). Re-exposed here so a
    // consumer gets visuals + interaction from one call. The client-local
    // tap-other pick is handed DOWN so `canInteract` and the pick rings agree
    // with `handleClick`'s router below — a picker whose clickability and
    // highlight are derived independently is how a "highlighted but inert"
    // permanent ships.
    const { getVisualState, canInteract } = useBattlefieldVisualState(
        player,
        manaTapOtherPick
    );

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

    // CR 700.2 / 602.2b (issue #1341) — a MODAL activated ability (Umezawa's
    // Jitte) locks its mode in at announcement, BEFORE targets are chosen, so
    // the picker has to run client-side before `activateAbility` is called at
    // all. Mirrors the modal-spell flow in `useHandCardCommit`, reusing the
    // same `<ModePicker>`.
    const [abilityModeChoiceState, setAbilityModeChoiceState] = useState<{
        cardInstanceId: string;
        abilityId: string;
        cardName: string;
        modes: AbilityMode[];
        keepPriority: boolean;
    } | null>(null);

    function guardMutation(promise: Promise<unknown>) {
        // Registered as an in-flight game intent for the round-trip so the
        // Space hotkey can't fall through to `passPriority` in the window
        // between dispatching (e.g. an ability activation) and the payment
        // banner / prompt actually rendering — that reflex keystroke used to
        // advance the phase instead (see `pending-intent-store.ts`).
        trackGameIntent(promise).catch((err) => {
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
    const manaGateView = buildTriggerStateView(
        allPlayers,
        activePlayerId,
        undefined,
        undefined,
        undefined,
        continuousEffects
    );

    /** The FULL viewer-visible board projection every ability-menu gate and
     *  every cost-pick computation reads. One builder, deliberately: the menu
     *  decides an ability is offerable from this view, and `handleActivateAbility`
     *  then computes the cost's candidate set from it — two different views
     *  would let the menu offer an ability whose picker then finds nothing
     *  (issue #2371). Carries the turn-scoped facts a `controlledSinceTurnStart`
     *  / `enteredThisTurn` filter dimension needs (CR 302.6 / 400.7, #1824);
     *  without them those dimensions stay undefined and fail closed. */
    function abilityStateView() {
        return buildTriggerStateView(
            allPlayers,
            activePlayerId,
            cannotActivateAbilitiesThisTurn,
            lifeGainedThisTurn,
            controlContinuity,
            continuousEffects
        );
    }

    // CR 106.1 (issue #1889) — `allPlayers` is handed to `hasManaAbility` below
    // (the same list `getManaChoices` already gets), so this branch agrees with
    // `useBattlefieldVisualState`'s matching gate on a source whose current tap
    // option list is empty (an Everflowing Chalice with no charge counters).

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

    // CR 117.3 — the single priority gate for every activation affordance. It
    // is deliberately NOT scoped to `isMe` (the board being rendered): what
    // matters is that the VIEWER holds priority, whether the permanent is the
    // viewer's own, an opponent's with an "any player may activate" ability
    // (CR 113.3c, Ifh-Bíff Efreet), or an attachment rendered on the other
    // side's board (CR 602.1, Merseine). The per-card controller split in
    // `getActivatable` decides WHICH abilities are offered.
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
        pendingChoiceRoutesToBattlefield(activeChoice!) &&
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

    // Exile additional-cost picker (CR 118.8 / 406, Soul Exchange). Active when
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
        !isTapOtherChoicePaid(pendingActivation.tapOtherChoice);

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

    // CR 702.22j-k: the player who assigns may be the defender, so gate on the
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

        // CR 602.1 / 118.8 / 605.3c (issue #2371) — a click while the mana
        // ability's tap-other picker is open commits ONE pick; the whole set
        // is dispatched the moment the cost is covered. Modal, mirroring
        // `canInteract`'s own precedence: while this is open nothing else on
        // the board is a legal click.
        if (manaTapOtherPick) {
            const candidate = manaTapOtherPick.candidates.find(
                (c) => c.id === card.id
            );
            if (!candidate) return;
            if (manaTapOtherPick.picked.some((p) => p.id === card.id)) return;
            const picked = [...manaTapOtherPick.picked, candidate];
            if (isTapOtherSelectionComplete(manaTapOtherPick.spec, picked)) {
                submitManaTapOther(
                    manaTapOtherPick.sourceId,
                    manaTapOtherPick.abilityId,
                    picked
                );
                return;
            }
            setManaTapOtherPick({ ...manaTapOtherPick, picked });
            return;
        }

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
            // CR 109.1/.3/102.1/202/205/601.2c/613 / 701.26 / 702 (issue #1697) —
            // don't fire selectTarget for a permanent the shared target-filter
            // registry would reject (supertype/subtype/color/tapped/combat
            // role/keyword/power/toughness/mv/controller/sameController);
            // `useBattlefieldVisualState` already dims it, so firing the
            // doomed mutation just surfaces an error toast (#904).
            matchesPermanentTargetFilters(
                card,
                pendingTarget,
                allPlayers,
                activePlayerId,
                controlContinuity,
                emblems
            ) &&
            // CR 702.18 / 611 — don't fire selectTarget for a shrouded /
            // "can't be the target" permanent; the server would reject it
            // anyway (#382).
            !isUntargetableByPending(
                allPlayers,
                card,
                pendingTarget.cardInstanceId,
                pendingTarget.kind,
                // CR 405 — a triggered ability's source is an on-stack item.
                stackItems,
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
                const name = getDefinition(displayCardId(card)).name;
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
            // planeswalker. During the "Attack with all" destination sequence
            // (design 2026-07-23) the attacker is the one the cursor is on;
            // after retargeting, advance to the next attacker. Outside the
            // sequence, pick the most-recently declared attacker not already
            // attacking it (retargeting from the player or another
            // planeswalker); repeated clicks pile attackers onto the
            // planeswalker.
            const targets = combat?.attackTargets ?? {};
            const attackerId = attackSequence.active
                ? attackSequence.currentAttackerId
                : [...(combat?.attackerIds ?? [])]
                      .reverse()
                      .find((id) => targets[id] !== card.id);
            if (!attackerId) return;
            // The server treats a repeat `planeswalkerId` for an attacker
            // ALREADY on that planeswalker as a toggle-OFF (target reverts to
            // the defending player). Mid-sequence that would silently undo the
            // very choice the click expresses — reachable when the attacker was
            // manually pointed at this planeswalker before "Attack with all".
            // Confirming the existing target is a no-op mutation, then advance.
            const alreadyOnThisPw = targets[attackerId] === card.id;
            if (!alreadyOnThisPw) {
                guardMutation(
                    toggleAttacker({
                        gameId,
                        playerId,
                        cardInstanceId: attackerId,
                        planeswalkerId: card.id,
                    })
                );
            }
            if (attackSequence.active) attackSequence.advance();
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
            !hasManaAbility(card, manaGateView, allPlayers) &&
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
            } else if (isPayingCast) {
                // issue #1779 / PRD #1776 T4 — tapForPayment now takes a
                // `payments` batch; a single manual click still submits it as
                // a one-element array (no UX regression — Convex reactivity
                // still drives the "mana pool fills as you tap" feedback per
                // click, since we still fire one mutation per click here).
                guardMutation(
                    tapForPayment({
                        gameId,
                        playerId,
                        payments: [{ cardInstanceId: card.id }],
                    })
                );
            } else {
                const tapMutation = isPayingActivation
                    ? tapForActivationPayment
                    : tapForAttackTax;
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
            manaTapOtherPick ||
            (pendingChoices && pendingChoices.length > 0)
        ) {
            return [];
        }
        // CR 602.5b — viewer-visible state fed to each ability's `canActivate`
        // predicate so player/board-reading gates (Library of Alexandria's
        // seven-card hand, Pestilence's creature-present, Nettling Imp's
        // active-player check) evaluate correctly as a UI hint (#436). Server
        // validation against the full GameState remains authoritative.
        // CR 302.6 / 400.7 (issue #1824) — `controlContinuity` is what lets
        // the reducer pre-derive each permanent's `controlledSinceTurnStart`,
        // which `hasBattlefieldTargetCandidate` needs to answer "does this
        // targeting ability have ANY legal target" for Norritt / Arcum's
        // Whistle. Without it the dimension stays undefined and the gate fails
        // open, offering the ability on a board where every candidate entered
        // this turn — a dead menu entry the server then rejects.
        const stateView = abilityStateView();
        // CR 113.3c — on a permanent the viewer does NOT control, only
        // "any player may activate" / "opponents only" / "the enchanted
        // creature's controller may activate" abilities are offered, and only
        // while the viewer holds priority. Controller-only abilities and mana
        // abilities stay hidden there.
        //
        // The split is on the CARD's controller, not on which board renders it:
        // an attached permanent rides its HOST's board, so an Aura the viewer
        // controls on an opponent's creature is drawn on the opponent's side
        // (and an opponent's Aura on the viewer's creature on the viewer's
        // side). Keying off the board's `isMe` hid the viewer's own abilities on
        // the first, and offered the opponent's controller-only abilities on the
        // second — where clicking silently did nothing (Merseine).
        if (card.controllerId !== playerId) {
            if (!viewerHasPriority) return [];
            // CR 119.4 — the viewer (not the permanent's controller) pays a
            // non-controller ability's life cost, so gate on the viewer's life.
            return getAnyPlayerStackAbilities(
                card,
                phase,
                stateView,
                viewer.life,
                playerId
            );
        }
        if (!viewerHasPriority) {
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
            viewer.lastDrawnCardId !== undefined &&
            viewer.hand.some(
                (c) => c !== null && c.id === viewer.lastDrawnCardId
            );
        const stack = getStackAbilities(
            card,
            phase,
            canDiscardLastDrawn,
            stateView,
            // CR 119.4 — controller's own ability: the controller (the viewer on
            // this path, by the `card.controllerId` split above) pays the life
            // cost.
            viewer.life,
            // CR 602.1 / 118.3 — the `discardFilter` cost (Survival of the
            // Fittest) is always paid from the CONTROLLER's own hand; the
            // viewer IS the controller here, so this is the real (non-nulled)
            // hand.
            viewer.hand.filter((c): c is CardInstance => c !== null),
            playerId
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
        // CR 605.1a / 601.2f / 605.3c (issue #1179) — the mana ability that
        // must NOT be a silent left-click tap-for-mana (a cost-bearing one, or
        // one with no {T}/sacrifice component to tap through at all). Selecting
        // it routes through the colour picker, the tap-other picker, `tapUntap`
        // (tap) or `activateManaAbility` (non-tap) in `handleActivateAbility`,
        // so the cost is charged / the choice is resolved. Independent of the
        // plain `getActivatedManaMenuEntry` tap toggle below (free-to-activate,
        // no-mana-cost TAP mana sources). Repeatable, so always offered.
        //
        // The predicate — including its post-layer read and the CR 602.1 /
        // 118.8 `tapOtherFilter` affordability gate — lives in
        // `getManaCostMenuAbility` (`lib/card-utils.ts`), where the catalogue
        // affordability sweep can reach it; see that helper's doc comment.
        const manaCostAbility = getManaCostMenuAbility(card, stateView);
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
            if (!canRefundManaTap(card, viewer))
                return [...manaCostEntry, ...stack];
            return [
                { id: manaToggle.id, oracleText: "Untap and refund mana" },
                ...manaCostEntry,
                ...stack,
            ];
        }
        // CR 302.6 (issue #2021) — sickness withholds the mana entry only when
        // the activation actually pays a {T}. Tinder Wall ("Sacrifice this
        // creature: Add {R}{R}." next to its {R}-sacrifice damage ability) is
        // exactly the shape this menu exists for, and it is summoning sick the
        // turn it is cast.
        if (
            isTapLockedBySummoningSickness(card) &&
            manaActivationRequiresTap(card)
        )
            return [...manaCostEntry, ...stack];
        return [manaToggle, ...manaCostEntry, ...stack];
    }

    /** Fires a NON-stack mana ability with its FINISHED tap-other pick set
     *  (CR 602.1 / 605.3c, issue #2371). One mutation call carries both, so
     *  there is no window in which the cost is half-paid: `activateManaAbility`
     *  validates every pick before tapping any of them
     *  (`payTapOtherAbilityCost`, `convex/game.ts`) and a rejection leaves the
     *  board untouched. The parked pick clears first either way — a server
     *  rejection surfaces through `guardMutation`'s toast like every other
     *  doomed dispatch, and leaving the picker open on a stale board would
     *  strand the player in a modal click mode. */
    function submitManaTapOther(
        cardInstanceId: string,
        abilityId: string,
        picks: readonly TapOtherCandidate[]
    ) {
        setManaTapOtherPick(null);
        guardMutation(
            activateManaAbility({
                gameId,
                playerId,
                cardInstanceId,
                abilityId,
                tapOtherIds: picks.map((p) => p.id),
            })
        );
    }

    function handleActivateAbility(
        cardInstanceId: string,
        abilityId: string,
        keepPriority: boolean
    ) {
        // Scan EVERY battlefield, not just this board's: an attached permanent
        // is rendered on its HOST's board while it lives in its own
        // controller's `battlefield` array, so an Aura across the control
        // boundary (an opponent's Merseine on the viewer's creature) was not
        // found here and the click returned silently — no mutation, no error,
        // no feedback at all.
        const card = allPlayers
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === cardInstanceId);
        if (!card) return;
        // Issue #1735 — `def` here only ever feeds a DISPLAY name (the mode /
        // X-choice dialog's `cardName`, below); the ability lookup itself
        // stays on `getEffectiveClientAbilities(card)`, which reads the
        // honest `card.card.id`. `displayCardId` lets a face-down permanent
        // with a surviving GRANTED ability (layer 6 — the only way a
        // face-down permanent has an activated ability at all) show its
        // controller the real card's name rather than the vanilla sentinel's.
        const def = getDefinition(displayCardId(card));
        // POST-LAYER set (CR 113.1 / 611.2a, issue #1880) — the SAME effective
        // list `getActivatedManaMenuEntry` / `canRefundManaTap` /
        // `manaCostAbility` offer the entry from. Resolving against the PRINTED
        // `def.activatedAbilities` left a GRANTED mana ability's id unmatched:
        // `ability` was undefined, the `!ability.useStack` mana routing below
        // was skipped, and the click dispatched `activateAbility`, which throws
        // "Use tapUntap for mana abilities" server-side.
        const ability = getEffectiveClientAbilities(card).find(
            (a) => a.id === abilityId
        );
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
                // CR 602.1 / 118.8 (issue #2371) — "Tap an untapped artifact
                // you control" as this mana ability's own cost. The server
                // wants the WHOLE pick set up front (`tapOtherIds`), so the
                // picks are collected client-side first: auto-committed when
                // the board leaves no real choice, otherwise parked for the
                // player to click (the "auto-resolve a zero-branch choice"
                // convention every other picker follows).
                if (ability.cost.tapOtherFilter) {
                    const spec = ability.cost.tapOtherFilter;
                    // The SAME view `getManaCostMenuAbility` gated the menu
                    // entry on — see `abilityStateView`.
                    const candidates = tapOtherCostCandidates(
                        spec,
                        card.id,
                        playerId,
                        abilityStateView()
                    );
                    // CR 602.5b — unpayable cost, unactivatable ability. The
                    // menu gate (`getManaCostMenuAbility`) already withholds
                    // the entry; this is the belt to its braces, never a
                    // doomed dispatch.
                    if (!canPayTapOtherCost(spec, candidates)) return;
                    if (isTapOtherPickForced(spec, candidates)) {
                        submitManaTapOther(card.id, abilityId, candidates);
                        return;
                    }
                    setManaTapOtherPick({
                        sourceId: card.id,
                        abilityId,
                        spec,
                        candidates,
                        picked: [],
                    });
                    return;
                }
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
        // CR 700.2 / 601.2b — the mode comes FIRST, before X and before
        // targets: only the chosen mode's target requirement is declared
        // (CR 700.2d), and the server rejects an activation of a modal
        // ability with no `chosenModeId`.
        if (ability?.modes && ability.modes.length > 0) {
            setAbilityModeChoiceState({
                cardInstanceId,
                abilityId,
                cardName: def.name,
                modes: ability.modes,
                keepPriority,
            });
            return;
        }
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
        // A second activation fired inside the first one's round trip is a
        // doomed dispatch ("Another ability is already being activated") — the
        // menu gate above (`getActivatable`) can only see server state that has
        // already arrived. NOT applied to the mana / payment mutations below:
        // tapping several sources toward one cost is a legitimate burst of
        // concurrent dispatches.
        if (hasPendingGameIntent()) return;
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
            {manaTapOtherPick && (
                <ManaTapOtherBanner
                    pick={manaTapOtherPick}
                    source={player.battlefield.find(
                        (c) => c.id === manaTapOtherPick.sourceId
                    )}
                    onCancel={() => setManaTapOtherPick(null)}
                />
            )}
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
                            if (isPayingCast) {
                                // issue #1779 / PRD #1776 T4 — batched shape.
                                guardMutation(
                                    tapForPayment({
                                        gameId,
                                        playerId,
                                        payments: [
                                            {
                                                cardInstanceId:
                                                    manaChoiceState.cardId,
                                                manaChoiceIndex: index,
                                            },
                                        ],
                                    })
                                );
                            } else {
                                const mutation = isPayingActivation
                                    ? tapForActivationPayment
                                    : tapForAttackTax;
                                guardMutation(mutation(args));
                            }
                        } else {
                            guardMutation(tapUntap(args));
                        }
                        setManaChoiceState(null);
                    }}
                    onCancel={() => setManaChoiceState(null)}
                />
            )}
            {abilityModeChoiceState && (
                <ModePicker
                    modes={abilityModeChoiceState.modes}
                    cardName={abilityModeChoiceState.cardName}
                    onSelect={(modeId) => {
                        const s = abilityModeChoiceState;
                        setAbilityModeChoiceState(null);
                        guardMutation(
                            activateAbility({
                                gameId,
                                playerId,
                                cardInstanceId: s.cardInstanceId,
                                abilityId: s.abilityId,
                                keepPriority: s.keepPriority || undefined,
                                chosenX: undefined,
                                chosenModeId: modeId,
                            })
                        );
                    }}
                    onCancel={() => setAbilityModeChoiceState(null)}
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
    // a sacrifice cost (Fireblast's two Mountains), an exile additional cost, an
    // activated-ability tap-other cost, or a NON-stack mana ability's tap-other
    // cost (Urza, Lord High Artificer). When true the board must UN-STACK
    // identical permanents (like the divide-target case) so each candidate gets
    // its own slot and its selection ring is visible — a selected card can't read
    // as "picked" while buried in a fan of identical copies.
    //
    // `manaTapOtherPick` is the one member that is CLIENT-LOCAL state (every
    // other picker is server-parked, so opening it also changes `player`, which
    // re-renders the board's card nodes). `board-battlefield.tsx` bakes each
    // card's `getVisualState` / `getActivatable` result into a memoised node
    // keyed partly on this flag, so omitting it left the whole board frozen on
    // its pre-picker nodes: no candidate ring, and every candidate keeping the
    // ability-menu click binding it had before the picker opened (issue #2371
    // follow-up — clicking the artifact opened ITS menu instead of paying).
    const isSelectingOnThisBoard =
        isSelectingChoice ||
        isPickingSacrifice ||
        isPickingAdditionalCost ||
        isPickingActivationCost ||
        !!manaTapOtherPick;

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
