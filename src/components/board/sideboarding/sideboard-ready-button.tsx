import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";

/** The Ready CTA (issue #9820), three states: a tall ivory plate with a soft
 *  pulsing glow when it can fire (`.ready-glow`, motion-gated in
 *  index.css); a red "⚠ Add N more to Maindeck" statement when the Maindeck
 *  is under its starting size (never a grey dead button); and, after Ready,
 *  "Ready — waiting for <opponent>…" with a spinner. */
export default function SideboardReadyButton({
    gameNumber,
    missing,
    waiting,
    waitingFor,
    onReady,
}: {
    gameNumber: number;
    /** Cards the Maindeck is short of its starting size (≤ 0 = legal). */
    missing: number;
    /** Ready is in flight or done. */
    waiting: boolean;
    waitingFor: string;
    onReady: () => void;
}) {
    const blocked = missing > 0;
    const canFire = !blocked && !waiting;
    return (
        <button
            type="button"
            onClick={onReady}
            disabled={!canFire}
            data-ready-state={
                waiting ? "waiting" : blocked ? "blocked" : "ready"
            }
            data-ready-glow={canFire ? "true" : undefined}
            className={cn(
                "flex h-12 w-full items-center justify-center gap-2 rounded-lg px-6 text-base font-semibold transition-[background,transform] md:w-auto md:min-w-72",
                canFire &&
                    "ready-glow bg-accent text-surface-base hover:bg-accent-strong active:scale-[0.98] in-data-[motion=reduced]:animate-none",
                blocked &&
                    !waiting &&
                    "cursor-not-allowed border-2 border-danger/70 bg-danger-soft text-danger-strong",
                waiting &&
                    "cursor-default border border-border-strong bg-surface-elevated text-text-muted"
            )}
        >
            {waiting ? (
                <>
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    Ready — waiting for {waitingFor}…
                </>
            ) : blocked ? (
                <>
                    <AlertTriangle className="size-4" />
                    Add {missing} more to Maindeck
                </>
            ) : (
                <>
                    Ready for game {gameNumber}
                    <ArrowRight className="size-5" strokeWidth={2.5} />
                </>
            )}
        </button>
    );
}
