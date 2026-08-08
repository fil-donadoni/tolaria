import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ProjectedManualCard } from "@convex/manual";
import type { CardInstance } from "~/types/game";
import GameDialog from "~/components/ui/game-dialog";
import CardImage from "../cards/card-image";
import ManualCardMenu from "./manual-card-menu";

/** What the board asks this dialog to show: whose library, and how deep.
 *  `n: undefined` is "Peek all" — the whole library, in order. */
export type ManualPeekRequest = {
    playerId: string;
    playerName: string;
    n?: number;
    /** Bumped per request so re-peeking the same depth re-opens the dialog. */
    nonce: number;
};

/**
 * The Manual Game's library peek (manual-mode QA round 3, item 2).
 *
 * "Peek top N…" used to write a log line and NOTHING else — the cards were
 * named in an overlay the player had to open separately, in an entry that
 * (before the naming fix) read as a row of raw print ids. At a table, peeking
 * means looking at the cards, so this dialog is what the verb now opens; the
 * log line still fires, as the opponent-facing record that it happened.
 *
 * The card list comes from `getManualLibraryTop`, NOT from the projected
 * state: the library is `{ count }` for everyone there and must stay so
 * (`projectManualState`), because library order is private until a player
 * takes the action that looks at it. Being a live query, the open dialog
 * follows the library — draw a card behind it and the top shifts.
 *
 * Each tile carries the same verb menu a pile browse dialog gives its cards
 * (`ManualCardMenu`), so this doubles as the library SEARCH surface: pulling
 * the fourth card down to hand is a left click, not four mills. Reordering the
 * library is still out of scope — that needs a verb `moveCard`'s
 * top-or-bottom index does not express.
 */
export default function ManualPeekDialog({
    gameId,
    request,
    onClose,
}: {
    gameId: Id<"games">;
    request: ManualPeekRequest | null;
    onClose: () => void;
}) {
    const result = useQuery(
        api.game.getManualLibraryTop,
        request ? { gameId, playerId: request.playerId, n: request.n } : "skip"
    );

    if (!request) return null;

    const cards = (result?.cards ?? []) as ProjectedManualCard[];
    const title =
        request.n === undefined
            ? `${request.playerName}'s library`
            : `Top ${request.n} of ${request.playerName}'s library`;

    return (
        <GameDialog
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={title}
            subtitle={
                result
                    ? `${cards.length} shown · ${result.libraryCount} in library`
                    : "Loading…"
            }
            size="wide"
            density="compact-mobile"
        >
            {cards.length === 0 ? (
                <p className="text-sm text-text-muted">
                    {result ? "The library is empty." : "Loading…"}
                </p>
            ) : (
                <div className="max-h-[60vh] overflow-y-auto">
                    {/* Art only — no ordinal, no caption. The card image
                        already carries the name, and the list reads top-first
                        in wrap order, so a numbered caption under every tile
                        was noise on a 50-card library. */}
                    <ol className="flex flex-wrap gap-2">
                        {cards.map((card) => (
                            <li key={card.id} className="aspect-5/7 w-24">
                                {/* Interactive, like every other pile card:
                                    left-click opens the move verbs for a
                                    LIBRARY card, so "put this third card onto
                                    the battlefield" needs no milling. */}
                                <ManualCardMenu
                                    card={card as unknown as CardInstance}
                                >
                                    <CardImage
                                        card={card as unknown as CardInstance}
                                        lazy
                                    />
                                </ManualCardMenu>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </GameDialog>
    );
}
