import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MulliganState, Player } from "~/types/game";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";

const STARTING_HAND_SIZE = 7;

/** Pre-game mulligan declaration prompt (CR 103.5, London mulligan). Shown
 *  while the engine is in `phase === "MULLIGAN"` and not yet in the bottoming
 *  step. The currently-declaring player sees Keep / Mulligan-to-N buttons;
 *  the opponent sees a "waiting for X" message. Bottoming is handled by the
 *  generic `PendingChoicePrompt` (kind: "mulligan-bottom").
 *
 *  Issue #1813 — no board tap is ever needed to decide Keep/Mulligan, so
 *  this stays on the default (non-`pinned`) `usePromptBannerPosition` call:
 *  vertically centered on portrait like any other non-targeting prompt. */
export default function MulliganPrompt({
    gameId,
    viewerId,
    mulligan,
    allPlayers,
}: {
    gameId: Id<"games">;
    viewerId: string;
    mulligan: MulliganState;
    allPlayers: Player[];
}) {
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition();
    const declareMulligan = useMutation(api.game.declareMulligan);
    const [isBusy, setIsBusy] = useState(false);

    const declaringPlayer = allPlayers.find(
        (p) => p.id === mulligan.declaringPlayerId
    );
    const isDeclarer = mulligan.declaringPlayerId === viewerId;
    const viewerIdx = allPlayers.findIndex((p) => p.id === viewerId);
    const viewerMulls = viewerIdx >= 0 ? mulligan.mulligansTaken[viewerIdx] : 0;
    const nextHandSize = STARTING_HAND_SIZE - viewerMulls - 1;

    const onKeep = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await declareMulligan({
                gameId,
                playerId: viewerId,
                decision: "keep",
            });
        } finally {
            setIsBusy(false);
        }
    };
    const onMull = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await declareMulligan({
                gameId,
                playerId: viewerId,
                decision: "mull",
            });
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. `pointer-events-none`
                / `pointer-events-auto` now come from the hook itself (issue
                #1762 review) — every banner gets the gutter-tap fix for
                free instead of re-declaring it per file. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel
                    density="compact"
                    className="flex flex-col items-center gap-3 px-6 py-4"
                >
                    <div className="flex flex-col items-center gap-1 w-full">
                        {/* v4 (ADR 0103 §4, issue #2730): title off Beleren
                            onto the chrome display face; rule is the shared
                            `.panel-rule` hairline, not the six-times-repeated
                            gold-gradient divider. */}
                        <p className="text-display text-sm text-text">
                            Mulligan
                        </p>
                        <div className="panel-rule h-px w-full" />
                        <p className="text-text-muted text-xs">
                            {viewerMulls > 0
                                ? `you have taken ${viewerMulls} mulligan${viewerMulls === 1 ? "" : "s"}`
                                : "review your opening hand"}
                        </p>
                    </div>

                    {isDeclarer ? (
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={onKeep}
                                disabled={isBusy}
                            >
                                Keep
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={onMull}
                                disabled={isBusy || nextHandSize < 0}
                            >
                                {nextHandSize >= 0
                                    ? `Mulligan to ${nextHandSize}`
                                    : "Cannot mulligan further"}
                            </Button>
                        </div>
                    ) : (
                        <p className="text-text-muted text-xs">
                            Waiting for{" "}
                            <span className="text-display text-text">
                                {declaringPlayer?.name ?? "opponent"}
                            </span>
                        </p>
                    )}
                </Panel>
            </div>
        </div>
    );
}
