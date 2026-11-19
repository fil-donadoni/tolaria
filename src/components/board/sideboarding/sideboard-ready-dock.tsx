import type { ReactNode } from "react";
import type { PublicMatch } from "@convex/matches";
import SideboardOpponentStatus from "../sideboard-opponent-status";
import SideboardDeckStatus from "./sideboard-deck-status";
import SideboardPlayDrawSwitch from "./sideboard-play-draw-switch";
import SideboardReadyButton from "./sideboard-ready-button";
import { cn } from "~/lib/utils";

/** The Ready dock (issue #9820): three blocks read left → right as the
 *  decision — deck status, the chooser's Play first / Draw first, then the
 *  opponent status and the CTA. On a phone they stack and the opponent
 *  status rides the deck-status row. The elevated surface, top shadow and
 *  top border (ivory when legal, red when not) set it apart from the deck. */
export default function SideboardReadyDock({
    mainCount,
    lockedSize,
    sideCount,
    ins,
    outs,
    gameNumber,
    isChooser,
    playDraw,
    onPlayDraw,
    opponent,
    countdown,
    waiting,
    onReady,
}: {
    mainCount: number;
    lockedSize: number;
    sideCount: number;
    ins: number;
    outs: number;
    /** The game about to start. */
    gameNumber: number;
    isChooser: boolean;
    playDraw: "play" | "draw";
    onPlayDraw: (value: "play" | "draw") => void;
    opponent: PublicMatch["players"][number] | null;
    countdown: ReactNode;
    waiting: boolean;
    onReady: () => void;
}) {
    const legal = mainCount >= lockedSize;
    const others = (
        <>
            {countdown}
            {opponent && <SideboardOpponentStatus opponent={opponent} />}
        </>
    );
    return (
        <div
            data-ready-dock={legal ? "legal" : "short"}
            className={cn(
                "flex shrink-0 flex-col gap-2.5 border-t-2 bg-surface-elevated px-4 py-3 shadow-[0_-12px_24px_-12px_rgba(0,0,0,.6)] transition-colors sm:px-6 md:flex-row md:items-center md:gap-6 md:py-4",
                legal ? "border-t-accent/50" : "border-t-danger/60"
            )}
        >
            <SideboardDeckStatus
                mainCount={mainCount}
                lockedSize={lockedSize}
                sideCount={sideCount}
                ins={ins}
                outs={outs}
                trailing={countdown || opponent ? others : undefined}
            />
            {isChooser && (
                <SideboardPlayDrawSwitch
                    lostGame={gameNumber - 1}
                    value={playDraw}
                    onChange={onPlayDraw}
                    disabled={waiting}
                />
            )}
            <div
                className={cn(
                    "flex flex-col gap-2 md:items-end",
                    !isChooser && "md:ml-auto"
                )}
            >
                {(countdown || opponent) && (
                    <div className="hidden items-center gap-3 md:flex md:justify-end">
                        {others}
                    </div>
                )}
                <SideboardReadyButton
                    gameNumber={gameNumber}
                    missing={lockedSize - mainCount}
                    waiting={waiting}
                    waitingFor={opponent?.name ?? "the next game"}
                    onReady={onReady}
                />
            </div>
        </div>
    );
}
