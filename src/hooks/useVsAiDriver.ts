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
// ── LIVENESS INVARIANT (issue #2284) ────────────────────────────────────────
//
// **If the engine's Expected Input names the bot as the player being waited on,
// the game state advances within a bounded time.** The driver owns that
// invariant, because the play bot is client-hosted by design (ADR 0074) and runs
// inside the human's own session.
//
// Three mechanisms uphold it, and none of them is a per-container safety net —
// those were tried nine times, one park at a time, and a new container kept
// appearing:
//
//  1. **Owed-ness is the engine's answer.** `BotView.owedInput` is
//     `computeOwedPlayerIds` + `computeExpectedInput` (ADR 0047) run on the
//     bot's own reconstructed state. The bot no longer derives owed-ness from a
//     parallel walk over the pending* fields, so "the game is waiting on the
//     bot" and "the bot thinks it owes something" are ONE answer that cannot
//     disagree. A window the bot cannot answer returns `unanswered`, not
//     `none` — the distinction that made every past freeze silent.
//  2. **A watchdog escalates rather than waits.** While the Expected Input names
//     the bot and the STATE VERSION HAS NOT CHANGED, `BOT_WATCHDOG_MS`
//     (comfortably above the hardest search budget, so a slow think is never
//     mistaken for a hang) later the ladder fires — and fires again, one rung
//     per interval, until the version does change. "The state version changed"
//     is the only honest liveness signal: a dispatch that was *started*, or even
//     a mutation that *resolved*, proves nothing (see the watchdog effect). An
//     `unanswered` / "nothing owed while owed" decision is a DEFECT and
//     escalates immediately instead of burning the interval.
//  3. **Every rung is legal and every rung is loud.** `escalationLadder`
//     (`src/lib/ai/owed-input.ts`) is deterministic, exhaustive over the
//     Expected Input kind union, and made only of declines the CR already
//     defines for that window, routed through existing mutations. Rung 5 is a
//     user-visible, actionable state — never a silent no-op.
//
// A thrown submission no longer latches the loop: the in-flight guard is
// cleared, the state re-read, the submission retried within
// `BOT_SUBMIT_RETRY_LIMIT`, and then the ladder takes over.
//
// ── Tick-gated subscription (PRD #1776 T3, issue #1778) ─────────────────────
//
// Holding a second full `getPublicState` subscription (3-9 KB) alongside the
// human seat's own meant every write to `gameStates` cost two query
// re-executions, and the bot's copy was discarded on every beat it didn't own.
// The driver instead subscribes to the cheap `getGameTick` row (~150 bytes) and
// only mounts `getPublicState` once `owedPlayerIds` NAMES the bot's own seat.
// The in-flight guard and per-state-version signature key off the TICK's `seq`,
// not the projected state's — and the decision logic below waits for
// `botState.seq` to catch up to `tick.seq` before acting — so a
// `getPublicState` subscription that mounts fresh (returning a momentarily stale
// cached value) across the tick-driven mount/unmount cycle can never drive the
// same tick twice, nor act on a state the tick has already superseded.
//
// `owedPlayerIds` is an ARRAY, not a single id (issue #1778 review finding 1):
// the CR 510.1c/702.22j-k combat-damage-assignment sub-flow folds into a plain
// `{kind:"priority"}` window gated `anyPlayer: true`, where the real actor is
// NOT `priorityPlayerId`, and banding can even split authority so both players
// independently owe a confirmation. The driver MUST gate on membership, never on
// equality with a single id — see `computeOwedPlayerIds`
// (`convex/gre/expectedInput.ts`).
//
// No-tick fail-open (issue #1778 review finding 4): a vs-AI game already in
// progress when this feature deploys has no `gameTicks` row yet — `tick`
// resolves to `null`, not `undefined`. Treat that as "unknown, might owe input"
// and mount the full state rather than staying silent forever.
//
// Responsiveness gate (issue #113): before paying for a Worker round-trip + the
// bounded-time search, a cheap pure `shouldThink` check decides whether the
// window is worth searching at all. On a trivial priority pass it short-circuits
// to an IMMEDIATE `passPriority` (no Worker, no think beat, no "thinking"
// indicator), so routine passes never stall the game. When it does search, the
// hook exposes `thinking` so the board can show a "thinking" indicator that
// clears the moment the bot acts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ExpectedInputKind } from "@convex/gre/expectedInput";
import { shouldThink, budgetFor } from "@convex/gre";
import { consultBrain } from "~/lib/ai/brain-client";
import {
    recordAiDecision,
    recordAiEscalation,
    setLatestAiTrace,
} from "~/lib/ai/trace-store";
import type { AiDecisionOutcome } from "~/lib/ai/trace-store";
import {
    decideBotAction,
    botActionRealisation,
    chooseOwedChoiceAction,
    chooseOwedTargetAction,
    type BotView,
} from "~/lib/ai/brain";
import { escalationLadder } from "~/lib/ai/owed-input";
import { buildBotView, botActionToMove } from "~/lib/ai/bot-view";
import { executeMove, type MoveMutations } from "~/lib/ai/executor";
import type { OwedPaymentMutations } from "~/lib/ai/pay-owed-payment";
import type { DeclineMutations } from "~/lib/ai/decline";
import {
    realiseBotAction,
    type DirectMutations,
    type RealisationContext,
} from "~/lib/ai/realise";
import { projectedToGameState } from "~/lib/ai/state-adapter";
import { getStoredDifficulty } from "~/lib/session";

/** A small visible "thinking" beat before the bot acts, so the game does not
 *  feel like it is skipping the opponent's turn instantly. */
const THINK_DELAY_MS = 200;

/** How long the game may sit unchanged while the engine's Expected Input names
 *  the bot before the driver escalates (issue #2284). Tuned in this one place.
 *
 *  The floor is the hardest search the bot can run: `DIFFICULTY_BUDGETS.hard` is
 *  `{ iterations: 1200, timeMs: 600 }`, plus `THINK_DELAY_MS` and the Worker
 *  round-trip. 6 s is an order of magnitude above that, so a legitimately slow
 *  think is never mistaken for a hang (`useVsAiDriver-liveness.bot.test.ts`
 *  asserts exactly that), while a real freeze is over in seconds rather than
 *  forever. A decision that is already KNOWN to be missing does not wait at
 *  all — see `escalateImmediately` below. */
export const BOT_WATCHDOG_MS = 6000;

/** How many times a thrown bot submission is retried — with the state re-read —
 *  before the driver enters the escalation ladder (issue #2284). A throw used to
 *  latch the loop: it cleared the signature but nothing re-drove the effect,
 *  because a rejected mutation changes no state and therefore produces no new
 *  tick. */
export const BOT_SUBMIT_RETRY_LIMIT = 2;

/** What the driver hook reports back to the UI. */
export type VsAiDriverStatus = {
    /** True while the bot is searching for a move (a worthwhile window). Clears
     *  the moment it submits. Trivial immediate passes never set it. */
    thinking: boolean;
    /** Rung 5 (issue #2284): the escalation ladder ran out of legal automatic
     *  exits while the game was waiting on the bot. Never a silent no-op — the
     *  board surfaces it and offers {@link VsAiDriverStatus.resolveStuck}.
     *  `null` while the invariant holds. */
    stuck: { expectedKind: ExpectedInputKind } | null;
    /** The human's manual exit from a stuck game: re-walks the ladder from the
     *  top and submits the first legal rung. Resolves once the submission
     *  settles. */
    resolveStuck: () => Promise<void>;
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
    // Rung 5's banner, stored WITH the state version it belongs to so the
    // exposed value can be DERIVED (below) rather than cleared from an effect:
    // a synchronous `setState` inside an effect is a cascading-render hazard,
    // and "the game moved on" is a pure function of the current signature.
    const [stuckAt, setStuckAt] = useState<{
        signature: string;
        expectedKind: ExpectedInputKind;
    } | null>(null);
    // Bumped whenever an in-flight submission SETTLES without advancing the
    // game (a rejection, or a mock/server that accepted without a new tick).
    // Without it a thrown mutation left the loop permanently quiet: a rejection
    // changes no state, so no new tick arrives to re-run the effects (issue
    // #2284).
    const [settleNonce, setSettleNonce] = useState(0);

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
    // issue #2284 — the escalation ladder's decline mutations. Every one is the
    // engine's own abort path for a waiting window (CR 608.2b / 601.2h), driven
    // exactly as a human's click would drive it.
    const cancelTarget = useMutation(api.game.cancelTarget);
    const cancelCast = useMutation(api.game.cancelCast);
    const cancelActivation = useMutation(api.game.cancelActivation);

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

    const declineMutations: DeclineMutations = {
        cancelTarget,
        confirmBlockers: mutations.confirmBlockers,
        confirmAttackers: mutations.confirmAttackers,
        cancelCast,
        cancelActivation,
        selectSacrifice: mutations.selectSacrifice,
    };

    const directMutations: DirectMutations = {
        autoTapForAttackTax,
        cancelAttackTax,
        resolveManaSpendChoice,
        selectCastExileCost,
        selectConvokeCreatures,
        confirmDamage: mutations.confirmDamage,
        passPriority: mutations.passPriority,
    };

    // The state version the driver is looking at — the TICK's seq (issue
    // #1778), falling back to the projection's own when no tick row exists yet.
    // Computed once at render scope because three consumers need the same
    // value: the decision path's dedupe, the watchdog's "have I acted on this
    // state" check, and the derived rung-5 banner.
    const currentSignature =
        botId && botState
            ? `${gameId}:${tick ? tick.seq : botState.seq}`
            : null;

    const inFlight = useRef(false);
    const lastSignature = useRef<string | null>(null);
    const lastGameId = useRef<Id<"games"> | null>(null);
    // issue #2284 — the escalation bookkeeping, all keyed to the state version
    // the driver is stuck on so a state that advances resets everything.
    const escalationSignature = useRef<string | null>(null);
    const escalationAttempt = useRef(0);
    const retrySignature = useRef<string | null>(null);
    const retries = useRef(0);
    // The state version rung 5 already surfaced. Without it the ladder's
    // terminal rung re-fires on every render (a fresh banner object is a state
    // change, which re-runs the effect, which re-arms the watchdog), and the
    // "never a silent no-op" guarantee turns into a render loop.
    const stuckSignature = useRef<string | null>(null);
    // The armed watchdog, keyed to the STATE VERSION it is watching (issue
    // #2284, review finding 1). Held in a ref rather than torn down by the
    // effect's cleanup on purpose — see the watchdog effect below.
    const watchdog = useRef<{ signature: string; timer: number } | null>(null);
    const disarmWatchdog = useCallback(() => {
        if (watchdog.current) {
            window.clearTimeout(watchdog.current.timer);
            watchdog.current = null;
        }
    }, []);

    // Everything both effects need, rebuilt per render but stable in content.
    const realisationContext: RealisationContext | null =
        botId && botState
            ? {
                  gameId,
                  botId,
                  botState,
                  mutations,
                  owedPayment: owedPaymentMutations,
                  decline: declineMutations,
                  direct: directMutations,
              }
            : null;

    // ── The shared dispatch guard ───────────────────────────────────────────
    //
    // A realisation is ATOMIC (ADR 0091 decision 6, issue #1209): `inFlight`
    // used to be written ONLY by the Worker branch, while every direct-mutation
    // branch merely READ it — so each mutation in a multi-step realisation
    // bumped the state seq, re-fired this reactive effect, and let a second
    // decision interleave into a half-built announcement. Every path now runs
    // through this helper, which holds the guard for the WHOLE sequence.
    //
    // On a THROW it retries within `BOT_SUBMIT_RETRY_LIMIT` (with the state
    // re-read, since the retry goes back through the reactive effect) and then
    // stops re-driving, leaving the window to the watchdog. Before #2284 the
    // catch simply cleared the signature and nothing ever re-drove: a rejected
    // mutation changes no state, so no new tick arrives.
    // ── The decision breadcrumb (issue #2470) ───────────────────────────────
    //
    // One record per decision EXIT, successes included: the diagnosis is the
    // RUN, not the single record. A ring of `move` says the Brain was healthy
    // and the bot meant its passes; a ring of `search-error` / `worker-error` /
    // `timeout` says the Brain never answered and the passes the player saw
    // came from the escalation ladder (issue #2450, which could not be
    // root-caused because nothing distinguished the two).
    //
    // Pure observation, off the authoritative path (ADR 0074) — it can only
    // append to a bounded client-side ring, never change what the bot does.
    const note = (
        outcome: AiDecisionOutcome,
        extra: {
            expectedKind: ExpectedInputKind;
            via?: "worker" | "inline";
            moveKind?: string;
            message?: string;
        }
    ) => {
        if (!botState) return;
        recordAiDecision({
            outcome,
            phase: botState.phase,
            seq: botState.seq,
            ...extra,
        });
    };

    const dispatch = (
        signature: string,
        run: () => Promise<unknown>,
        // issue #2470 — what to say in the breadcrumb if this submission is
        // REJECTED. Optional because the escalation rungs record themselves
        // through the escalation ring; a rung that is also rejected is a
        // rejection like any other and still deserves the note.
        meta?: { expectedKind: ExpectedInputKind; moveKind?: string }
    ) => {
        if (inFlight.current) return;
        inFlight.current = true;
        lastSignature.current = signature;
        void run()
            .catch((e: unknown) => {
                // Stale/illegal submissions are rejected server-side; allow
                // the next state change to re-drive this state. A rejection is
                // one of the two ways a decision dies silently (the other is a
                // failed consult) — record it before it is swallowed.
                if (meta) {
                    note("submit-error", {
                        expectedKind: meta.expectedKind,
                        moveKind: meta.moveKind,
                        message: e instanceof Error ? e.message : String(e),
                    });
                }
                lastSignature.current = null;
                if (retrySignature.current !== signature) {
                    retrySignature.current = signature;
                    retries.current = 0;
                }
                retries.current += 1;
            })
            .finally(() => {
                inFlight.current = false;
                setThinking(false);
                // Re-run the effects even though no new tick arrived: this is
                // the only thing that un-latches a failed submission.
                setSettleNonce((n) => n + 1);
            });
    };

    // ── Rung 1..5: the escalation ladder ────────────────────────────────────
    const escalate = useCallback(
        (
            signature: string,
            view: BotView,
            kind: ExpectedInputKind,
            ctx: RealisationContext
        ) => {
            if (inFlight.current) return;
            if (stuckSignature.current === signature) return;
            if (escalationSignature.current !== signature) {
                escalationSignature.current = signature;
                escalationAttempt.current = 0;
            }

            // Rung 1 — re-run the normal decision path once, to absorb a stale
            // view or a transient Worker failure. Not recorded in the trace:
            // only escalations PAST the first rung are, per the issue.
            if (escalationAttempt.current === 0) {
                escalationAttempt.current = 1;
                const runner = realiseBotAction(decideBotAction(view), ctx);
                if (runner) {
                    dispatch(signature, runner);
                    return;
                }
                // The same view produced the same nothing — waiting another
                // full interval before rung 2 buys nothing, so fall through.
            }

            // Rungs 2-4 — the minimal-legal answer, the CR decline, the pass.
            const ladder = escalationLadder(kind, view);
            for (
                let i = escalationAttempt.current - 1;
                i < ladder.length;
                i++
            ) {
                escalationAttempt.current = i + 2;
                const step = ladder[i];
                const runner = realiseBotAction(step.action, ctx);
                if (!runner) continue;
                recordAiEscalation({
                    rung: step.rung,
                    expectedKind: kind,
                    action: step.action.kind,
                });
                dispatch(signature, runner);
                return;
            }

            // Rung 5 — out of legal automatic exits. Surface it; never a silent
            // no-op. Once per state version.
            stuckSignature.current = signature;
            recordAiEscalation({
                rung: 5,
                expectedKind: kind,
                action: "no legal automatic exit — awaiting the player",
            });
            setStuckAt({ signature, expectedKind: kind });
        },
        // Everything this closes over is a ref, a stable setState, or an
        // argument: `dispatch` is rebuilt each render but only touches refs, and
        // the ladder is a pure function of what it is handed. Stable on purpose
        // — the watchdog effect depends on it.
        []
    );

    // ── The normal decision path ────────────────────────────────────────────
    useEffect(() => {
        if (!botId || !botState || !realisationContext) return;
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
            escalationSignature.current = null;
            retrySignature.current = null;
            stuckSignature.current = null;
        }

        // Cheap main-thread gate: only consult the Worker when the bot actually
        // owes an action in this window. Owed-ness is the ENGINE's answer
        // (`view.owedInput`, ADR 0047) — see the module header.
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
        const signature = currentSignature!;
        if (lastSignature.current === signature) return;
        // A submission that kept throwing has spent its retry budget; stop
        // re-driving it here and leave the window to the watchdog, which
        // escalates to a DIFFERENT (legal) answer rather than looping on the
        // one the server keeps rejecting (issue #2284).
        if (
            retrySignature.current === signature &&
            retries.current >= BOT_SUBMIT_RETRY_LIMIT
        ) {
            return;
        }

        // A window the bot cannot answer is not dispatched — it is escalated by
        // the watchdog effect below, immediately (issue #2284).
        if (action.kind === "unanswered") return;

        // Every non-search realisation is submitted directly — the parked
        // payment families, the combat-damage confirmation, the brain-resolved
        // mulligan/choice defaults, the escalation declines. The set is derived
        // from the compile-time-exhaustive `botActionRealisation` (NOT a
        // hand-maintained list): a new mechanic that adds a BotAction kind is a
        // build error until classified, so it can never silently fall through to
        // the Worker and freeze the bot (the recurring class this closes).
        const realisation = botActionRealisation(action.kind);
        if (realisation !== "worker") {
            const runner = realiseBotAction(action, realisationContext);
            if (runner) dispatch(signature, runner);
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
            // Recorded too (issue #2470): this pass never consulted the Brain,
            // so it is NOT evidence about the Brain's health — a ring that did
            // not say so would read as "the search kept choosing to pass".
            note("skip-pass", { expectedKind: view.owedInput!.kind });
            dispatch(
                signature,
                () => mutations.passPriority({ gameId, playerId: botId }),
                { expectedKind: view.owedInput!.kind, moveKind: "pass" }
            );
            return;
        }

        const timer = window.setTimeout(() => {
            if (inFlight.current) return;
            setThinking(true);
            // Difficulty-scaled search budget (issue #114): the player's chosen
            // preset (persisted in localStorage) maps to the search budget. The
            // server move path is untouched — this only tunes how hard the
            // client-side brain thinks.
            const budget = budgetFor(getStoredDifficulty());
            dispatch(
                signature,
                () =>
                    consultBrain(botState, botId, budget, ownDeck).then(
                        ({ move, trace, outcome, via, message }) => {
                            // Surface the reasoning to the Debug panel (client-only).
                            setLatestAiTrace(trace);
                            // issue #2470 — the consult's own verdict, recorded
                            // BEFORE the fallbacks below rewrite what happens
                            // next: `no-move` after a healthy search and
                            // `worker-error` after a dead one both arrive here
                            // as `move === null`, and only this says which.
                            note(outcome, {
                                expectedKind: view.owedInput!.kind,
                                via,
                                message,
                                ...(move ? { moveKind: move.kind } : {}),
                            });
                            // Safety net for a searched pending choice (issue #1506)
                            // and for a searched engine-raised TARGET selection
                            // (issue #2283): either window suppresses every other
                            // move, so if the search surfaced none the bot would sit
                            // on the frozen priority. Fall back to the minimal-legal
                            // answer the gate already enumerated through the same
                            // authority the search reads. (The watchdog is the
                            // general backstop — this is the cheap local one.)
                            const chosen =
                                move ??
                                (action.kind === "search-choice" &&
                                view.owedChoice
                                    ? botActionToMove(
                                          chooseOwedChoiceAction(
                                              view.owedChoice
                                          ),
                                          botState,
                                          botId
                                      )
                                    : action.kind === "search-target" &&
                                        view.owedTarget
                                      ? botActionToMove(
                                            chooseOwedTargetAction(
                                                view.owedTarget
                                            ),
                                            botState,
                                            botId
                                        )
                                      : null);
                            return chosen
                                ? executeMove(chosen, {
                                      gameId,
                                      botId,
                                      mutations,
                                  })
                                : undefined;
                        }
                    ),
                { expectedKind: view.owedInput!.kind }
            );
        }, THINK_DELAY_MS);

        return () => window.clearTimeout(timer);
        // `mutations` is rebuilt each render but its callables are stable; depend
        // on the state version (tick + the state it gates) and bot id only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId, botId, tick, botState, ownDeck, settleNonce]);

    // ── The watchdog ────────────────────────────────────────────────────────
    //
    // The invariant's only honest signal is **the state version changed**.
    //
    // It used to be `lastSignature.current === signature` — "a dispatch was
    // started for this state version, so the game must be moving" — justified by
    // "a submission that resolved without advancing the game is impossible
    // server-side". That premise is false, twice over (issue #2284 review):
    //
    //   * the Worker branch's runner is `consultBrain(...).then(({move}) =>
    //     chosen ? executeMove(...) : undefined)`. A search that yields `move:
    //     null` with no local fallback RESOLVES having submitted nothing.
    //     `brain-client.ts`'s `worker.onerror` resolves every in-flight consult
    //     with exactly that, so one transient Worker error hit this path;
    //   * `passPriority` (`convex/game.ts`) deliberately returns WITHOUT saving
    //     when the caller does not hold priority — reachable at rung 4 in the
    //     CR 510.1c combat-damage sub-flow, where `priority` conflates a window
    //     the pass does not own.
    //
    // In both, nothing threw, so `.catch` never cleared the signature; `.finally`
    // re-rendered, this effect re-ran, its cleanup cleared its own already-armed
    // timer, and the `lastSignature` bail returned before re-arming it. No
    // mutation, therefore no new tick, therefore nothing to ever run again:
    // frozen with no banner and no escalation record — the exact failure this
    // issue exists to eliminate.
    //
    // So the timer lives in a REF keyed to the state version, and is deliberately
    // NOT torn down by the effect's cleanup. A re-render that leaves the state
    // version unchanged (which is what a settled-but-inert submission produces)
    // leaves the running clock alone rather than resetting or cancelling it. It
    // is disarmed only by the state version actually changing, by the bot no
    // longer being owed anything, or by unmount.
    //
    // `lastSignature` keeps its OTHER job — the normal decision path's dedupe,
    // where "I already tried for this state version" is exactly what it means.
    // Only its use as a liveness signal was dishonest.
    useEffect(() => {
        if (!botId || !botState || !realisationContext) {
            disarmWatchdog();
            return;
        }
        if (tick === undefined) {
            disarmWatchdog();
            return;
        }
        if (tick && botState.seq !== tick.seq) {
            disarmWatchdog();
            return;
        }

        const signature = currentSignature!;
        const view = buildBotView(botState, botId);
        const owed = view.owedInput;
        // Not our window — nothing to arm. Any leftover rung-5 banner clears
        // on its own: it is keyed to the state version that produced it.
        if (!owed) {
            disarmWatchdog();
            return;
        }
        // Already the terminal rung for this state version: the player's control
        // is the exit, and burning more timers changes nothing.
        if (stuckSignature.current === signature) {
            disarmWatchdog();
            return;
        }
        // Already watching THIS state version. Leave the running clock alone —
        // re-arming here is what let an inert submission reset (or, via the
        // cleanup, cancel) the watchdog forever.
        if (watchdog.current?.signature === signature) return;
        disarmWatchdog();

        const action = decideBotAction(view);
        // "Nothing owed" while the Expected Input names the bot is a DEFECT, not
        // a slow think: it asserts in development, is recorded, and skips the
        // interval entirely (issue #2284).
        const escalateImmediately =
            action.kind === "none" || action.kind === "unanswered";
        if (escalateImmediately && import.meta.env?.DEV) {
            console.error(
                `[vs-AI] bot decided "${action.kind}" while the engine's Expected Input ` +
                    `names it for a "${owed.kind}" window (ADR 0047 / issue #2284). ` +
                    `Escalating.`
            );
        }

        const arm = (delay: number) => {
            const timer = window.setTimeout(() => {
                watchdog.current = null;
                // A submission is genuinely in flight: do not interleave into it
                // (ADR 0091 decision 6 — a realisation is atomic), but never
                // simply STOP either. Stopping is the latch, and a consult that
                // never replies (`consultBrain` has no timeout of its own) would
                // otherwise hold the guard forever with no clock left running.
                if (inFlight.current) {
                    arm(BOT_WATCHDOG_MS);
                    return;
                }
                escalate(signature, view, owed.kind, realisationContext);
                // Keep watching the SAME state version. If the rung just
                // dispatched also resolves without advancing the game, the next
                // interval walks the ladder further instead of going quiet;
                // if it does advance, this timer is disarmed by the new
                // signature before it ever fires. Rung 5 is terminal.
                if (stuckSignature.current !== signature) arm(BOT_WATCHDOG_MS);
            }, delay);
            watchdog.current = { signature, timer };
        };
        arm(escalateImmediately ? 0 : BOT_WATCHDOG_MS);
        // NO cleanup: see the comment above. The timer is owned by the ref, not
        // by this effect run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId, botId, tick, botState, settleNonce, escalate, disarmWatchdog]);

    // The one place the watchdog is torn down by React: leaving the board.
    useEffect(() => disarmWatchdog, [disarmWatchdog]);

    // Rung 5's human exit: re-walk the ladder from the top. Deliberately resets
    // the attempt counter, so the player's click always tries the cheapest legal
    // answer first rather than resuming wherever the automatic walk stopped.
    //
    // It does NOT clear the banner itself (review finding 3). `stuck` is DERIVED
    // from "this state version is still the one rung 5 fired on", so the banner
    // disappears exactly when the game moves — and only then. Clearing it after
    // `await runner()` took a resolved mutation as proof the game advanced, which
    // is the same false premise the watchdog used to rest on: a rung that hits
    // `passPriority`'s silent no-op branch (`convex/game.ts` returns without
    // saving when the caller does not hold priority) would have removed the
    // human's ONE manual exit while the board sat exactly where it was. Clearing
    // `stuckSignature` before submitting re-arms the automatic watchdog too, so
    // an inert rung is followed by the next one rather than by silence.
    //
    // Never rejects: a rung whose mutation is rejected leaves the banner up so
    // the player can retry, and `BotStuckNotice` re-enables its button.
    const resolveStuck = useCallback(async () => {
        if (!botId || !botState || !realisationContext) return;
        const view = buildBotView(botState, botId);
        const owed = view.owedInput;
        // Nothing is owed any more — the game moved on without us.
        if (!owed) {
            setStuckAt(null);
            return;
        }
        const ladder = escalationLadder(owed.kind, view);
        for (const step of ladder) {
            const runner = realiseBotAction(step.action, realisationContext);
            if (!runner) continue;
            recordAiEscalation({
                rung: step.rung,
                expectedKind: owed.kind,
                action: `${step.action.kind} (player-triggered)`,
            });
            inFlight.current = false;
            stuckSignature.current = null;
            escalationSignature.current = null;
            try {
                await runner();
            } catch {
                // The server rejected it. The banner is still on this state
                // version, so it stays up and the player can try again.
            }
            setSettleNonce((n) => n + 1);
            return;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId, botId, botState]);

    // Derived, never cleared from an effect: the banner belongs to ONE state
    // version, so the moment the game advances (a new tick seq) it is gone.
    const stuck =
        stuckAt && stuckAt.signature === currentSignature
            ? { expectedKind: stuckAt.expectedKind }
            : null;

    return { thinking, stuck, resolveStuck };
}
