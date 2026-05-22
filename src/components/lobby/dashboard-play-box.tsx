import type { Doc, Id } from "@convex/_generated/dataModel";
import type { LobbyDeck } from "~/lib/deckTypes";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import ManaSymbol from "../cards/mana-symbol";

interface DashboardPlayBoxProps {
    selectedDeck: LobbyDeck | null;
    openGames: Array<Doc<"games">> | undefined;
    onCreateSolo: () => void;
    onCreateMultiplayer: () => void;
    onJoin: (gameId: Id<"games">) => void;
    onChangeDeck: () => void;
}

export default function DashboardPlayBox({
    selectedDeck,
    openGames,
    onCreateSolo,
    onCreateMultiplayer,
    onJoin,
    onChangeDeck,
}: DashboardPlayBoxProps) {
    const canPlay = !!selectedDeck;

    return (
        <section className="flex w-full flex-col gap-5 rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-sky-500/10 p-6 shadow-lg shadow-emerald-500/10">
            <div className="flex flex-col gap-1">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
                    Play
                </h2>
                {selectedDeck ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="text-lg font-semibold text-white">
                            {selectedDeck.name}
                        </span>
                        <div className="flex items-center gap-1 text-xl">
                            {selectedDeck.colors.map((c) => (
                                <ManaSymbol key={c} symbol={c} />
                            ))}
                        </div>
                        {selectedDeck.kind === "user" && (
                            <span className="rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                                Custom
                            </span>
                        )}
                        <button
                            onClick={onChangeDeck}
                            className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/20"
                        >
                            Change deck
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-white/60">
                        Select a deck to start playing.
                    </p>
                )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Button
                    type="button"
                    onClick={onCreateSolo}
                    disabled={!canPlay}
                    className={cn(
                        "h-14 w-full rounded-xl text-base font-semibold",
                        "bg-emerald-400 text-emerald-950 hover:bg-emerald-300",
                        "disabled:bg-white/10 disabled:text-white/40"
                    )}
                >
                    Solo Game
                </Button>
                <Button
                    type="button"
                    onClick={onCreateMultiplayer}
                    disabled={!canPlay}
                    variant="outline"
                    className="h-14 w-full rounded-xl border-white/20 bg-white/5 text-base font-semibold text-white hover:bg-white/10"
                >
                    Create Multiplayer
                </Button>
            </div>

            {openGames && openGames.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
                        Open games to join
                    </p>
                    <div className="flex flex-col gap-2">
                        {openGames.map((g) => (
                            <button
                                key={g._id}
                                onClick={() => onJoin(g._id)}
                                disabled={!canPlay}
                                className="flex items-center justify-between rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <span className="font-medium">{g.name}</span>
                                <span className="text-xs text-white/60">
                                    {g.players.length}/2 · Join →
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}
