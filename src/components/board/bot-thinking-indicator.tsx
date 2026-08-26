// Visible "thinking" indicator for the vs-AI Bot (ADR 0001, issue #113).
//
// The bot's search runs off the UI thread under a bounded time budget, so the
// board never freezes — but the human still needs to know the opponent is
// deciding rather than stuck. This badge shows while `search` is running and
// clears the instant the bot acts. Trivial immediate passes never trip it, so
// it only appears on windows the bot actually deliberates over.
//
// v4 (ADR 0103 §3/§5, issue #2730): a quiet HUD chip — hairline plate, a
// STATIC muted dot — replacing the bespoke `bg-black/70` pill (a raw colour,
// not a design token) with its pulsing `signal-pending` dot. The prototype's
// `.px-hud` reserves the pulsing pending-coloured dot for "needs YOUR action"
// (`MinimizedChoiceIndicator`); "the opponent is thinking" is calm information,
// not a call to act, so the dot here is static and muted (`.dot.think`).
import { cn } from "~/lib/utils";
import { V4_PLATE } from "~/lib/board-chrome-v4";

export default function BotThinkingIndicator({
    thinking,
}: {
    thinking: boolean;
}) {
    if (!thinking) return null;

    return (
        <div
            className={cn(
                V4_PLATE,
                "absolute left-1/2 top-3 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-text-muted"
            )}
        >
            <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-text-disabled"
            />
            Opponent is thinking…
        </div>
    );
}
