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
    getManaChoices,
    getActivatedManaMenuEntry,
    canRefundManaTap,
    getStackAbilities,
    getAnyPlayerStackAbilities,
    buildTriggerStateView,
    wantsPermanentTarget,
    matchesTargetRequirement,
    matchesTargetController,
    isTapLockedBySummoningSickness,
} from "~/lib/card-utils";
import { isUntargetableByPending } from "~/lib/targeting";
import { outstandingDamageAssigner } from "~/lib/priority";
import { extractMutationError, type MutationError } from "~/lib/mutation-error";
import type { ActivatableAbility } from "~/components/board/battlefield-card";
import ManaChoicePicker from "~/components/board/mana-choice-picker";
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
    const selectAdditionalCost = useMutation(api.game.selectAdditionalCost);
    const selectActivationCost = useMutation(api.game.selectActivationCost);
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
    const [manaChoiceState, setManaChoiceState] = useState<{
        cardId: string;
        choices: ManaCost[];
        position?: { x: number; y: number };
        inPayment: boolean;
    } | null>(null);

    const [validationError, setValidationError] =
        useState<MutationError | null>(null);

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

    const isInPayment = isPayingCast || isPayingActivation;

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

    // Additional-cost picker (CR 117.9 / 601.2f). Active when this player's
    // pendingCast is waiting for them to pick a permanent on their own
    // battlefield. Routes clicks to selectAdditionalCost.
    const isPickingAdditionalCost =
        isMe &&
        !!pendingCast &&
        pendingCast.playerId === playerId &&
        !!pendingCast.additionalCost &&
        !pendingCast.additionalCost.pickedId;

    // Activated-ability non-mana cost picker: "sacrifice a permanent matching
    // <filter>" (CR 602.1 / 118.5) OR "tap N untapped permanents matching
    // <filter>" (CR 602.1 / 118.8, Hand of Justice). Active when this
    // player's pendingActivation is waiting for them to pick a permanent.
    // Routes clicks to selectActivationCost (which handles both cost shapes
    // server-side — one call per picked permanent). Eligibility itself is
    // enforced by `canInteract` (shared visual-state hook, #939); this flag
    // only decides whether a click routes here at all.
    const isPickingActivationCost =
        isMe &&
        !!pendingActivation &&
        pendingActivation.playerId === playerId &&
        ((!!pendingActivation.sacrificeChoice &&
            !pendingActivation.sacrificeChoice.pickedId) ||
            (!!pendingActivation.tapOtherChoice &&
                pendingActivation.tapOtherChoice.pickedIds.length <
                    pendingActivation.tapOtherChoice.count));

    const isSelectingAttackers =
        phase === "DECLARE_ATTACKERS" &&
        !!combat &&
        !combat.confirmed &&
        isMe &&
        playerId === activePlayerId;

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
            matchesTargetRequirement(card, pendingTarget.targetType) &&
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
        const stateView = buildTriggerStateView(allPlayers, activePlayerId);
        // CR 113.3c — on an OPPONENT's permanent, the viewer may only activate
        // "any player may activate" abilities, and only while holding priority.
        // Controller-only abilities and mana abilities stay hidden there.
        if (!isMe) {
            if (!viewerHasPriority) return [];
            return getAnyPlayerStackAbilities(card, phase, stateView);
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
            stateView
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
        // CR 605.1a / 605.3c — a NON-tap mana ability whose cost is mana
        // (Farrelite Priest "{1}: Add {W}") is not a tap toggle: a plain click
        // can't activate it, so surface it as an explicit menu entry routed to
        // `activateManaAbility`. Independent of `stack`/`getActivatedManaMenuEntry`
        // (which only handle tap mana abilities). Repeatable, so always offered.
        const nonTapMana = getDefinition(card.card.id).activatedAbilities?.find(
            (a) => !a.useStack && !a.cost.tap && !!a.cost.mana && a.oracleText
        );
        const nonTapManaEntry: ActivatableAbility[] = nonTapMana
            ? [{ id: nonTapMana.id, oracleText: nonTapMana.oracleText }]
            : [];
        if (stack.length === 0) return nonTapManaEntry;
        const mana = getActivatedManaMenuEntry(card);
        if (!mana) return [...nonTapManaEntry, ...stack];
        if (card.isTapped) {
            if (!canRefundManaTap(card, player.manaPool))
                return [...nonTapManaEntry, ...stack];
            return [
                { id: mana.id, oracleText: "Untap and refund mana" },
                ...nonTapManaEntry,
                ...stack,
            ];
        }
        if (isTapLockedBySummoningSickness(card))
            return [...nonTapManaEntry, ...stack];
        return [mana, ...nonTapManaEntry, ...stack];
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
            // CR 605.1a / 605.3c — a NON-tap mana ability whose cost is mana
            // (Farrelite Priest "{1}: Add {W}") is not a tap toggle: it pays a
            // mana cost, resolves immediately, and may carry a side effect.
            // Route it to `activateManaAbility` rather than `tapUntap`.
            if (!ability.cost.tap && ability.cost.mana) {
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
            <ErrorToast
                error={validationError}
                gameId={gameId}
                onDismiss={() => setValidationError(null)}
            />
        </>
    );

    return {
        getVisualState,
        canInteract,
        handleClick,
        handleClickWithEvent,
        getActivatable,
        handleActivateAbility,
        overlays,
    };
}
