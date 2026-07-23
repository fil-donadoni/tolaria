import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JSONTree } from "react-json-tree";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { usePageVisible } from "~/hooks/usePageVisible";
import { storeSession } from "~/lib/session";
import { copyMinified } from "~/lib/clipboard";
import { Panel } from "~/components/ui/panel";
import DebugButton from "./debug-button";
import DebugBladeScenarios from "./debug-blade-scenarios";
import DebugDbScenarios from "./debug-db-scenarios";
import DebugGenerateScenario from "./debug-generate-scenario";
import DebugSaveScenario, { type EditingScenario } from "./debug-save-scenario";

/** JSON tree palette, mapped onto the Antique Bronze semantic tokens (ADR 0007)
 *  so the state dump reads as part of the design system instead of the stock
 *  Monokai scheme. `react-json-tree` needs literal colours, so the token values
 *  are inlined here — keep in sync with `@theme` in `src/index.css`. */
const theme = {
    scheme: "tolaria",
    base00: "transparent",
    base01: "#241d12" /* surface-elevated */,
    base02: "#2e2516" /* border-subtle */,
    base03: "#968a68" /* text-disabled */,
    base04: "#b7a984" /* text-muted */,
    base05: "#e9e0cb" /* text */,
    base06: "#f3ead2" /* parchment */,
    base07: "#f3ead2" /* parchment */,
    base08: "#b1473a" /* danger */,
    base09: "#ecc878" /* accent-strong */,
    base0A: "#c9a24b" /* accent */,
    base0B: "#6fa05a" /* success */,
    base0C: "#9cc6d4" /* secondary-accent-strong */,
    base0D: "#5f97a8" /* secondary-accent */,
    base0E: "#a78bfa" /* signal-target */,
    base0F: "#c9a24b" /* accent */,
};

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

    const handleNewSolo = async () => {
        // Reuse the deck of the first player in the current game so the user
        // doesn't have to round-trip through the lobby just to restart.
        const sourceDeck = game?.players[0]?.deck;
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
        const sourceDeck = game?.players[0]?.deck;
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
                                <JSONTree
                                    data={state}
                                    theme={theme}
                                    invertTheme={false}
                                    // Collapsed by default — expand on demand.
                                    shouldExpandNodeInitially={() => false}
                                />
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
