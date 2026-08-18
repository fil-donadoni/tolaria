import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { usePageVisible } from "~/hooks/usePageVisible";
import { storeSession } from "~/lib/session";
import { copyMinified } from "~/lib/clipboard";
import { Panel } from "~/components/ui/panel";
import JsonTreeView from "~/components/ui/json-tree-view";
import DebugButton from "./debug-button";
import DebugBladeScenarios from "./debug-blade-scenarios";
import DebugDbScenarios from "./debug-db-scenarios";
import DebugGenerateScenario from "./debug-generate-scenario";
import DebugSaveScenario, { type EditingScenario } from "./debug-save-scenario";

type DebugPanelProps = {
    gameId: Id<"games">;
    showAllCards: boolean;
    onToggleShowAllCards: () => void;
    debugAllActions: boolean;
    onToggleDebugAllActions: () => void;
    onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
};

export default function DebugPanel({
    gameId,
    showAllCards,
    onToggleShowAllCards,
    debugAllActions,
    onToggleDebugAllActions,
    onSwitchGame,
}: DebugPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [showScenarios, setShowScenarios] = useState(false);
    const [editingScenario, setEditingScenario] =
        useState<EditingScenario | null>(null);
    const [verbose, setVerbose] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const pageVisible = usePageVisible();

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!panelRef.current || panelRef.current.contains(target)) return;
            // The whole DEV rail counts as "inside": the AI-trace box sits in
            // the same rail, and clicking it must not dismiss this panel.
            if (
                target instanceof Element &&
                target.closest("[data-dev-rail]") !== null
            ) {
                return;
            }
            setIsOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        return () =>
            document.removeEventListener("pointerdown", handlePointerDown);
    }, [isOpen]);
    const state = useQuery(
        api.game.getFullState,
        isOpen && pageVisible ? { gameId } : "skip"
    );

    const prevStateRef = useRef<typeof state>(undefined);
    useEffect(() => {
        if (!verbose || !state) return;
        const prev = prevStateRef.current;
        prevStateRef.current = state;
        if (!prev) {
            console.log("[GRE:verbose] initial state", state);
            return;
        }
        const delta: Record<string, unknown> = {};
        if (prev.phase !== state.phase)
            delta.phase = `${prev.phase} → ${state.phase}`;
        if (prev.turn !== state.turn)
            delta.turn = `${prev.turn} → ${state.turn}`;
        if (prev.activePlayerId !== state.activePlayerId)
            delta.activePlayer = state.activePlayerId;
        if (prev.priorityPlayerId !== state.priorityPlayerId)
            delta.priority = state.priorityPlayerId;
        if (
            JSON.stringify(prev.pendingChoices) !==
            JSON.stringify(state.pendingChoices)
        )
            delta.pendingChoices = state.pendingChoices;
        if (
            JSON.stringify(prev.pendingUntapStep) !==
            JSON.stringify(state.pendingUntapStep)
        )
            delta.pendingUntapStep = state.pendingUntapStep;
        if (JSON.stringify(prev.stack) !== JSON.stringify(state.stack))
            delta.stack = state.stack;
        if (Object.keys(delta).length > 0)
            console.log("[GRE:verbose] state changed", delta);
    }, [verbose, state]);
    const game = useQuery(
        api.game.getGame,
        isOpen && pageVisible ? { gameId } : "skip"
    );
    const resetGame = useMutation(api.game.debugResetGame);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const bo3Sideboard = useMutation(api.game.debugBo3Sideboard);
    const [bo3Pending, setBo3Pending] = useState(false);
    const user = useCurrentUser();

    // One-click Bo3 between-Games flow (PRD #387 user story 35 / #397). Promotes
    // the current solo Match to Bo3, records a Game-1 result, and routes to the
    // Sideboarding step so the whole between-Games flow is exercisable at once.
    const handleBo3Sideboard = async () => {
        if (bo3Pending) return;
        setBo3Pending(true);
        try {
            await bo3Sideboard({ gameId });
        } finally {
            setBo3Pending(false);
        }
    };

    // The deck the one-click restarts clone: the first seat's, whose card
    // entries left the `games` row in issue #2506 and now come from
    // `getSeatDeck`. That query is gated on SEAT ownership, so it resolves in
    // solo / vs-AI (both handles are this user's) and for a 2-player host;
    // a 2-player JOINER gets null and the restart buttons no-op rather than
    // cloning the opponent's list.
    const sourceSeat = game?.players[0];
    const sourceCards = useQuery(
        api.game.getSeatDeck,
        isOpen && pageVisible && sourceSeat
            ? { gameId, playerId: sourceSeat.id }
            : "skip"
    );
    const sourceDeck =
        sourceSeat && sourceCards
            ? {
                  id: sourceSeat.deck.id,
                  name: sourceSeat.deck.name,
                  format: sourceSeat.deck.format,
                  cards: sourceCards.cards,
              }
            : undefined;

    const handleNewSolo = async () => {
        // Reuse the deck of the first player in the current game so the user
        // doesn't have to round-trip through the lobby just to restart.
        if (!sourceDeck) return;
        if (!user) return;
        const p1Id = `${user._id}-p1`;
        const newId = await createSoloGame({
            name: `${user.nickname}'s solo game`,
            deck: sourceDeck,
        });
        storeSession(newId, p1Id);
        onSwitchGame(newId, p1Id);
    };

    const handleNewVsAi = async () => {
        // One-click vs-AI game reusing the current first player's deck (ADR 0001,
        // issue #109). The human plays the `-p1` seat; the bot drives `-p2`.
        if (!sourceDeck) return;
        if (!user) return;
        const p1Id = `${user._id}-p1`;
        const newId = await createSoloGame({
            name: `${user.nickname} vs AI`,
            deck: sourceDeck,
            vsAi: true,
        });
        storeSession(newId, p1Id);
        onSwitchGame(newId, p1Id);
    };

    return (
        // Positioning is owned by the enclosing `DevPanelRail` — this panel only
        // sizes itself, so it can never grow over the AI-trace box.
        <div ref={panelRef} className="min-h-0 shrink-0 text-xs">
            <Panel
                density="compact"
                className="flex flex-col overflow-y-auto px-3 py-2"
            >
                {/* Toggle kept as the original compact dev affordance — the big
                    Beleren `PanelHeader` band is deliberately NOT used here. */}
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex w-full items-center justify-between text-text-muted hover:text-parchment"
                >
                    <span className="font-semibold">Debug</span>
                    <span className="text-text-disabled">
                        {isOpen ? "▲" : "▼"}
                    </span>
                </button>

                {isOpen && (
                    <div className="mt-2 flex flex-col border-t border-border-accent/20 pt-2">
                        <div className="flex flex-wrap gap-2 border-b border-border-accent/20 pb-2">
                            <DebugButton
                                onClick={() => setShowScenarios(!showScenarios)}
                            >
                                Scenarios
                            </DebugButton>
                            <DebugButton
                                onClick={() => resetGame({ gameId })}
                                variant="danger"
                            >
                                Reset Game
                            </DebugButton>
                            <DebugButton
                                onClick={() => {
                                    if (state) {
                                        copyMinified(state);
                                        setCopyFeedback(true);
                                        setTimeout(
                                            () => setCopyFeedback(false),
                                            1500
                                        );
                                    }
                                }}
                            >
                                {copyFeedback ? "Copied!" : "Copy State"}
                            </DebugButton>
                            <DebugButton onClick={onToggleShowAllCards}>
                                {showAllCards ? "Hide cards" : "Show all cards"}
                            </DebugButton>
                            <DebugButton onClick={onToggleDebugAllActions}>
                                {debugAllActions ? "Rules on" : "All actions"}
                            </DebugButton>
                            <DebugButton onClick={handleNewSolo}>
                                {game?.solo && !game?.vsAi
                                    ? "Restart Solo"
                                    : "New Solo Game"}
                            </DebugButton>
                            <DebugButton onClick={handleNewVsAi}>
                                {game?.vsAi
                                    ? "Restart vs AI"
                                    : "New vs-AI Game"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => void handleBo3Sideboard()}
                                disabled={bo3Pending}
                            >
                                {bo3Pending ? "Bo3…" : "Bo3 Sideboarding"}
                            </DebugButton>
                            <DebugButton onClick={() => setVerbose((v) => !v)}>
                                {verbose ? "Verbose ON" : "Verbose"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => {
                                    localStorage.clear();
                                    sessionStorage.clear();
                                    window.location.reload();
                                }}
                                variant="danger"
                            >
                                Clear Storage
                            </DebugButton>
                        </div>

                        {showScenarios && (
                            <div className="flex flex-col gap-1 border-b border-border-accent/20 py-2">
                                <DebugDbScenarios
                                    gameId={gameId}
                                    onEdit={(row) =>
                                        setEditingScenario({
                                            id: row._id,
                                            label: row.label,
                                            spec: row.spec,
                                        })
                                    }
                                />
                                <div className="mt-2 border-t border-border-accent/20 pt-2">
                                    <DebugBladeScenarios gameId={gameId} />
                                </div>
                                <div className="mt-2 border-t border-border-accent/20 pt-2">
                                    <DebugGenerateScenario />
                                </div>
                                <div className="mt-2 border-t border-border-accent/20 pt-2">
                                    <DebugSaveScenario
                                        key={editingScenario?.id ?? "new"}
                                        editing={editingScenario}
                                        onDone={() => setEditingScenario(null)}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="max-h-[70vh] w-100 overflow-auto pt-1 font-mono">
                            {state ? (
                                <JsonTreeView data={state} />
                            ) : (
                                <span className="text-text-muted">
                                    Loading...
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </Panel>
        </div>
    );
}
