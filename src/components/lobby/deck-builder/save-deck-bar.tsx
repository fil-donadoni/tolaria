interface SaveDeckBarProps {
    name: string;
    onChangeName: (name: string) => void;
    onDone: () => void;
    cardCount: number;
}

export default function SaveDeckBar({
    name,
    onChangeName,
    onDone,
    cardCount,
}: SaveDeckBarProps) {
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onDone();
            }}
            className="flex items-center gap-3 border-t border-white/10 bg-black/40 px-6 py-3"
        >
            <span className="text-xs uppercase tracking-wide text-white/40">
                {cardCount} cards
            </span>
            <input
                type="text"
                value={name}
                onChange={(e) => onChangeName(e.target.value)}
                placeholder="Deck name"
                className="flex-1 max-w-md rounded border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
            />
            <span className="text-[10px] uppercase tracking-wide text-emerald-400/70">
                Auto-saved
            </span>
            <button
                type="submit"
                className="rounded bg-emerald-500/80 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
            >
                Done
            </button>
        </form>
    );
}
