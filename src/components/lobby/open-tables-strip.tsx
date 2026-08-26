import type { Doc, Id } from "@convex/_generated/dataModel";
import type { PlayMode } from "~/lib/session";
import { cn } from "~/lib/utils";

/** An open (waiting) game enriched with its owning Match's format (PRD #387 /
 *  #397). The joiner inherits the creator's `bestOf`, so the format is shown in
 *  the join row BEFORE committing. */
export type OpenGame = Doc<"games"> & { bestOf: 1 | 3 };

interface OpenTablesStripProps {
    openGames: OpenGame[] | undefined;
    mode: PlayMode;
    onJoin: (gameId: Id<"games">) => void;
    /** The Loadout's own gate (legal, mode-matching, non-empty-if-manual deck,
     *  nothing in flight, no active game). Passed in rather than recomputed:
     *  joining a table is the same commitment as opening one, so it must never
     *  be offered under a condition the primary action refuses. */
    canAct: boolean;
}

/**
 * Tables other players have opened and are waiting at (issue #2726 —
 * extracted from the v3 Play box, which is what the Mode Tiles replaced).
 *
 * Sits under the Mode Tiles because it is the "Open a table" tile's mirror
 * image: the tile hosts a seat, this joins one somebody else already opened.
 * It renders nothing at all when no table is waiting, which is the usual case
 * — a permanently-present empty region would cost the one-viewport budget
 * every session for a row that is almost always empty.
 */
export default function OpenTablesStrip({
    openGames,
    mode,
    onJoin,
    canAct,
}: OpenTablesStripProps) {
    if (!openGames || openGames.length === 0) return null;
    const isCockatrice = mode === "cockatrice";

    return (
        <section className="flex flex-col gap-1.5">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Open tables to join
            </h2>
            <div className="flex flex-col gap-2">
                {openGames.map((g) => {
                    // A table's mode is fixed at creation and the join
                    // mutations are mode-exclusive (ADR 0080), so a deck/mode
                    // mismatch can only produce a server rejection — disable
                    // the row instead.
                    const tableIsManual = g.mode === "manual";
                    const rowMatchesMode = tableIsManual === isCockatrice;
                    const canJoin = canAct && rowMatchesMode;
                    return (
                        <button
                            key={g._id}
                            type="button"
                            onClick={() => onJoin(g._id)}
                            disabled={!canJoin}
                            title={
                                rowMatchesMode
                                    ? undefined
                                    : tableIsManual
                                      ? "This is a Manual Game — switch to Cockatrice mode to join."
                                      : "This is an Arena game — switch to Arena mode to join."
                            }
                            className={cn(
                                "flex items-center justify-between gap-3 rounded-sm border px-3 py-2 text-sm transition",
                                "border-[var(--hairline)] bg-surface/70 text-text hover:border-[var(--hairline-strong)]",
                                "disabled:cursor-not-allowed disabled:opacity-40"
                            )}
                        >
                            <span className="flex min-w-0 items-center gap-2 font-medium">
                                <span className="truncate">{g.name}</span>
                                <span className="shrink-0 rounded-sm border border-[var(--hairline-strong)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                    {g.bestOf === 3 ? "Bo3" : "Bo1"} Match
                                </span>
                                {tableIsManual && (
                                    <span className="shrink-0 rounded-sm border border-[var(--hairline)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                        Manual Game
                                    </span>
                                )}
                            </span>
                            <span className="shrink-0 text-xs text-text-muted">
                                {g.players.length}/2 · Join →
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
