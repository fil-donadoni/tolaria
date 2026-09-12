import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePageVisible } from "~/hooks/usePageVisible";
import { copyMinified } from "~/lib/clipboard";
import DebugButton from "./debug-button";
import DebugCopyScenario from "./debug-copy-scenario";
import DebugBladeScenarios from "./debug-blade-scenarios";
import DebugDbScenarios from "./debug-db-scenarios";
import DebugGenerateScenario from "./debug-generate-scenario";
import DebugSaveScenario, { type EditingScenario } from "./debug-save-scenario";

type DebugPanelProps = {
    gameId: Id<"games">;
    /** The seat THIS client occupies (the session's `playerId`) — the seat a
     *  copied scenario spec is written from. */
    playerId: string;
};

/**
 * The body of the debug sheet (issue #3403, PRD #3397): THREE actions and
 * nothing else — the scenario list, reset game, copy state.
 *
 * What left, and why it is not coming back as a prop: this surface ships to
 * testers in production now, so it carries only what a tester uses to report a
 * Bot decision. "Show all cards" and "All actions" bypassed the rules engine's
 * own view/validation gates; "New solo game", "New vs-AI game" and "Bo3
 * sideboarding" were lobby shortcuts that belong in the lobby; "Verbose" wrote
 * to a console a tester does not have open; "Clear storage" wiped the session
 * of whoever pressed it. The raw state tree went with them — it was the
 * panel's whole height budget and unreadable at phone width — but "Copy state"
 * still puts the same minified payload on the clipboard, which is what an
 * issue attachment actually needs.
 *
 * It does NOT position or collapse itself: {@link DebugSheet} owns the
 * anchoring, the open/closed state and the shortcut, and only mounts this while
 * the sheet is open — which is what keeps `getFullState` (a fat, admin-view
 * query) unsubscribed the rest of the time.
 */
export default function DebugPanel({ gameId, playerId }: DebugPanelProps) {
    const [showScenarios, setShowScenarios] = useState(false);
    const [editingScenario, setEditingScenario] =
        useState<EditingScenario | null>(null);
    const [copyFeedback, setCopyFeedback] = useState(false);
    const pageVisible = usePageVisible();

    const state = useQuery(
        api.game.getFullState,
        pageVisible ? { gameId } : "skip"
    );
    const resetGame = useMutation(api.game.debugResetGame);

    return (
        <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap gap-2">
                <DebugButton onClick={() => setShowScenarios(!showScenarios)}>
                    Scenarios
                </DebugButton>
                <DebugButton
                    onClick={() => void resetGame({ gameId })}
                    variant="danger"
                >
                    Reset Game
                </DebugButton>
                <DebugButton
                    onClick={() => {
                        if (!state) return;
                        copyMinified(state);
                        setCopyFeedback(true);
                        setTimeout(() => setCopyFeedback(false), 1500);
                    }}
                >
                    {copyFeedback ? "Copied!" : "Copy State"}
                </DebugButton>
            </div>

            {showScenarios && (
                <div className="mt-3 flex flex-col gap-3 border-t border-border-accent/40 pt-3">
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
                    <div className="border-t border-border-accent/40 pt-3">
                        <DebugBladeScenarios gameId={gameId} />
                    </div>
                    {/* "Copy as scenario" authors a spec FROM the live board,
                        so it belongs with the scenario surface rather than in
                        the top action row, which issue #3403 fixes at three. */}
                    <div className="border-t border-border-accent/40 pt-3">
                        <DebugCopyScenario state={state} mySeatId={playerId} />
                    </div>
                    <div className="border-t border-border-accent/40 pt-3">
                        <DebugGenerateScenario />
                    </div>
                    <div className="border-t border-border-accent/40 pt-3">
                        <DebugSaveScenario
                            key={editingScenario?.id ?? "new"}
                            editing={editingScenario}
                            // The sheet body IS a scroll port
                            // (`[data-debug-sheet-body]`), so the form's head
                            // can pin inside it (issue #3494).
                            pinnedHead
                            onDone={() => setEditingScenario(null)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
