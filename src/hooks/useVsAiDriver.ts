// Client driver for the vs-AI Bot (ADR 0001, issues #109/#110/#113).
//
// Watches the game FROM THE BOT'S OWN VIEWPOINT (a `getPublicState` query keyed
// to the bot seat, so the bot's hand is visible and the human's stays hidden —
// criterion 5), and whenever the bot owes an action it consults the Brain (in a
// Web Worker) for a chosen move and replays it through existing mutations.
// Mirrors the auto-pass controller's shape: a short debounce, an in-flight
// guard, and a per-state-version signature so the same state never drives twice.
// The UI thread is never blocked — enumeration + selection live in the Worker,
// and submission is a normal async mutation sequence.
//
// Tick-gated subscription (PRD #1776 T3, issue #1778): holding a second full
// `getPublicState` subscription (3-9 KB) alongside the human seat's own meant
// every write to `gameStates` cost two query re-executions, and the bot's copy
// was discarded on every beat it didn't own. The driver instead subscribes to
// the cheap `getGameTick` row (~150 bytes) and only mounts `getPublicState`
// once `owedPlayerIds` NAMES the bot's own seat — i.e. the bot actually owes
// input (priority, or a pending choice/target/combat-damage-assignment
// addressed to it). The in-flight guard and per-state-version signature key
// off the TICK's `seq`, not the projected state's — and the decision logic
// below waits for `botState.seq` to catch up to `tick.seq` before acting — so
// a `getPublicState` subscription that mounts fresh (returning a momentarily
// stale cached value) across the tick-driven mount/unmount cycle can never
// drive the same tick twice, nor act on a state the tick has already
// superseded.
//
// `owedPlayerIds` is an ARRAY, not a single id (issue #1778 review finding
// 1): the CR 510.1c/702.21j-k combat-damage-assignment sub-flow (2+ blockers
// on one attacker, or banding shifting assignment to the defending player)
// folds into a plain `{kind:"priority"}` window gated `anyPlayer: true`
// (`setDamageAssignment`/`confirmDamage`, `convex/game.ts`) — the real actor
// is NOT `priorityPlayerId` there (COMBAT_DAMAGE/FIRST_STRIKE_DAMAGE entry
// sets `priorityPlayerId = activePlayerId` regardless of who assigns), and
// banding can even split authority so both players independently owe a
// confirmation. Gating on `expectedInputPlayerId === botId` (the old shape)
// never named a non-active assigner and deadlocked the game forever. The
// driver MUST gate on membership (`owedPlayerIds.includes(botId)`), never
// equality with a single id — see `computeOwedPlayerIds`
// (`convex/gre/expectedInput.ts`).
//
// No-tick fail-open (issue #1778 review finding 4): a vs-AI game already in
// progress when this feature deploys has no `gameTicks` row yet (the table
// didn't exist when it was created/last saved) — `tick` resolves to `null`,
// not `undefined`. Treat that as "unknown, might owe input" and mount the
// full state rather than staying silent forever: `saveGameState` writes a
// `gameTicks` row on EVERY mutation (including the human's very next action),
// so this is a one-tick transient on old games, never a standing cost, and
// it trades a single spurious `getPublicState` mount for never deadlocking a
// pre-existing game at deploy time.
//
// Responsiveness gate (issue #113): before paying for a Worker round-trip + the
// bounded-time search, a cheap pure `shouldThink` check decides whether the
// window is worth searching at all. On a trivial priority pass it short-circuits
// to an IMMEDIATE `passPriority` (no Worker, no think beat, no "thinking"
// indicator), so routine passes never stall the game. When it does search, the
// hook exposes `thinking` so the board can show a "thinking" indicator that
// clears the moment the bot acts.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { shouldThink, budgetFor } from "@convex/gre";
import { consultBrain } from "~/lib/ai/brain-client";
import { setLatestAiTrace } from "~/lib/ai/trace-store";
import {
    decideBotAction,
    botActionRealisation,
    chooseOwedChoiceAction,
} from "~/lib/ai/brain";
import { buildBotView, botActionToMove } from "~/lib/ai/bot-view";
import { executeMove, type MoveMutations } from "~/lib/ai/executor";
import {
    submitOwedPayment,
    type OwedPaymentMutations,
} from "~/lib/ai/pay-owed-payment";
import { projectedToGameState } from "~/lib/ai/state-adapter";
import { getStoredDifficulty } from "~/lib/session";

/** A small visible "thinking" beat before the bot acts, so the game does not
 *  feel like it is skipping the opponent's turn instantly. */
const THINK_DELAY_MS = 200;

/** What the driver hook reports back to the UI. */
export type VsAiDriverStatus = {
    /** True while the bot is searching for a move (a worthwhile window). Clears
     *  the moment it submits. Trivial immediate passes never set it. */
    thinking: boolean;
};

export function useVsAiDriver(
    gameId: Id<"games">,
    botId: string | null
): VsAiDriverStatus {
    // Cheap wake-up signal (issue #1778): mount the fat `getPublicState`
    // subscription only once the tick says the bot's own seat owes input.
    // Gate on MEMBERSHIP in `owedPlayerIds`, not equality with a single id —
    // see the module comment (review finding 1). `tick === null` (a settled
    // query that found no row, as opposed to `undefined` while still
    // loading) fails OPEN — mount the state rather than risk a permanent
    // deadlock on a game that predates this feature (finding 4).
    const tick = useQuery(api.game.getGameTick, botId ? { gameId } : "skip");
    const botOwesInput = !!(
        botId &&
        (tick === null ||
            (tick && !tick.gameOver && tick.owedPlayerIds?.includes(botId)))
    );
    const botState = useQuery(
        api.game.getPublicState,
        botId && botOwesInput ? { gameId, playerId: botId } : "skip"
    );
    // The bot's OWN decklist, wired into the search adapter so its simulated
    // library carries real card identities (issue #1509): fetch/tutor subtrees
    // then search the real fetchable cards instead of worthless placeholders.
    // Own-deck content is public knowledge to its owner (only the ORDER is
    // hidden — `determinize` reshuffles it), so reading it here is legitimate;
    // in a vs-AI game both seats belong to the same user regardless.
    const game = useQuery(api.game.getGame, { gameId });
    const ownDeck = useMemo(() => {
        if (!botId || !game) return undefined;
        const seat = game.players.find((p) => p.id === botId);
        if (!seat) return undefined;
        return {
            playerId: botId,
            cardIds: seat.deck.cards.map((c) => c.cardId),
        };
    }, [game, botId]);
    const [thinking, setThinking] = useState(false);

    const mutations: MoveMutations = {
        playCard: useMutation(api.game.playCard),
        summonCompanion: useMutation(api.game.summonCompanion),
        announceCast: useMutation(api.game.announceCast),
        selectTarget: useMutation(api.game.selectTarget),
        // issue #1779 / PRD #1776 T4 — batched target selection: the bot
        // already knows the whole target set upfront (search picks it before
        // dispatch), so the executor drives this instead of looping
        // `selectTarget`.
        selectTargets: useMutation(api.game.selectTargets),
        confirmTargets: useMutation(api.game.confirmTargets),
        tapForPayment: useMutation(api.game.tapForPayment),
        activateAbility: useMutation(api.game.activateAbility),
        tapForActivationPayment: useMutation(api.game.tapForActivationPayment),
        selectSacrifice: useMutation(api.game.selectSacrifice),
        // CR 602.1 / 118 — the deferred activation-cost pickers. Unlike the
        // attack-tax / mana-spend pickers below these ARE Move-realised: the
        // picks travel on the `activate-ability` Move (`costPicks`), so they
        // belong in `MoveMutations` and are submitted by `executeMove`.
        selectActivationCost: useMutation(api.game.selectActivationCost),
        selectActivationExileCost: useMutation(
            api.game.selectActivationExileCost
        ),
        selectActivationDiscardCost: useMutation(
            api.game.selectActivationDiscardCost
        ),
        toggleAttacker: useMutation(api.game.toggleAttacker),
        confirmAttackers: useMutation(api.game.confirmAttackers),
        selectBlocker: useMutation(api.game.selectBlocker),
        assignBlockerTarget: useMutation(api.game.assignBlockerTarget),
        confirmBlockers: useMutation(api.game.confirmBlockers),
        confirmDamage: useMutation(api.game.confirmDamage),
        declareMulligan: useMutation(api.game.declareMulligan),
        submitResolutionChoice: useMutation(api.game.submitResolutionChoice),
        submitMayPay: useMutation(api.game.submitMayPay),
        submitLandEntryChoice: useMutation(api.game.submitLandEntryChoice),
        submitDrawReplacementPay: useMutation(
            api.game.submitDrawReplacementPay
        ),
        submitMadnessDecline: useMutation(api.game.submitMadnessDecline),
        submitReboundDecline: useMutation(api.game.submitReboundDecline),
        submitNameCard: useMutation(api.game.submitNameCard),
        submitRandomRevealAck: useMutation(api.game.submitRandomRevealAck),
        passPriority: useMutation(api.game.passPriority),
    };

    // CR 508.1c/1g — the parked mana attack tax mutations. Kept OUT of the
    // `MoveMutations` object (they aren't Move-realised) and driven directly,
    // like `confirmDamage`.
    const autoTapForAttackTax = useMutation(api.game.autoTapForAttackTax);
    const cancelAttackTax = useMutation(api.game.cancelAttackTax);
    // CR 601.2g (issue #1446) — the parked generic-spend choice mutation. Kept
    // OUT of `MoveMutations` for the same reason: it isn't Move-realised, it
    // lives outside `pendingChoices[]`, and is driven directly.
    const resolveManaSpendChoice = useMutation(api.game.resolveManaSpendChoice);
    // CR 601.2g / 702.66 (issue #1336) — the parked cast-cost graveyard exile
    // picker (delve's variable offset; the fixed flashback / escape exile
    // costs). Kept OUT of `MoveMutations` for the same reason as the two above:
    // it hangs off `pendingCast`, not `pendingChoices[]`, so it is not
    // Move-realised and is driven directly.
    const selectCastExileCost = useMutation(api.game.selectCastExileCost);
    // CR 702.51 (issue #1338) — the parked Convoke creature picker (Hogaak).
    // Kept OUT of `MoveMutations` for the same reason: it hangs off
    // `pendingCast`, not `pendingChoices[]`, so it is driven directly.
    const selectConvokeCreatures = useMutation(api.game.selectConvokeCreatures);
    // ADR 0091 / issue #1209 — the remaining CAST-side payment pickers. Like the
    // three above they hang off `pendingCast`, are not Move-realised, and are
    // driven directly — through the generic `pay-owed-payment` branch rather
    // than a per-park branch of their own.
    const selectAdditionalCost = useMutation(api.game.selectAdditionalCost);
    const selectCastAlternativeHandCost = useMutation(
        api.game.selectCastAlternativeHandCost
    );

    // ADR 0091 / issue #1209 — the mutation set the generic `pay-owed-payment`
    // branch dispatches into. Assembled from handles already declared above
    // (`MoveMutations` carries the activation-side pickers because those travel
    // on the Move) plus the cast-side ones; the switch that consumes it
    // (`submitOwedPayment`) is exhaustive over the submission union.
    const owedPaymentMutations: OwedPaymentMutations = {
        selectSacrifice: mutations.selectSacrifice,
        selectAdditionalCost,
        selectConvokeCreatures,
        selectCastExileCost,
        selectCastAlternativeHandCost,
        selectActivationCost: mutations.selectActivationCost,
        selectActivationExileCost: mutations.selectActivationExileCost,
        selectActivationDiscardCost: mutations.selectActivationDiscardCost,
        resolveManaSpendChoice,
    };

    const inFlight = useRef(false);
    const lastSignature = useRef<string | null>(null);
    const lastGameId = useRef<Id<"games"> | null>(null);

    useEffect(() => {
        if (!botId || !botState) return;
        // `tick === undefined` means the cheap query is still loading — never
        // drive off a `botState` that mounted ahead of its own gate. `tick
        // === null` (no `gameTicks` row exists yet, finding 4) is different:
        // `botOwesInput` already failed OPEN to mount `botState`, so fall
        // through and act directly off it below.
        if (tick === undefined) return;

        // The tick (cheap) can race ahead of the fuller `getPublicState`
        // subscription (fat) it just caused to mount — a freshly-mounted
        // query briefly serves a cached/stale value before catching up. Wait
        // for `botState` to actually reach the tick that triggered this
        // window before acting on it; otherwise the driver could decide off
        // a state the tick has already superseded (issue #1778). No tick row
        // yet (`null`, finding 4) has nothing to race against — proceed.
        if (tick && botState.seq !== tick.seq) return;

        // A new game (Restart Solo / rematch / Switch Game) swaps the `gameId`
        // prop WITHOUT remounting this hook, because `game.route` renders the
        // board unkeyed. The per-game dedupe guards must be reset on the swap,
        // otherwise the prior game's recorded signature — at the SAME low seq
        // the opening mulligan always lands on — collides with the new game's
        // mulligan window and the bot's keep/mull declaration is silently
        // suppressed (the reported freeze, "fixed" only by a page refresh that
        // remounts the hook). A stuck `inFlight` from a search the prior game
        // never settled would block it the same way, so clear both.
        if (lastGameId.current !== gameId) {
            lastGameId.current = gameId;
            lastSignature.current = null;
            inFlight.current = false;
        }

        // Cheap main-thread gate: only consult the Worker when the bot actually
        // owes an action in this window.
        const view = buildBotView(botState, botId);
        const action = decideBotAction(view);
        if (action.kind === "none") return;

        // De-dupe by TICK version, not the projected state's own `seq` (issue
        // #1778): the tick is what gates the mount/unmount cycle, so it — not
        // `botState.seq`, which the guard above already confirmed matches
        // anyway — is the authoritative "have I already acted on this state"
        // signature. Unlike the pass-only bot, the bot may take several
        // actions in one priority window (play a land, then cast, then pass)
        // — each bumps the seq, so keying on seq lets the next action fire
        // while still guarding against double-submitting the same state.
        // Falls back to `botState.seq` when there is no tick row yet
        // (finding 4) — the very first save this action produces creates the
        // row, so every subsequent render is back on the tick's own `seq`.
        const signature = `${gameId}:${tick ? tick.seq : botState.seq}`;
        if (lastSignature.current === signature) return;

        // Combat-damage confirmation (CR 510.1c, multi-block): the gate already
        // decided the bot owes a `confirmDamage`, so realise it directly — no
        // Worker, no search. The engine pre-fills the default assignment on step
        // entry, so confirming is enough. Without this the bot would `pass` and
        // the server would reject it ("Must assign combat damage…") forever.
        // A realisation is ATOMIC (ADR 0091 decision 6, issue #1209). `inFlight`
        // used to be written ONLY by the Worker branch at the bottom, while every
        // direct-mutation branch and the executor branch merely READ it — so each
        // mutation in a multi-step realisation bumped the state seq, re-fired this
        // reactive effect, and let a second decision interleave into a half-built
        // announcement. It worked only because the interleaving decision happened
        // to be the right one; two parks in one sequence (crew + mana spend) had
        // no defined ordering at all. Every branch below now runs through this
        // helper, which holds the guard for the WHOLE sequence.
        const dispatch = (run: () => Promise<unknown>) => {
            if (inFlight.current) return;
            inFlight.current = true;
            lastSignature.current = signature;
            void run()
                .catch(() => {
                    // Stale/illegal submissions are rejected server-side; allow
                    // the next state change to re-drive this state.
                    lastSignature.current = null;
                })
                .finally(() => {
                    inFlight.current = false;
                });
        };

        if (action.kind === "confirm-combat-damage") {
            dispatch(() =>
                mutations.confirmDamage({ gameId, playerId: botId })
            );
            return;
        }

        // CR 508.1c/1g — the parked mana attack tax (Propaganda / Collective
        // Restraint): the gate decided the bot owes a direct pay/cancel, so
        // realise it straight through (no Worker, no search), mirroring the
        // damage-confirmation short-circuit above.
        if (botActionRealisation(action.kind) === "attack-tax") {
            const mutation =
                action.kind === "pay-attack-tax"
                    ? autoTapForAttackTax
                    : cancelAttackTax;
            dispatch(() => mutation({ gameId, playerId: botId }));
            return;
        }

        // CR 601.2g (issue #1446) — the parked generic-spend choice: the gate
        // already picked a deterministic flexibility-preserving `spendOrder`
        // (`chooseManaSpendOrder`), so realise it straight through (no Worker,
        // no search), mirroring the attack-tax short-circuit above.
        if (
            botActionRealisation(action.kind) === "mana-spend" &&
            action.kind === "resolve-mana-spend"
        ) {
            dispatch(() =>
                resolveManaSpendChoice({
                    gameId,
                    playerId: botId,
                    spendOrder: action.spendOrder,
                })
            );
            return;
        }

        // CR 601.2g / 702.66 (issue #1336) — the parked cast-cost graveyard
        // exile pick: the gate already chose the exact ids
        // (`chooseCastExileCost`), so realise it straight through, mirroring
        // the mana-spend short-circuit above. Without this branch the bot parks
        // its own delve cast and never finishes it (the recurring "bot freezes
        // on a new choice mechanic" class).
        if (
            botActionRealisation(action.kind) === "cast-exile-cost" &&
            action.kind === "cast-exile-cost"
        ) {
            dispatch(() =>
                selectCastExileCost({
                    gameId,
                    playerId: botId,
                    cardInstanceIds: action.cardInstanceIds,
                })
            );
            return;
        }

        // CR 702.51 (issue #1338) — the parked Convoke creature pick: the gate
        // already chose a legal covering set (`chooseConvokeCreatures`), so
        // realise it straight through, mirroring the cast-exile-cost branch
        // above. Without it the bot parks its own Hogaak cast and never finishes.
        if (
            botActionRealisation(action.kind) === "convoke-creatures" &&
            action.kind === "convoke-creatures"
        ) {
            dispatch(() =>
                selectConvokeCreatures({
                    gameId,
                    playerId: botId,
                    creatureInstanceIds: action.creatureInstanceIds,
                })
            );
            return;
        }

        // ADR 0091 / issue #1209 — EVERY OTHER payment park. The submission was
        // already computed by the shared conservative pick (`pickForOwedPayment`,
        // reached through `buildBotView`), so this branch only dispatches it to
        // the human mutation it names, one pick per call. It is generic on
        // purpose: a park added to the census in `convex/gre/owedPayment.ts`
        // becomes non-stalling here with NO new driver wiring — the nine
        // one-park-at-a-time fixes this replaces each had to add a branch.
        if (
            botActionRealisation(action.kind) === "owed-payment" &&
            action.kind === "pay-owed-payment"
        ) {
            const { submission } = action;
            dispatch(() =>
                submitOwedPayment(
                    submission,
                    { gameId, playerId: botId },
                    owedPaymentMutations
                )
            );
            return;
        }

        // Brain-resolved windows skip the Worker entirely and realise straight
        // through the executor (mirroring the immediate-pass short-circuit):
        // mulligan keep / mull / bottom-N (issue #145, ISMCTS mulligan eval out
        // of scope) and the mid-resolution interactive choices the search does
        // NOT cover (ADR 0016 heuristic defaults). A choice kind WITH a
        // registered candidate generator is decided as `search-choice` by the
        // gate and takes the Worker branch below instead (PRD #1423 /
        // issue #1506). The set of executor-realised kinds is derived from the
        // compile-time-exhaustive `botActionRealisation` (NOT a hand-maintained
        // list): a new choice mechanic that adds a BotAction kind is a build
        // error until classified, so it can never silently fall through to the
        // Worker and freeze the bot (the recurring class this closes).
        if (botActionRealisation(action.kind) === "executor") {
            if (inFlight.current) return;
            const move = botActionToMove(action, botState, botId);
            if (!move) return;
            dispatch(() => executeMove(move, { gameId, botId, mutations }));
            return;
        }

        // Responsiveness gate (issue #113): a trivial priority pass skips the
        // Worker, the think beat and the "thinking" indicator entirely — the bot
        // passes immediately through the existing pass-priority path so routine
        // passes never stall the game. Only the `pass` window is eligible;
        // mulligan / combat declarations are always real decisions and search.
        if (
            action.kind === "pass" &&
            !shouldThink(projectedToGameState(botState), botId)
        ) {
            dispatch(() => mutations.passPriority({ gameId, playerId: botId }));
            return;
        }

        const timer = window.setTimeout(() => {
            if (inFlight.current) return;
            inFlight.current = true;
            lastSignature.current = signature;
            setThinking(true);
            // Difficulty-scaled search budget (issue #114): the player's chosen
            // preset (persisted in localStorage) maps to the search budget. The
            // server move path is untouched — this only tunes how hard the
            // client-side brain thinks.
            const budget = budgetFor(getStoredDifficulty());
            void consultBrain(botState, botId, budget, ownDeck)
                .then(({ move, trace }) => {
                    // Surface the reasoning to the Debug panel (client-only).
                    setLatestAiTrace(trace);
                    // Safety net for a searched pending choice (issue #1506): a
                    // choice window suppresses EVERY other move, so if the
                    // search surfaced none (a generator that self-pruned to
                    // nothing in the real world, a stale view) the bot would sit
                    // on the frozen priority forever. Fall back to the ADR 0016
                    // minimal-legal answer — the same one the pre-#1506 driver
                    // always gave — rather than stall.
                    const chosen =
                        move ??
                        (action.kind === "search-choice" && view.owedChoice
                            ? botActionToMove(
                                  chooseOwedChoiceAction(view.owedChoice),
                                  botState,
                                  botId
                              )
                            : null);
                    return chosen
                        ? executeMove(chosen, { gameId, botId, mutations })
                        : undefined;
                })
                .catch(() => {
                    // Stale/illegal submissions are rejected server-side; the
                    // next state change re-drives. Allow a retry of this state.
                    lastSignature.current = null;
                })
                .finally(() => {
                    inFlight.current = false;
                    setThinking(false);
                });
        }, THINK_DELAY_MS);

        return () => window.clearTimeout(timer);
        // `mutations` is rebuilt each render but its callables are stable; depend
        // on the state version (tick + the state it gates) and bot id only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId, botId, tick, botState, ownDeck]);

    return { thinking };
}
