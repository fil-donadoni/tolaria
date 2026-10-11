// Last Match (PRD #5334 stories 1–4, issue #5344): the remembered setup as
// the home's first, widest tile — both decks' art split by a diagonal, "X vs
// Y", the setup as a small uppercase line, then "Play again" (starts it as
// is) and "change setup" (opens the flow on it).
import type { LastMatchView } from "~/lib/lobbyHome";
import HomeArtCard from "./home-art-card";

interface LastMatchTileProps {
    view: LastMatchView;
    onPlayAgain: () => void;
    onChangeSetup: () => void;
    busy: boolean;
    className?: string;
}

export default function LastMatchTile({
    view,
    onPlayAgain,
    onChangeSetup,
    busy,
    className,
}: LastMatchTileProps) {
    return (
        <HomeArtCard
            art={
                view.opponentArt === undefined
                    ? { deck: view.myArt }
                    : { split: [view.myArt, view.opponentArt] }
            }
            title={view.title}
            meta={`Last Match · ${view.setupLine}`}
            titleClass="text-2xl md:text-4xl"
            className={className}
            seam={{ "data-home-section": "last-match" }}
        >
            <span className="mt-2 flex w-full items-center justify-between gap-3">
                <button
                    type="button"
                    data-home-play-again
                    onClick={onPlayAgain}
                    disabled={busy}
                    className="rounded-sm bg-parchment px-3 py-1.5 text-sm font-semibold text-surface-base transition hover:bg-parchment/90 disabled:opacity-60"
                >
                    {busy ? "Starting…" : "Play again →"}
                </button>
                <button
                    type="button"
                    onClick={onChangeSetup}
                    className="text-sm text-text-muted underline hover:text-parchment"
                >
                    change setup
                </button>
            </span>
        </HomeArtCard>
    );
}
