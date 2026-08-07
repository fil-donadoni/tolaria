import { useCallback, useMemo, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { ProjectedManualGameState } from "@convex/manual";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
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
} from "~/hooks/useDivideBuffer";
import {
    MinimizedChoiceContext,
    useMinimizedChoiceState,
} from "~/hooks/useMinimizedChoice";
import { BattlefieldInteractionProvider } from "~/hooks/useBattlefieldInteractionContext";
import { PlayerInteractionProvider } from "~/hooks/usePlayerInteractionContext";
import { PileActionsProvider } from "~/hooks/usePileActionsContext";
import { ControllerActionsContext } from "~/hooks/controllerActionsContext";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { useViewportMode } from "~/hooks/useViewportMode";
import { useViewportHeight } from "~/hooks/useViewportHeight";
import { useManualDispatch } from "~/hooks/useManualDispatch";
import { useManualDrag } from "~/hooks/useManualDrag";
import { useFullCatalogue } from "~/lib/fullCatalogue";
import {
    landscapeCardMetrics,
    makeLandscapeHandLayout,
} from "~/lib/landscape-board-bands";
import { adaptManualPlayers } from "~/lib/manual-board-adapter";
import { makeCatalogueRowLookup } from "~/lib/manual-band";
import { makeManualBattlefieldInteraction } from "~/lib/manual-battlefield-interaction";
import { makeManualControllerActions } from "~/lib/manual-controller-actions";
import { makeManualGameContext } from "~/lib/manual-game-context";
import { makeManualPileActions } from "~/lib/manual-pile-actions";
import { makeManualPlayerInteraction } from "~/lib/manual-player-interaction";
import { makeManualRowClassifier } from "~/lib/manual-row-classifier";
import { indexManualCards, type ManualRuntime } from "~/lib/manual-runtime";
import BoardBackground from "./board-background";
import BoardSurface from "./board-surface";
import Controller from "./controller";
import ManualLogSurface from "./manual-log-surface";

/** A Manual Game never re-points the client session at another game — that is
 *  the sideboarding flow's affordance and Manual Mode has no match structure
 *  (ADR 0080). The inert context still requires the field. */
const NO_SWITCH_GAME = () => {};

/** The Manual Board (PRD #2162, issue #2169): the SHARED spatial board surface
 *  with manual behaviour injected at its seams, and nothing hand-written of its
 *  own.
 *
 *  What the player inherits rather than this file rebuilding it: the board
 *  surface, spatial rows with creatures forward, viewport-derived card sizing,
 *  3D tilt, hover zoom, cross-zone flight, the 90° tapped rotation, the
 *  nameplates, the pile columns and both mobile layouts.
 *
 *  What is injected, and where each seam was opened:
 *  - the battlefield interaction hook (#2166) — click taps, and the manual verb
 *    list rides the shared ability menu / touch action sheet;
 *  - the battlefield ROW classifier (#2166) — off the Full Catalogue type line
 *    plus the card's explicit lane (#2168), never a hydrated `CardDefinition`;
 *  - the controller's action descriptors (#2167) — the six manual verbs
 *    (including "Log", issue #2172), and explicitly no Pass, no Attack all,
 *    no auto-pass;
 *  - the player-nameplate interaction (#2169) — life by wheel / click / typed
 *    total, the affordance the deleted `LifeBar` carried;
 *  - the pile verbs (#2169) — the library's draw / mill / exile / peek /
 *    shuffle and the graveyard-and-exile "move a card out", replacing the GRE
 *    `api.game.drawCard` family that has no `gameStates` row to land in here.
 *
 *  Two things are OPTED OUT of rather than injected, both presentational: the
 *  priority indicator (Manual Mode has no priority) and the interactive hand
 *  (its cards dispatch GRE casts). Hand cards move by drag instead.
 *
 *  The log's open/closed state (issue #2172) lives here as plain `useState` —
 *  it is a view-only toggle, not a manual verb, so it has no place on
 *  {@link ManualRuntime}/`ManualDispatch` alongside the real `manual*`
 *  mutations. {@link ManualLogSurface} mounts as a SIBLING of `<main>` below,
 *  not a descendant — see its own doc comment for why that DOM position is
 *  load-bearing for `useManualDrag`'s off-board release detection.
 *
 *  And one thing is contained entirely here: the inert {@link GameContext} plus
 *  the five sibling providers `BoardSurface`'s subtree consumes. Every one of
 *  those contexts throws when absent, so a board with no GRE state still has to
 *  supply a complete, empty one — see `manual-game-context.ts`. No shared
 *  component was changed to tolerate their absence. */
export default function ManualBoardView({
    gameId,
    viewerId,
    state,
}: {
    gameId: Id<"games">;
    viewerId: string;
    state: ProjectedManualGameState;
}) {
    // Same viewport plumbing `board.tsx` computes once for the GRE board, so
    // both boards agree about which of the three layouts is live.
    const isPortrait = useIsPortrait();
    const landscapeCompact = useViewportMode() === "landscape-compact";
    const viewportHeight = useViewportHeight();
    const landscapeCards = useMemo(
        () => landscapeCardMetrics(viewportHeight),
        [viewportHeight]
    );
    const landscapeHandLayout = useMemo(
        () => makeLandscapeHandLayout(landscapeCards.cardWidth),
        [landscapeCards.cardWidth]
    );

    // Issue #2172 — collapsed by default, opened from the controller's "Log"
    // action. Plain view state: the log surface reads it directly, the
    // controller descriptor only needs a way to flip it open.
    const [logOpen, setLogOpen] = useState(false);
    const openLog = useCallback(() => setLogOpen(true), []);
    const closeLog = useCallback(() => setLogOpen(false), []);

    const dispatch = useManualDispatch(gameId);
    // The row classifier reads type lines off the Full Catalogue (#2168):
    // ADR 0080 forbids hydrating a `CardDefinition` for a manual card, so the
    // catalogue row IS the type oracle. While it loads, `rows` is undefined and
    // every unset-lane permanent falls to the back row — the documented
    // fail-safe, never a crash.
    const { rows } = useFullCatalogue();

    const cardById = useMemo(() => indexManualCards(state), [state]);
    const runtime = useMemo<ManualRuntime>(
        () => ({ viewerId, state, cardById, dispatch }),
        [viewerId, state, cardById, dispatch]
    );

    const allPlayers = useMemo(() => adaptManualPlayers(state), [state]);
    const me = allPlayers.find((p) => p.id === viewerId);
    const opponent = allPlayers.find((p) => p.id !== viewerId);
    // Opponent first, viewer second — the ordering `BoardPiles` /
    // `BoardPortraitChips` expect.
    const orderedPlayers = useMemo(
        () => [opponent, me].filter((p): p is Player => p !== undefined),
        [opponent, me]
    );

    const lookupRow = useMemo(() => makeCatalogueRowLookup(rows), [rows]);
    const rowClassifier = useMemo(
        () => makeManualRowClassifier(cardById, lookupRow),
        [cardById, lookupRow]
    );

    const battlefieldInteraction = useMemo(
        () => makeManualBattlefieldInteraction(runtime),
        [runtime]
    );
    const playerInteraction = useMemo(
        () => makeManualPlayerInteraction(runtime),
        [runtime]
    );
    const pileActions = useMemo(
        () => makeManualPileActions(runtime),
        [runtime]
    );
    const controllerActions = useMemo(
        () => makeManualControllerActions(runtime, { onOpenLog: openLog }),
        [runtime, openLog]
    );
    const gameContext = useMemo(
        () =>
            makeManualGameContext({
                gameId,
                viewerId,
                state,
                allPlayers,
                onSwitchGame: NO_SWITCH_GAME,
            }),
        [gameId, viewerId, state, allPlayers]
    );

    const drag = useManualDrag(runtime);

    // The five sibling providers `BoardSurface`'s subtree consumes, each fed an
    // inert state: there is no pending choice, no divide selection, no attack
    // sequence and no minimizable dialog in a Manual Game.
    const skipPhasePrefs = useSkipPhasePrefsState();
    const pendingChoiceBuffer = usePendingChoiceBufferState({
        gameId,
        playerId: viewerId,
        activeChoice: undefined,
    });
    const attackSequence = useAttackSequenceState("manual");
    const divideBuffer = useDivideBufferState({
        gameId,
        pendingTarget: undefined,
    });
    const minimizedChoice = useMinimizedChoiceState(undefined);

    return (
        <>
            <GameContext value={gameContext}>
                <SkipPhasePrefsContext value={skipPhasePrefs}>
                    <PendingChoiceBufferContext value={pendingChoiceBuffer}>
                        <AttackSequenceContext value={attackSequence}>
                            <DivideBufferContext value={divideBuffer}>
                                <MinimizedChoiceContext value={minimizedChoice}>
                                    <BattlefieldInteractionProvider
                                        value={battlefieldInteraction}
                                    >
                                        <PlayerInteractionProvider
                                            value={playerInteraction}
                                        >
                                            <PileActionsProvider
                                                value={pileActions}
                                            >
                                                <ControllerActionsContext
                                                    value={controllerActions}
                                                >
                                                    <main
                                                        // The drag binds only
                                                        // `pointerdown` here; move
                                                        // / up / cancel live on the
                                                        // window so a release over
                                                        // the sibling log surface
                                                        // (issue #2172) still
                                                        // terminates the gesture
                                                        // (see `useManualDrag`).
                                                        // `data-manual-board` is
                                                        // load-bearing for it: the
                                                        // hook reads it to tell a
                                                        // release over the board
                                                        // from one over the log.
                                                        data-manual-board
                                                        className="flex h-full w-full flex-col relative overflow-hidden select-none"
                                                        onPointerDown={
                                                            drag.handlers
                                                                .onPointerDown
                                                        }
                                                        onClickCapture={
                                                            drag.handlers
                                                                .onClickCapture
                                                        }
                                                    >
                                                        <BoardBackground />
                                                        <BoardSurface
                                                            opponent={opponent}
                                                            me={me}
                                                            orderedPlayers={
                                                                orderedPlayers
                                                            }
                                                            viewerId={viewerId}
                                                            activePlayerId={
                                                                state.activePlayerId
                                                            }
                                                            stackItems={[]}
                                                            isPortrait={
                                                                isPortrait
                                                            }
                                                            landscapeCompact={
                                                                landscapeCompact
                                                            }
                                                            viewportHeight={
                                                                viewportHeight
                                                            }
                                                            landscapeCards={
                                                                landscapeCards
                                                            }
                                                            landscapeHandLayout={
                                                                landscapeHandLayout
                                                            }
                                                            showPriorityIndicator={
                                                                false
                                                            }
                                                            handInteractive={
                                                                false
                                                            }
                                                            rowClassifier={
                                                                rowClassifier
                                                            }
                                                        />
                                                        <Controller
                                                            onOpenMenu={
                                                                NO_SWITCH_GAME
                                                            }
                                                        />
                                                        {drag.ghost}
                                                    </main>
                                                </ControllerActionsContext>
                                            </PileActionsProvider>
                                        </PlayerInteractionProvider>
                                    </BattlefieldInteractionProvider>
                                </MinimizedChoiceContext>
                            </DivideBufferContext>
                        </AttackSequenceContext>
                    </PendingChoiceBufferContext>
                </SkipPhasePrefsContext>
            </GameContext>
            {/* Sibling of `<main>`, not a descendant — see
                `manual-log-surface.tsx`'s doc comment for why. */}
            <ManualLogSurface
                gameId={gameId}
                open={logOpen}
                onClose={closeLog}
            />
        </>
    );
}
