// Visible "thinking" indicator for the vs-AI Bot (ADR 0001, issue #113).
//
// The bot's search runs off the UI thread under a bounded time budget, so the
// board never freezes — but the human still needs to know the opponent is
// deciding rather than stuck. This badge shows while `search` is running and
// clears the instant the bot acts. Trivial immediate passes never trip it, so
// it only appears on windows the bot actually deliberates over.

export default function BotThinkingIndicator({
    thinking,
}: {
    thinking: boolean;
}) {
    if (!thinking) return null;

    return (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white/90 shadow-lg">
            <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            Opponent is thinking…
        </div>
    );
}
