import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import CardsPile from "./cards-pile";
import LibrarySearchConfirm from "./library-search-confirm";
import { buildLibraryPileModel } from "~/lib/library-knowledge";
import { orderLibrarySearchCards } from "~/lib/library-search-order";

export default function PlayerLibrary({
    player,
    open,
    onOpenChange,
}: {
    player: Player;
    /** Controlled-open (portrait chip, #336). Drives the normal library browse
     *  dialog; an active library pick keeps using its own `forceOpen` modal. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const { gameId, playerId, debugAllActions, pendingChoices } =
        useGameContext();
    const draw = useMutation(api.game.drawCard);
    const millCard = useMutation(api.game.mill);
    const exile = useMutation(api.game.exileFromLibrary);
    const bufferCtx = usePendingChoiceBuffer();
    const { isMinimized, minimize } = useMinimizedChoice();
    const isMe = player.id === playerId;

    // CR 401.4 / 701.19: while a `search-library` choice is active and the
    // VIEWER is its chooser, the projection exposes the SEARCHED library as
    // `librarySearch` on that library's owner — render those cards face-up and
    // route clicks to the choice mutation. The searched zone's owner is
    // `zoneOwnerId ?? playerId`: the chooser's own library for a normal Demonic
    // Tutor, but the controlled opponent's for a Word of Command controlled
    // cast (ADR 0037 / #580), where the Acting Player searches the opponent's
    // library. Gate on the viewer being the chooser and this component being the
    // searched library's owner — never assume the chooser owns it.
    const head = pendingChoices?.[0];
    const searchZoneOwner = head?.zoneOwnerId ?? head?.playerId;
    const isLibrarySearchTarget =
        !!head &&
        head.kind === "search-library" &&
        head.zone === "library" &&
        head.playerId === playerId &&
        player.id === searchZoneOwner &&
        !!player.librarySearch;

    // Aladdin's Lamp (CR 614): the projection exposes the looked-at top X as
    // `libraryPeek`; the chooser keeps one (count 1) to draw. Reuses the
    // search picker's face-up grid + buffered-submit path.
    const isLibraryPeekPick =
        !!head &&
        head.kind === "draw-look-keep" &&
        head.zone === "library" &&
        head.playerId === playerId &&
        player.id === playerId &&
        !!player.libraryPeek;

    const isLibraryPick = isLibrarySearchTarget || isLibraryPeekPick;

    // ADR 0026 — outside an active pick, the pile renders from the projected
    // library: known positions (`knownTo`) face-up, the rest as backs.
    const pileModel = buildLibraryPileModel(player.library, player.id);

    // Filtered search (Transmute Artifact: "an artifact card"): the choice
    // carries a `candidateIds` allow-list. Only those cards are pickable — a
    // click on an ineligible card is a no-op (the server would reject it too).
    const eligibleIds =
        isLibrarySearchTarget && head!.candidateIds
            ? new Set(head!.candidateIds)
            : undefined;

    const libraryCards = isLibrarySearchTarget
        ? // Issue #933 follow-up: put eligible (allow-listed) cards first, then
          // sort the whole pile by type line with name as the tiebreaker.
          orderLibrarySearchCards(player.librarySearch!, eligibleIds)
        : isLibraryPeekPick
          ? player.libraryPeek!
          : pileModel.map((slot) => slot.card);
    // Per-card face-up override for the non-pick library view (picks expose
    // every card face-up already via `isFaceDown={false}`).
    const faceUpIds = isLibraryPick
        ? undefined
        : new Set(pileModel.filter((s) => s.faceUp).map((s) => s.card.id));
    const hasCards = libraryCards.length > 0;

    const handleDraw = () => draw({ gameId, playerId });
    const handleMill = () => millCard({ gameId, playerId });
    const handleExile = () => exile({ gameId, playerId });

    // Selection bounds for the active search (CR 701.19 puts a single card in
    // hand, but the primitive supports a range). Cap the buffer at `max` so the
    // chooser can't over-select: clicking a fresh card at the cap replaces the
    // oldest pick (clear+toggle for the count=1 case), and a click on an
    // already-picked card always deselects it.
    const searchCount = isLibraryPick ? head!.count : 1;
    const searchMin =
        typeof searchCount === "number" ? searchCount : searchCount.min;
    const searchMax =
        typeof searchCount === "number" ? searchCount : searchCount.max;

    const onCardClick = isLibraryPick
        ? (card: { id: string }) => {
              if (eligibleIds && !eligibleIds.has(card.id)) return;
              if (bufferCtx.buffer.includes(card.id)) {
                  bufferCtx.toggle(card.id);
                  return;
              }
              if (bufferCtx.buffer.length >= searchMax) {
                  if (searchMax === 1) {
                      // Replace the current pick: clear then add in one event;
                      // React applies the functional updates in order.
                      bufferCtx.clear();
                      bufferCtx.toggle(card.id);
                  }
                  return;
              }
              bufferCtx.toggle(card.id);
          }
        : undefined;

    const pile = (
        <CardsPile
            cards={libraryCards}
            isFaceDown={!isLibraryPick}
            faceUpIds={faceUpIds}
            emptyLabel="Library is empty"
            title={
                isLibrarySearchTarget
                    ? "Search your library"
                    : isLibraryPeekPick
                      ? "Keep one card to draw"
                      : "Library"
            }
            onCardClick={onCardClick}
            // Issue #315 — collapse the blocking picker to the board indicator
            // while minimized. The Pending Choice stays active and the buffered
            // selection is untouched; restoring re-opens this same modal.
            forceOpen={isLibraryPick && !isMinimized}
            onMinimize={isLibraryPick ? minimize : undefined}
            // Portrait chip control (#336) applies only to the normal browse —
            // never while a blocking library pick owns the modal via forceOpen.
            open={isLibraryPick ? undefined : open}
            onOpenChange={isLibraryPick ? undefined : onOpenChange}
            // A full library has ~40-50 cards: the fan's 50% overlap merges
            // every amber selection ring into one solid strip and leaves only
            // thin slivers clickable. Lay the exposed cards out in a grid so
            // each is fully visible and individually selectable, and surface
            // the buffered picks with a per-card ring.
            layout={isLibraryPick ? "grid" : "fan"}
            selectedIds={isLibraryPick ? bufferCtx.buffer : undefined}
            // Filtered search (issue #933): gate the ring/click affordance to
            // the allow-listed cards. `eligibleIds` is `undefined` for an
            // unfiltered search, so every card stays selectable as before.
            eligibleIds={isLibraryPick ? eligibleIds : undefined}
            footer={
                isLibraryPick ? (
                    <LibrarySearchConfirm min={searchMin} max={searchMax} />
                ) : undefined
            }
        />
    );

    if (!isMe || !hasCards || !debugAllActions) {
        return (
            <div className="w-[var(--card-w-sm)] aspect-5/7">
                <div className="relative">{pile}</div>
            </div>
        );
    }

    return (
        <div className="w-[var(--card-w-sm)] aspect-5/7">
            <ContextMenu>
                <ContextMenuTrigger>
                    <div className="relative cursor-pointer">{pile}</div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                    <ContextMenuItem inset onClick={handleDraw}>
                        Draw
                    </ContextMenuItem>
                    <ContextMenuItem inset onClick={handleMill}>
                        Mill
                    </ContextMenuItem>
                    <ContextMenuItem inset onClick={handleExile}>
                        Exile
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        </div>
    );
}
