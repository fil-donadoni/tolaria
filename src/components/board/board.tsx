import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { LayoutGroup } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { usePageVisible } from "~/hooks/usePageVisible";
import {
    SkipPhasePrefsContext,
    useSkipPhasePrefsState,
} from "~/hooks/useSkipPhasePreferences";
import {
    PendingChoiceBufferContext,
    usePendingChoiceBufferState,
} from "~/hooks/usePendingChoiceBuffer";
import {
    AttackSequenceContext,
    useAttackSequenceState,
} from "~/hooks/useAttackSequence";
import {
    DivideBufferContext,
    useDivideBufferState,
    type DivideBuffer,
} from "~/hooks/useDivideBuffer";
import {
    MinimizedChoiceContext,
    useMinimizedChoiceState,
} from "~/hooks/useMinimizedChoice";
import { preloadCardImages } from "~/lib/image-preload";
import {
    PORTRAIT_OPPONENT_BATTLEFIELD_BAND,
    PORTRAIT_OPPONENT_HAND_BAND,
    PORTRAIT_VIEWER_BATTLEFIELD_BAND,
    PORTRAIT_VIEWER_HAND_BAND,
    portraitBandVars,
} from "~/lib/portrait-board-bands";
import {
    LANDSCAPE_OPPONENT_BATTLEFIELD_BAND,
    LANDSCAPE_OPPONENT_HAND_BAND,
    LANDSCAPE_PILE_SCALE,
    LANDSCAPE_VIEWER_BATTLEFIELD_BAND,
    LANDSCAPE_VIEWER_HAND_BAND,
    landscapeBandVars,
    landscapeCardMetrics,
    makeLandscapeHandLayout,
} from "~/lib/landscape-board-bands";
import { CONTROLLER_STRIP_CLEARANCE_EXPR } from "~/lib/controller-bar-metrics";
import { computeSoloViewerId } from "~/lib/priority";
import {
    fanLayout,
    CARD_WIDTH,
    CARD_HEIGHT,
    type Placement,
} from "~/lib/board-layout";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { useViewportMode } from "~/hooks/useViewportMode";
import { useViewportHeight } from "~/hooks/useViewportHeight";
import { useRecentArrivals } from "~/hooks/useRecentArrivals";
import { ArrowAnchorProvider } from "~/hooks/useArrowAnchors";
import { ArrowHighlightProvider } from "~/hooks/ArrowHighlightProvider";
import BoardBattlefield from "./board-battlefield";
import BoardPlayer from "./board-player";
import BoardHand from "./board-hand";
import BoardHandPortrait from "./board-hand-portrait";
import BoardPiles from "./board-piles";
import BoardPortraitChips from "./board-portrait-chips";
import BoardArrows from "./board-arrows";
import GameStack from "./game-stack";
import PriorityIndicator from "./priority-indicator";
import BoardBackground from "./board-background";
import Controller from "./controller";
import AutoPassController from "./auto-pass-controller";
import GameOverDialog from "./game-over-dialog";
import PauseMenuDialog from "./pause-menu-dialog";
import TargetSelectionBanner from "./target-selection-banner";
import GraveyardTargetDialog from "./graveyard-target-dialog";
import ExileCostDialog from "./exile-cost-dialog";
import CastExileCostDialog from "./cast-exile-cost-dialog";
import ConvokeCreatureDialog from "./convoke-creature-dialog";
import DiscardCostDialog from "./discard-cost-dialog";
import CastAlternativeHandCostDialog from "./cast-alternative-hand-cost-dialog";
import ManaSpendChoiceDialog from "./mana-spend-choice-dialog";
import { activeManaSpendChoice } from "~/lib/card-utils";
import { isGraveyardTargetForViewer } from "~/lib/graveyard-targets";
import PaymentBanner from "./payment-banner";
import SacrificeBanner from "./sacrifice-banner";
import AttackManaTaxBanner from "./attack-mana-tax-banner";
import { isSacrificeComplete } from "~/lib/sacrifice-selection";
import PendingChoicePrompt from "./pending-choice-prompt";
import PileDivisionPicker from "./pile-division/pile-division-picker";
import { resolvePileDivisionCards } from "~/lib/pile-division";
import HandCardPick from "./hand-card-pick";
import RevealHandView from "./reveal-hand-view";
import RevealNotificationOverlay from "./reveal-notification-overlay";
import PutBackPicker from "./put-back-picker";
import MinimizedChoiceIndicator from "./minimized-choice-indicator";
import MulliganPrompt from "./mulligan-prompt";
import ErrorToast from "./error-toast";
import VsAiDriver from "./vs-ai-driver";

const POPUP_SELECTORS = [
    '[data-slot="dialog-content"]',
    '[data-slot="popover-content"]',
    '[data-slot="context-menu-content"]',
].join(",");

/** Horizontal band reserved on the right edge by the pile columns
 *  (graveyard/library/exile): right-3 (0.75rem) + 3 × --card-w-sm + 2 × gap-2
 *  (1rem). In portrait the piles collapse to bottom chips, so the band is 0.
 *  In landscape-compact (#1768) the piles are a ONE-tile-wide column docked
 *  beside the control strip, so what the play area loses on the right is the
 *  strip's own measured clearance PLUS that one pile-tile column
 *  ({@link LANDSCAPE_RIGHT_RAIL_VAR}, the board's own right inset) — omitting
 *  the tile term left a portal'd dialog centred ~half a tile off the true play
 *  area (#1770 follow-up from #1802).
 *  Single source of truth: set inline on `data-board-root` for in-subtree
 *  consumers (nameplate, hand) AND published to `document.documentElement`
 *  while the board is mounted so portal'd dialogs (rendered to body) can
 *  center on the play area instead of the full viewport. */
function rightPilesWidth(
    isPortrait: boolean,
    landscapeCompact: boolean,
    viewportHeight: number
): string {
    if (isPortrait) return "0px";
    if (landscapeCompact) {
        const pileWidth =
            landscapeCardMetrics(viewportHeight).cardWidth *
            LANDSCAPE_PILE_SCALE;
        return `calc(${CONTROLLER_STRIP_CLEARANCE_EXPR} + ${pileWidth}px + 0.5rem)`;
    }
    return "calc(1.75rem + 3 * var(--card-w-sm))";
}

type BoardProps = {
    gameId: Id<"games">;
    playerId: string;
    /** Solo (single-user) game: viewer auto-follows the priority player. */
    solo: boolean;
    /** vs-AI game (ADR 0001): the second seat is driven by the bot and the
     *  viewer stays pinned to the human's seat. */
    vsAi: boolean;
    showAllCards: boolean;
    debugAllActions: boolean;
    /** Re-point the session to another game in-place (see GameContext). */
    onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
};

/** Hand: shallow fanned arc, baseline near the bottom of its zone so the dome
 *  lifts upward into view (`fanLayout`, #251). */
function handLayout(count: number, width: number, height: number): Placement[] {
    return fanLayout({ count, width, baseY: height * 0.6 });
}

/** Opponent hand: slimmer backs (≈70% size) tucked higher up so only a small
 *  Arena-style sliver peeks below the top edge. A larger `baseY` pushes the
 *  mirrored fan toward the top edge ({@link mirrorVertical} flips it), and the
 *  shrunk card footprint must match the fan's step math. */
const OPP_HAND_CARD_WIDTH = Math.round(CARD_WIDTH * 0.7);
const OPP_HAND_CARD_HEIGHT = Math.round(CARD_HEIGHT * 0.7);
function opponentHandLayout(
    count: number,
    width: number,
    height: number
): Placement[] {
    return fanLayout({
        count,
        width,
        baseY: height * 0.72,
        cardWidth: OPP_HAND_CARD_WIDTH,
        cardHeight: OPP_HAND_CARD_HEIGHT,
    });
}

export default function Board({
    gameId,
    playerId,
    solo,
    vsAi,
    showAllCards,
    debugAllActions,
    onSwitchGame,
}: BoardProps) {
    const isPortrait = useIsPortrait();
    // Third layout regime (#1763 seam, consumed here by #1768). `useIsPortrait`
    // stays the portrait projection of the SAME hook, so the two can never
    // disagree; this read only adds the landscape branch the projection folds
    // into `false`.
    const landscapeCompact = useViewportMode() === "landscape-compact";
    // The board's height is the only input the landscape budget needs: one
    // shared card footprint for the hand AND the battlefield is derived from it
    // (see landscape-board-bands). Inert in the other two modes.
    const viewportHeight = useViewportHeight();
    const landscapeCards = useMemo(
        () => landscapeCardMetrics(viewportHeight),
        [viewportHeight]
    );
    const landscapeHandLayout = useMemo(
        () => makeLandscapeHandLayout(landscapeCards.cardWidth),
        [landscapeCards.cardWidth]
    );
    const pageVisible = usePageVisible();
    const skipPhasePrefs = useSkipPhasePrefsState();
    const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
    const publicState = useQuery(
        api.game.getPublicState,
        pageVisible && !showAllCards
            ? { gameId, playerId, debugAllActions }
            : "skip"
    );
    const fullState = useQuery(
        api.game.getFullState,
        pageVisible && showAllCards ? { gameId, debugAllActions } : "skip"
    );
    const state = showAllCards ? fullState : publicState;

    // Owning Match (ADR 0029): the game-over screen shows the terminal Match
    // result. Resolve the matchId from the game doc, then the Match meta.
    const game = useQuery(api.game.getGame, pageVisible ? { gameId } : "skip");

    // Convex bandwidth: the decklists are already inside the `games` doc this
    // component subscribes to above, so deriving the id set here costs nothing.
    // A dedicated `getGameCardIds` query was a SECOND subscription re-reading
    // that same ~9 KB row on every patch — pure duplicated read bandwidth.
    const gameCardIds = useMemo(() => {
        if (!game) return undefined;
        const ids = new Set<string>();
        for (const p of game.players ?? []) {
            for (const c of p.deck?.cards ?? []) ids.add(c.cardId);
        }
        return Array.from(ids);
    }, [game]);

    const matchId = game?.matchId ?? null;
    const match = useQuery(
        api.matches.getMatch,
        pageVisible && matchId ? { matchId } : "skip"
    );
    useEffect(() => {
        if (!gameCardIds || gameCardIds.length === 0) return;
        // Art crops are only fetched when the user opens the zoom panel (hover
        // delay or `z` keypress) — preloading the entire deck's crops up front
        // adds ~3 MB of unused image traffic on first paint. Lazy fetch inside
        // CardPreview keeps initial LCP fast without harming zoom UX.
        preloadCardImages(gameCardIds);
    }, [gameCardIds]);

    const players = state?.players;
    const stack = state?.stack;
    useEffect(() => {
        if (!players) return;
        const ids: string[] = [];
        for (const p of players) {
            for (const c of p.battlefield) ids.push(c.card.id);
            for (const c of p.graveyard) ids.push(c.card.id);
            for (const c of p.exile) ids.push(c.card.id);
            for (const c of p.hand) if (c) ids.push(c.card.id);
            if (Array.isArray(p.library)) {
                for (const c of p.library) ids.push(c.card.id);
            } else {
                // ADR 0026 — preload art for the viewer's known library cards.
                for (const k of p.library.known ?? []) {
                    ids.push(k.card.card.id);
                }
            }
        }
        if (stack) for (const c of stack) ids.push(c.card.id);
        preloadCardImages(ids);
    }, [players, stack]);

    // Publish --right-piles-w to the document root while the board is mounted
    // so portal'd dialogs (rendered to document.body, outside data-board-root)
    // can offset their centering by half the strip and stay over the play
    // area. Removed on unmount so the lobby/global default is absent and the
    // dialog's var(..., 0px) fallback centers on the full viewport.
    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty(
            "--right-piles-w",
            rightPilesWidth(isPortrait, landscapeCompact, viewportHeight)
        );
        return () => {
            root.style.removeProperty("--right-piles-w");
        };
    }, [isPortrait, landscapeCompact, viewportHeight]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (state?.gameOver) return;
            if (document.querySelector(POPUP_SELECTORS)) return;
            e.preventDefault();
            setPauseMenuOpen(true);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [state?.gameOver]);

    // Solo viewer follows whoever owes input (computeSoloViewerId). Computed
    // BEFORE the pending-choice buffer so the buffer submits as that seat — not
    // the fixed join seat. In solo the join seat is p1, yet a choice can be owed
    // by p2 (e.g. Copy Artifact's copy-target choice owed by the p2 caster);
    // submitting it as p1 is rejected by the Expected Input gate (ADR 0047,
    // "waiting for choice input from another player"). vs-AI / 2p stays pinned
    // to the human's own seat (ADR 0001).
    const viewerId =
        solo && !vsAi && state
            ? computeSoloViewerId({
                  activePlayerId: state.activePlayerId,
                  priorityPlayerId:
                      state.priorityPlayerId ?? state.activePlayerId,
                  phase: state.phase ?? "UPKEEP",
                  combat: state.combat,
                  meleeCombat: state.meleeCombat,
                  pendingCast: state.pendingCast,
                  pendingActivation: state.pendingActivation,
                  pendingTarget: state.pendingTarget,
                  pendingChoices: state.pendingChoices,
                  playerIds: state.players.map((p) => p.id),
              })
            : playerId;

    // Client-side buffer for the active pending choice (ADR 0007). All four
    // click sites read from this single source via PendingChoiceBufferContext.
    // Hook must run unconditionally; passes through `undefined` choice while
    // state is still loading.
    const pendingChoiceBuffer = usePendingChoiceBufferState({
        gameId,
        playerId: viewerId,
        activeChoice: state?.pendingChoices?.[0],
    });

    // Client-only "Attack with all" destination sequence (design 2026-07-23).
    // Auto-resets whenever it stops being relevant — a new turn, a phase change,
    // or a confirmed attacker declaration all change the key.
    const attackSequence = useAttackSequenceState(
        `${state?.turn ?? 0}:${state?.phase ?? ""}:${
            state?.combat?.confirmed ? "confirmed" : "open"
        }`
    );

    // Divide-as-you-choose distribution buffer (CR 601.2d, Pyrokinesis / Fire
    // Covenant). The local per-target split is owned here so the on-card
    // steppers (dial it) and the banner "Done" (submit it) share one source of
    // truth. Narrowed to the viewer-aware `active` below, once viewerId is known.
    const divideBufferState = useDivideBufferState({
        gameId,
        pendingTarget: state?.pendingTarget,
    });

    // Client-only per-choice minimize toggle for blocking choice dialogs
    // (issue #315). Shared by the banner and the library-pick modal so one
    // minimize collapses whichever surface the active choice uses. Resets when
    // the choice resolves; never persisted to GameState.
    const minimizedChoice = useMinimizedChoiceState(state?.pendingChoices?.[0]);

    // Zone-change arrivals (flight + glow): diff consecutive snapshots by
    // stable instance id — see useRecentArrivals. Runs above the !state early
    // return like every other hook; undefined state yields an empty set.
    const recentArrivals = useRecentArrivals(state?.players, state?.stack);

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const allPlayers: Player[] = state.players;
    const activePlayerId = state.activePlayerId;
    const priorityPlayerId = state.priorityPlayerId ?? activePlayerId;
    const phase = state.phase ?? "UPKEEP";
    // CR 500.1: display the active player's own turn count, not the global
    // sequence number — extra turns (CR 500.7) bump the recipient normally.
    const activePlayer = state.players.find(
        (p) => p.id === state.activePlayerId
    );
    const turn = activePlayer?.turnsTaken ?? state.turn ?? 1;
    const pendingCast = state.pendingCast;
    const pendingActivation = state.pendingActivation;
    // CR 601.2g — the generic-mana spend choice (if any) parked on THIS
    // viewer's pendingCast/pendingActivation; renders ManaSpendChoiceDialog
    // ahead of the ordinary PaymentBanner below (it is the LAST finalize-point
    // gate, so mana is already tapped/floating by the time it's set).
    const manaSpendChoice = activeManaSpendChoice(
        pendingCast,
        pendingActivation,
        viewerId
    );
    const autoPassPlayers = state.autoPassPlayers;
    const queuedEndTurn = state.queuedEndTurn;
    const combat = state.combat;
    const meleeCombat = state.meleeCombat;
    // CR 602.1 / 605.1a (issue #1124) — Abeyance's turn-scoped "can't activate
    // abilities that aren't mana abilities" lock, forwarded to
    // `buildTriggerStateView` call sites via GameContext.
    const cannotActivateAbilitiesThisTurn =
        state.cannotActivateAbilitiesThisTurn;
    const pendingTarget = state.pendingTarget;
    const pendingChoices = state.pendingChoices;
    const mulligan = state.mulligan;
    const gameOver = state.gameOver;
    const stackItems = state.stack ?? [];
    // CR 702.26 — flatten phased-out bundles (host + attachments) into a single
    // list. Each card keeps its `controllerId`, so the battlefield renders it
    // dimmed/inert on the controller's side instead of letting it vanish.
    const phasedOutCards: Player["battlefield"] = (
        state.phasedOut ?? []
    ).flatMap((b) => b.cards);

    // `viewerId` is computed above (before the pending-choice buffer) via
    // computeSoloViewerId — the single source of truth for which seat the solo
    // user is currently steering. In vs-AI / 2p it is the human's own seat.

    // Narrow the divide buffer's `active` to the current viewer (CR 601.2d): the
    // steppers/Done only appear for the player who owns the divide selection.
    const divideBuffer: DivideBuffer = {
        ...divideBufferState,
        active:
            divideBufferState.active && pendingTarget?.playerId === viewerId,
    };

    // vs-AI: the bot is the seat the human does not control. The driver queries
    // the bot's own viewpoint and enumerates its moves (ADR 0001) — it only
    // needs the seat id from here.
    const botId = vsAi
        ? (allPlayers.find((p) => p.id !== playerId)?.id ?? null)
        : null;

    // Opponent on top, local player on bottom
    const opponent = allPlayers.find((p) => p.id !== viewerId);
    const me = allPlayers.find((p) => p.id === viewerId);
    const orderedPlayers = [opponent, me].filter(
        (p): p is Player => p !== undefined
    );

    return (
        <GameContext
            value={{
                gameId,
                playerId: viewerId,
                activePlayerId,
                priorityPlayerId,
                phase,
                turn,
                stackCount: stackItems.length,
                pendingCast,
                pendingActivation,
                pendingTarget,
                pendingChoices,
                pendingTriggerBatch: state.pendingTriggerBatch,
                autoPassPlayers,
                queuedEndTurn,
                combat,
                meleeCombat,
                cannotActivateAbilitiesThisTurn,
                lifeGainedThisTurn: state.lifeGainedThisTurn,
                playerProtectionFromEverything:
                    state.playerProtectionFromEverything,
                gameOver,
                allPlayers,
                emblems: state.emblems,
                phasedOutCards,
                monarchId: state.monarchId,
                cityBlessingIds: state.cityBlessingIds,
                pendingReveals: state.pendingReveals,
                recentArrivals,
                showAllCards,
                debugAllActions,
                onSwitchGame,
            }}
        >
            <SkipPhasePrefsContext value={skipPhasePrefs}>
                <PendingChoiceBufferContext value={pendingChoiceBuffer}>
                    <AttackSequenceContext value={attackSequence}>
                        <DivideBufferContext value={divideBuffer}>
                            <MinimizedChoiceContext value={minimizedChoice}>
                                <main className="flex h-full w-full flex-col relative overflow-hidden">
                                    <BoardBackground />
                                    <AutoPassController solo={solo} />
                                    {vsAi && (
                                        <VsAiDriver
                                            gameId={gameId}
                                            botId={botId}
                                        />
                                    )}
                                    {/* Spatial board surface (PRD #249): the single
                                source of truth for card positions is the shared
                                pure layout math (`src/lib/board-layout.ts`) —
                                every card in every zone is placed from
                                `rowLayout` / `fanLayout` output rather than
                                static CSS. Both seats use the same math; the
                                opponent's side is mirrored vertically. A single
                                LayoutGroup spans every zone so a card's
                                shared-layout element (keyed by instance id in
                                SpatialSlot) is matched across zone boundaries —
                                moving hand → battlefield animates the SAME
                                element via a FLIP rather than unmount/remount
                                (#252). */}
                                    <ArrowAnchorProvider>
                                        <ArrowHighlightProvider>
                                            <LayoutGroup>
                                                <div
                                                    className="absolute inset-0"
                                                    data-board-root
                                                    style={
                                                        {
                                                            // Life nameplate + hand center
                                                            // within the space that excludes
                                                            // the right pile band, not the
                                                            // full viewport. See
                                                            // rightPilesWidth() above — the
                                                            // same value is published to
                                                            // documentElement for dialogs.
                                                            "--right-piles-w":
                                                                rightPilesWidth(
                                                                    isPortrait,
                                                                    landscapeCompact,
                                                                    viewportHeight
                                                                ),
                                                            // Portrait vertical budget
                                                            // (#1760): the four bands below
                                                            // are derived from the hand
                                                            // strip's height and the bar's
                                                            // MEASURED clearance, so no band
                                                            // can run under the one beneath
                                                            // it. See portrait-board-bands.
                                                            ...portraitBandVars(),
                                                            // Landscape vertical
                                                            // budget (#1768):
                                                            // four bands plus a
                                                            // left seat rail and
                                                            // a right pile rail,
                                                            // all derived from
                                                            // ONE shared card
                                                            // footprint. Inert
                                                            // unless a landscape
                                                            // band class reads
                                                            // them.
                                                            ...landscapeBandVars(
                                                                viewportHeight
                                                            ),
                                                        } as CSSProperties
                                                    }
                                                >
                                                    {/* Opponent: hand on the top edge,
                                                battlefield below it — same layout
                                                math, mirrored to the top half. */}
                                                    {opponent && (
                                                        <>
                                                            <BoardPlayer
                                                                player={
                                                                    opponent
                                                                }
                                                                side="top"
                                                            />
                                                            <div
                                                                className={
                                                                    isPortrait
                                                                        ? PORTRAIT_OPPONENT_HAND_BAND
                                                                        : landscapeCompact
                                                                          ? LANDSCAPE_OPPONENT_HAND_BAND
                                                                          : "absolute left-0 right-[var(--right-piles-w)] top-0 h-[18%]"
                                                                }
                                                            >
                                                                {isPortrait ? (
                                                                    <BoardHandPortrait
                                                                        player={
                                                                            opponent
                                                                        }
                                                                        interactive={
                                                                            opponent.id ===
                                                                            viewerId
                                                                        }
                                                                        boardHeight={
                                                                            viewportHeight
                                                                        }
                                                                        seat="opponent"
                                                                        data-testid="zone-opponent-hand"
                                                                    />
                                                                ) : (
                                                                    <BoardHand
                                                                        player={
                                                                            opponent
                                                                        }
                                                                        interactive={
                                                                            opponent.id ===
                                                                            viewerId
                                                                        }
                                                                        // Landscape: the SAME flat row
                                                                        // and the SAME card footprint as
                                                                        // the viewer's hand — the band
                                                                        // clips it to a sliver, which is
                                                                        // all a face-down count needs.
                                                                        layout={
                                                                            landscapeCompact
                                                                                ? landscapeHandLayout
                                                                                : opponentHandLayout
                                                                        }
                                                                        cardWidth={
                                                                            landscapeCompact
                                                                                ? landscapeCards.cardWidth
                                                                                : OPP_HAND_CARD_WIDTH
                                                                        }
                                                                        cardHeight={
                                                                            landscapeCompact
                                                                                ? landscapeCards.cardHeight
                                                                                : OPP_HAND_CARD_HEIGHT
                                                                        }
                                                                        mirror
                                                                        data-testid="zone-opponent-hand"
                                                                    />
                                                                )}
                                                            </div>
                                                            <div
                                                                className={
                                                                    isPortrait
                                                                        ? PORTRAIT_OPPONENT_BATTLEFIELD_BAND
                                                                        : landscapeCompact
                                                                          ? LANDSCAPE_OPPONENT_BATTLEFIELD_BAND
                                                                          : "absolute left-0 right-0 top-[18%] h-[32%]"
                                                                }
                                                            >
                                                                <BoardBattlefield
                                                                    player={
                                                                        opponent
                                                                    }
                                                                    mirror
                                                                    compact={
                                                                        landscapeCompact
                                                                            ? landscapeCards
                                                                            : undefined
                                                                    }
                                                                    data-testid="zone-opponent-battlefield"
                                                                />
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* Viewer: battlefield on the bottom
                                                half, hand on the bottom edge. */}
                                                    {me && (
                                                        <>
                                                            <BoardPlayer
                                                                player={me}
                                                                side="bottom"
                                                            />
                                                            <div
                                                                className={
                                                                    isPortrait
                                                                        ? // Bottom-anchored to
                                                                          // the TOP of the hand
                                                                          // strip (#1760) — a
                                                                          // fixed `h-[32%]` ran
                                                                          // past it and hid the
                                                                          // lands row under a
                                                                          // full hand.
                                                                          PORTRAIT_VIEWER_BATTLEFIELD_BAND
                                                                        : landscapeCompact
                                                                          ? LANDSCAPE_VIEWER_BATTLEFIELD_BAND
                                                                          : "absolute left-0 right-0 top-1/2 h-[32%]"
                                                                }
                                                            >
                                                                <BoardBattlefield
                                                                    player={me}
                                                                    compact={
                                                                        landscapeCompact
                                                                            ? landscapeCards
                                                                            : undefined
                                                                    }
                                                                    data-testid="zone-player-battlefield"
                                                                />
                                                            </div>
                                                            <div
                                                                className={
                                                                    isPortrait
                                                                        ? // Lifted clear of the
                                                                          // variant-D bottom bar
                                                                          // (#335/#1759) so the
                                                                          // hand stays fully
                                                                          // thumb-reachable — by
                                                                          // the bar's MEASURED
                                                                          // height, since its
                                                                          // command row wraps and
                                                                          // a fixed inset let the
                                                                          // grown bar cover the
                                                                          // hand's bottom edge.
                                                                          // Its height is now the
                                                                          // shared band the
                                                                          // battlefield above
                                                                          // reserves (#1760).
                                                                          PORTRAIT_VIEWER_HAND_BAND
                                                                        : landscapeCompact
                                                                          ? LANDSCAPE_VIEWER_HAND_BAND
                                                                          : "absolute left-0 right-[var(--right-piles-w)] bottom-0 h-[18%]"
                                                                }
                                                            >
                                                                {isPortrait ? (
                                                                    <BoardHandPortrait
                                                                        player={
                                                                            me
                                                                        }
                                                                        interactive={
                                                                            me.id ===
                                                                            viewerId
                                                                        }
                                                                        boardHeight={
                                                                            viewportHeight
                                                                        }
                                                                        data-testid="zone-player-hand"
                                                                    />
                                                                ) : (
                                                                    <BoardHand
                                                                        player={
                                                                            me
                                                                        }
                                                                        interactive={
                                                                            me.id ===
                                                                            viewerId
                                                                        }
                                                                        // Landscape: flat row, and the
                                                                        // SAME footprint the battlefield
                                                                        // lays out with — the whole point
                                                                        // of #1768 (the desktop fan used
                                                                        // to render 120×168 hand cards
                                                                        // next to 35×49 permanents).
                                                                        layout={
                                                                            landscapeCompact
                                                                                ? landscapeHandLayout
                                                                                : handLayout
                                                                        }
                                                                        cardWidth={
                                                                            landscapeCompact
                                                                                ? landscapeCards.cardWidth
                                                                                : undefined
                                                                        }
                                                                        cardHeight={
                                                                            landscapeCompact
                                                                                ? landscapeCards.cardHeight
                                                                                : undefined
                                                                        }
                                                                        data-testid="zone-player-hand"
                                                                    />
                                                                )}
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* Card piles (graveyard / library /
                                                exile) for both seats.
                                                Landscape/desktop reuse the spatial
                                                pile columns (#255); portrait
                                                collapses them — and the stack —
                                                into tappable chips that open the
                                                SAME reveal / stack views (#336). */}
                                                    {isPortrait ? (
                                                        <BoardPortraitChips
                                                            orderedPlayers={
                                                                orderedPlayers
                                                            }
                                                            stackItems={
                                                                stackItems
                                                            }
                                                        />
                                                    ) : (
                                                        <BoardPiles
                                                            orderedPlayers={
                                                                orderedPlayers
                                                            }
                                                            compact={
                                                                landscapeCompact
                                                            }
                                                        />
                                                    )}

                                                    {/* Spatial chrome. The controller pod
                                                (phase + priority cue + actions) is
                                                mounted below on the right edge
                                                (#331). */}
                                                    <PriorityIndicator />
                                                    {/* Portrait toggles the stack behind a
                                                chip (above); landscape/desktop keep
                                                it always-on. */}
                                                    {!isPortrait &&
                                                        stackItems.length >
                                                            0 && (
                                                            <GameStack
                                                                stack={
                                                                    stackItems
                                                                }
                                                            />
                                                        )}
                                                    {/* Our own SVG target arrows (#257):
                                                endpoints derive from the shared
                                                layout placements via the
                                                arrow-anchor registry, so arrows
                                                stay glued through the spring/tilt
                                                motion. */}
                                                    <BoardArrows
                                                        stack={stackItems}
                                                        combat={combat}
                                                        defenderId={
                                                            allPlayers.find(
                                                                (p) =>
                                                                    p.id !==
                                                                    activePlayerId
                                                            )?.id ?? null
                                                        }
                                                        anchorRevision={`${me?.id ?? ""}:${opponent?.id ?? ""}`}
                                                    />
                                                </div>
                                            </LayoutGroup>
                                        </ArrowHighlightProvider>
                                    </ArrowAnchorProvider>
                                    {pendingTarget &&
                                        pendingTarget.playerId === viewerId &&
                                        (isGraveyardTargetForViewer(
                                            pendingTarget,
                                            viewerId
                                        ) ? (
                                            <GraveyardTargetDialog
                                                pendingTarget={pendingTarget}
                                                me={me}
                                                allPlayers={allPlayers}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ) : (
                                            <TargetSelectionBanner
                                                pendingTarget={pendingTarget}
                                                me={me}
                                                stack={stackItems}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ))}
                                    {pendingCast &&
                                        pendingCast.playerId === viewerId &&
                                        // CR 601.2g — the generic-mana spend
                                        // choice is the LAST payment gate
                                        // (mana is already tapped/floating by
                                        // the time it's set), so it takes
                                        // precedence over every other picker
                                        // below and the payment banner.
                                        (manaSpendChoice?.container ===
                                        "cast" ? (
                                            <ManaSpendChoiceDialog
                                                choice={manaSpendChoice.choice}
                                                container="cast"
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ) : // CR 702.34a / 118.5 — the flashback "exile X
                                        // blue cards from your graveyard" cost (Flash of
                                        // Insight) needs a dedicated card picker before
                                        // the payment banner takes over.
                                        pendingCast.convokeCreatureChoice &&
                                          !pendingCast.convokeCreatureChoice
                                              .pickedCreatureIds ? (
                                            // CR 702.51 (issue #1338) — Convoke
                                            // creature picker (Hogaak). Prompts
                                            // BEFORE the delve exile picker.
                                            <ConvokeCreatureDialog
                                                choice={
                                                    pendingCast.convokeCreatureChoice
                                                }
                                                me={me}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ) : pendingCast.exileFromGraveyardChoice &&
                                          !pendingCast.exileFromGraveyardChoice
                                              .pickedCardIds ? (
                                            <CastExileCostDialog
                                                choice={
                                                    pendingCast.exileFromGraveyardChoice
                                                }
                                                me={me}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ) : pendingCast.alternativeCostHandChoice &&
                                          !pendingCast.alternativeCostHandChoice
                                              .pickedCardIds ? (
                                            // CR 118.9 — the alternative-cost hand leg
                                            // (Force of Will "exile a blue card", Foil
                                            // "discard an Island card and another card")
                                            // needs a dedicated hand-card picker before
                                            // the payment banner takes over.
                                            <CastAlternativeHandCostDialog
                                                choice={
                                                    pendingCast.alternativeCostHandChoice
                                                }
                                                me={me}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ) : (
                                            <PaymentBanner
                                                kind="cast"
                                                pendingCast={pendingCast}
                                                me={me}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ))}
                                    {pendingActivation &&
                                        pendingActivation.playerId ===
                                            viewerId &&
                                        // CR 601.2g — same precedence rule as
                                        // the cast branch above.
                                        (manaSpendChoice?.container ===
                                        "activation" ? (
                                            <ManaSpendChoiceDialog
                                                choice={manaSpendChoice.choice}
                                                container="activation"
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ) : // CR 602.1 / 118.5 — the exile-from-graveyard
                                        // cost (Night Soil) needs a dedicated card
                                        // picker before the payment banner takes over.
                                        pendingActivation.exileFromGraveyardChoice &&
                                          !pendingActivation
                                              .exileFromGraveyardChoice
                                              .pickedCardIds ? (
                                            <ExileCostDialog
                                                choice={
                                                    pendingActivation.exileFromGraveyardChoice
                                                }
                                                allPlayers={allPlayers}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ) : // CR 602.1 / 118.3 — the discard-a-card
                                        // cost (Survival of the Fittest) needs a
                                        // dedicated hand-card picker before the
                                        // payment banner takes over.
                                        pendingActivation.discardFilterChoice &&
                                          !pendingActivation.discardFilterChoice
                                              .pickedCardIds ? (
                                            <DiscardCostDialog
                                                choice={
                                                    pendingActivation.discardFilterChoice
                                                }
                                                me={me}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ) : (
                                            <PaymentBanner
                                                kind="activation"
                                                pendingActivation={
                                                    pendingActivation
                                                }
                                                me={me}
                                                gameId={gameId}
                                                playerId={viewerId}
                                            />
                                        ))}
                                    {/* CR 508.1c/1g / 701.21a — the attack-declaration
                                land tax (Flooded Woodlands) suspends the
                                declaration on a parked sacrifice choice. Without
                                a prompt the board looks frozen, so surface the
                                pick the same way casts/activations do. */}
                                    {combat?.pendingAttackSacrifice &&
                                        combat.pendingAttackSacrifice
                                            .playerId === viewerId &&
                                        !isSacrificeComplete(
                                            combat.pendingAttackSacrifice
                                        ) && (
                                            <SacrificeBanner
                                                selection={
                                                    combat.pendingAttackSacrifice
                                                }
                                            />
                                        )}
                                    {/* CR 508.1c/1g — the per-attacker MANA attack
                                tax (Propaganda / Collective Restraint) suspends
                                the declaration on a parked payment. Prompt the
                                attacking player to pay (Auto-tap / manual taps)
                                or cancel, the same way casts do. */}
                                    {combat?.pendingAttackManaTax &&
                                        combat.pendingAttackManaTax.playerId ===
                                            viewerId && (
                                            <AttackManaTaxBanner
                                                gameId={gameId}
                                                playerId={viewerId}
                                                payment={
                                                    combat.pendingAttackManaTax
                                                }
                                            />
                                        )}
                                    {pendingChoices &&
                                        pendingChoices.length > 0 &&
                                        (minimizedChoice.isMinimized &&
                                        pendingChoices[0].playerId ===
                                            viewerId ? (
                                            <MinimizedChoiceIndicator
                                                choice={pendingChoices[0]}
                                            />
                                        ) : (
                                            <PendingChoicePrompt
                                                choice={pendingChoices[0]}
                                                playerId={viewerId}
                                                gameId={gameId}
                                            />
                                        ))}
                                    {/* Fact or Fiction (ADR 0053) — the divider's
                                    3-zone drag stage / the chooser's face-up
                                    two-pile pick. Owns the surface for the
                                    chooser; the generic prompt above suppresses
                                    itself for these kinds and shows only the
                                    non-chooser's "Waiting" line. */}
                                    {pendingChoices &&
                                        pendingChoices.length > 0 &&
                                        !minimizedChoice.isMinimized &&
                                        pendingChoices[0].playerId ===
                                            viewerId &&
                                        (pendingChoices[0].kind ===
                                            "divide-piles" ||
                                            pendingChoices[0].kind ===
                                                "pick-pile") && (
                                            <PileDivisionPicker
                                                choice={pendingChoices[0]}
                                                cards={resolvePileDivisionCards(
                                                    state.players,
                                                    pendingChoices[0]
                                                )}
                                                playerId={viewerId}
                                                gameId={gameId}
                                            />
                                        )}
                                    <HandCardPick />
                                    <RevealHandView />
                                    <RevealNotificationOverlay />
                                    <PutBackPicker />

                                    {mulligan && !mulligan.bottoming && (
                                        <MulliganPrompt
                                            gameId={gameId}
                                            viewerId={viewerId}
                                            mulligan={mulligan}
                                            allPlayers={allPlayers}
                                        />
                                    )}
                                    <Controller
                                        onOpenMenu={() =>
                                            setPauseMenuOpen(true)
                                        }
                                    />
                                    {gameOver && (
                                        <GameOverDialog
                                            gameOver={gameOver}
                                            allPlayers={allPlayers}
                                            match={match ?? null}
                                            viewerId={playerId}
                                        />
                                    )}
                                    <PauseMenuDialog
                                        open={pauseMenuOpen}
                                        onOpenChange={setPauseMenuOpen}
                                        gameId={gameId}
                                        playerId={viewerId}
                                        match={match ?? null}
                                    />
                                    <ErrorToast
                                        error={pendingChoiceBuffer.lastError}
                                        gameId={gameId}
                                        onDismiss={
                                            pendingChoiceBuffer.dismissError
                                        }
                                    />
                                </main>
                            </MinimizedChoiceContext>
                        </DivideBufferContext>
                    </AttackSequenceContext>
                </PendingChoiceBufferContext>
            </SkipPhasePrefsContext>
        </GameContext>
    );
}
