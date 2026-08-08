import { useState } from "react";
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
import { usePileActions, type PileAction } from "~/hooks/usePileActionsContext";
import { usePileBrowseMenu } from "~/hooks/usePileBrowseMenu";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import CardsPile from "./cards-pile";
import LibrarySearchConfirm from "./library-search-confirm";
import LibraryOrderPicker from "./library-order/library-order-picker";
import LibraryPlayLandButton from "./library-play-land-button";
import { buildLibraryPileModel } from "~/lib/library-knowledge";
import { orderLibrarySearchCards } from "~/lib/library-search-order";
import { canAddCategorizedPick } from "@convex/gre/categorizedPick";

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
    const submitChoice = useMutation(api.game.submitResolutionChoice);
    const [orderSubmitting, setOrderSubmitting] = useState(false);
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

    // Aladdin's Lamp (CR 614, `draw-look-keep`) and the shared "look at top N"
    // path (Stock Up / Preordain, `look-top`, #942): the projection exposes
    // exactly the looked-at top cards as `libraryPeek` — never the whole
    // library. The chooser picks a subset (count 1 for Aladdin's Lamp, a range
    // for look-top). Reuses the search picker's face-up grid + buffered-submit
    // path.
    const isLibraryPeekPick =
        !!head &&
        (head.kind === "draw-look-keep" || head.kind === "look-top") &&
        head.zone === "library" &&
        head.playerId === playerId &&
        player.id === playerId &&
        !!player.libraryPeek;

    // Satyr Wayfinder / Narset (QA): a `look-distribute` whose rest needs no
    // ORDERING — either it goes to the graveyard (Satyr, Reviving Vapors:
    // order is cosmetic) or the server randomizes it (`randomizeRest`,
    // Narset's random bottom) — is a simple "choose the hand card(s)" grid
    // pick, NEVER the two-zone scry-style drag picker. The looked-at cards
    // are exposed on `libraryPeek` (exactly N cards — the library itself is
    // never shown). The single-list submit is legal for `look-distribute`:
    // the rest falls to `destination` in look order / randomly.
    const orderPickOwnerForGrid = head?.zoneOwnerId ?? head?.playerId;
    const isLookDistributeGridPick =
        !!head &&
        head.kind === "look-distribute" &&
        head.zone === "library" &&
        (head.destination === "graveyard" || head.randomizeRest === true) &&
        head.playerId === playerId &&
        player.id === orderPickOwnerForGrid &&
        !!player.libraryPeek;

    // Scry / surveil / ponder ordered-top pick (`order-top`, CR 701.22/701.44),
    // the unified take-to-hand + order-bottom pick (`look-distribute`, CR 401.4
    // — Impulse, Stock Up), AND the "put them back in any order" reorder
    // (`reorder-library`, CR 401.4 — Portent, Natural Selection, Elemental
    // Augury, Drafna's Restoration): every one of these arranges a set of
    // looked-at library cards, so they ALL use the same drag picker (a
    // full-screen overlay) — never the old grid/click-buffer path. Routing the
    // kind here (not card by card) is what makes the new picker the single,
    // automatic UI for this whole family of choices. The looked-at cards are
    // exposed on the zone OWNER's `libraryPeek`, which is the chooser's own
    // library for Natural Selection-on-self but the TARGET player's for a
    // Portent aimed at the opponent — so gate on the viewer being the chooser
    // (`head.playerId === playerId`) and this component being the peeked
    // library's owner (`zoneOwnerId ?? playerId`), never assume the chooser owns
    // it. Kept OUT of `isLibraryPick` (the grid/buffer path).
    const orderPickOwner = head?.zoneOwnerId ?? head?.playerId;
    const isOrderTopPick =
        !!head &&
        (head.kind === "order-top" ||
            head.kind === "reorder-library" ||
            // Only an ORDERED look-distribute keeps the drag picker
            // (Impulse / Stock Up — the bottom order matters).
            (head.kind === "look-distribute" && !isLookDistributeGridPick)) &&
        head.zone === "library" &&
        head.playerId === playerId &&
        player.id === orderPickOwner &&
        !!player.libraryPeek;

    const isLibraryPick =
        isLibrarySearchTarget || isLibraryPeekPick || isLookDistributeGridPick;

    // ADR 0026 — outside an active pick, the pile renders from the projected
    // library: known positions (`knownTo`) face-up, the rest as backs.
    const pileModel = buildLibraryPileModel(player.library, player.id);

    // Filtered search (Transmute Artifact: "an artifact card"): the choice
    // carries a `candidateIds` allow-list. Only those cards are pickable — a
    // click on an ineligible card is a no-op (the server would reject it too).
    // A filtered look-distribute (Satyr "a land", Narset "noncreature,
    // nonland") instead carries `eligibleIds` restricting which looked-at
    // cards may go to HAND.
    const eligibleIds =
        isLibrarySearchTarget && head!.candidateIds
            ? new Set(head!.candidateIds)
            : isLookDistributeGridPick && head!.eligibleIds
              ? new Set(head!.eligibleIds)
              : undefined;

    const libraryCards = isLibrarySearchTarget
        ? // Issue #933 follow-up: put eligible (allow-listed) cards first, then
          // sort the whole pile by type line with name as the tiebreaker.
          orderLibrarySearchCards(player.librarySearch!, eligibleIds)
        : isLibraryPeekPick || isLookDistributeGridPick
          ? player.libraryPeek!
          : pileModel.map((slot) => slot.card);
    // Per-card face-up override for the non-pick library view (picks expose
    // every card face-up already via `isFaceDown={false}`).
    const faceUpIds = isLibraryPick
        ? undefined
        : new Set(pileModel.filter((s) => s.faceUp).map((s) => s.card.id));
    // The collapsed board zone shows ONLY the top card, and only while it is
    // still on top and known (scry-to-top / Mishra's Bauble peek) — a known
    // card that a later reorder pushed below index 0 stays hidden there. The
    // browse dialog keeps the full `faceUpIds` (every known position).
    const topSlot = pileModel[0];
    const collapsedFaceUpIds =
        !isLibraryPick && topSlot?.faceUp
            ? new Set([topSlot.card.id])
            : isLibraryPick
              ? undefined
              : new Set<string>();
    const hasCards = libraryCards.length > 0;

    const handleDraw = () => draw({ gameId, playerId });
    const handleMill = () => millCard({ gameId, playerId });
    const handleExile = () => exile({ gameId, playerId });

    // The library tile's context menu. The DEFAULT set is exactly what this
    // component offered before the pile-action seam existed (issue #2169), on
    // exactly the same gate — the viewer's own non-empty library with
    // `debugAllActions` on. A mounted `PileActionsProvider` (the Manual Game)
    // replaces it wholesale; absent one, nothing about this pile changes.
    const defaultActions: PileAction[] =
        isMe && hasCards && debugAllActions
            ? [
                  { key: "draw", label: "Draw", onSelect: handleDraw },
                  { key: "mill", label: "Mill", onSelect: handleMill },
                  { key: "exile", label: "Exile", onSelect: handleExile },
              ]
            : [];
    const pileActions = usePileActions(player, "library", defaultActions);
    // Issue #2345 — the collapsed tile's own click must defer to this menu
    // (rather than opening the browse dialog itself) whenever the menu
    // exists; browsing becomes the menu's own first item.
    const {
        menuActions,
        open: pileBrowseOpen,
        onOpenChange: pileBrowseOnOpenChange,
        hasContextMenu,
    } = usePileBrowseMenu(pileActions, open, onOpenChange);

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

    // Categorized keep (issue #1364, Atraxa): the choice carries the resolved
    // `categories`, so "at most one card per category, each card claimable by
    // only ONE category" gates the click through the SAME bipartite matching
    // the server validates the submit with (`convex/gre/categorizedPick.ts`) —
    // never a re-derived client rule, which would drift and either offer a
    // pick the server rejects or hide one it would accept. A plain count cap
    // is not enough here: with two creatures revealed the second is illegal
    // even though the cap (the maximum matching) may be far higher.
    const categories = isLibraryPick ? head!.categories : undefined;

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
                      // React applies the functional updates in order. A
                      // single eligible card is always a legal categorized
                      // pick, so the category gate below is moot here.
                      bufferCtx.clear();
                      bufferCtx.toggle(card.id);
                  }
                  return;
              }
              if (
                  categories &&
                  !canAddCategorizedPick(categories, bufferCtx.buffer, card.id)
              ) {
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
            collapsedFaceUpIds={collapsedFaceUpIds}
            emptyLabel="Library is empty"
            title={
                isLibrarySearchTarget
                    ? "Search your library"
                    : isLibraryPeekPick
                      ? // look-top (#942) carries a card-specific prompt
                        // (Stock Up keeps 2, Preordain bottoms 0..2); Aladdin's
                        // Lamp (draw-look-keep) keeps a single card.
                        head!.kind === "look-top"
                          ? (head!.prompt ?? "Look at the top cards")
                          : "Keep one card to draw"
                      : isLookDistributeGridPick
                        ? // Satyr / Narset carry their own card-specific
                          // prompt (the GRE builds it from the Op).
                          (head!.prompt ??
                          "Choose a card to put into your hand")
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
            // Issue #2345 — with pile actions present (and outside chip
            // mode), `usePileBrowseMenu` lifts this open state so the menu's
            // "Browse pile…" item can drive it, and `hasContextMenu` tells
            // `CardsPile` to defer its own click to that menu.
            open={isLibraryPick ? undefined : pileBrowseOpen}
            onOpenChange={isLibraryPick ? undefined : pileBrowseOnOpenChange}
            hasContextMenu={!isLibraryPick && hasContextMenu}
            // A full library has ~40-50 cards: the fan's 50% overlap merges
            // every amber selection ring into one solid strip and leaves only
            // thin slivers clickable. Lay the exposed cards out in a grid so
            // each is fully visible and individually selectable, and surface
            // the buffered picks with a per-card ring.
            layout={isLibraryPick ? "grid" : "fan"}
            // ADR 0026 — known top cards read top-on-the-right (topmost highest),
            // in the collapsed board slot and the browse dialog, for BOTH the
            // viewer's own library and the opponent's (Mishra's Bauble peek). The
            // grid pick modes are unaffected (they don't fan).
            topOnRight={!isLibraryPick}
            selectedIds={isLibraryPick ? bufferCtx.buffer : undefined}
            // Filtered search (issue #933): gate the ring/click affordance to
            // the allow-listed cards. `eligibleIds` is `undefined` for an
            // unfiltered search, so every card stays selectable as before.
            eligibleIds={isLibraryPick ? eligibleIds : undefined}
            // Categorized reveal (Atraxa, #1364) — group the grid pick into one
            // labelled section per card type / colour pair. Only the grid pick
            // (randomBottom / graveyard) carries it; the drag picker path never
            // sets `categories`.
            categories={isLookDistributeGridPick ? head!.categories : undefined}
            footer={
                isLibraryPick ? (
                    <LibrarySearchConfirm min={searchMin} max={searchMax} />
                ) : undefined
            }
            // CR 305.1-analog (Courser of Kruphix) — the viewer's own library
            // TOP card carries `legalActions` from the projection when it is a
            // LAND they may play from the top; surface the Play button on it.
            // The projection is the only gate that matters (it re-derives the
            // permission, the position and the land drop live), so this needs
            // no client-side rule of its own — matching the graveyard land
            // affordance. Suppressed while a library pick owns the pile so the
            // interactions never collide.
            renderCardAction={
                isMe && !isLibraryPick
                    ? (card, onClose) =>
                          card.legalActions === undefined ? null : (
                              <LibraryPlayLandButton
                                  card={card}
                                  onCommitted={onClose}
                              />
                          )
                    : undefined
            }
        />
    );

    const handleOrderConfirm = async (
        topTopmostFirst: string[],
        secondIds: string[]
    ) => {
        if (!head || orderSubmitting) return;
        setOrderSubmitting(true);
        try {
            await submitChoice({
                gameId,
                playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: topTopmostFirst,
                secondZoneIds: secondIds.length > 0 ? secondIds : undefined,
            });
        } finally {
            setOrderSubmitting(false);
        }
    };

    // `look-distribute` (Impulse / Stock Up / Narset) mounts the picker in
    // HAND/BOTTOM mode. `keep` is the hand cap (count MAX); `min` is the floor
    // (count MIN) — equal for the mandatory dig, 0 for Narset's optional "you
    // may". `eligibleIds` restricts which looked-at cards may enter the hand
    // (Narset's "noncreature, nonland"); undefined = every card eligible.
    const distribute =
        head?.kind === "look-distribute"
            ? {
                  keep:
                      typeof head.count === "number"
                          ? head.count
                          : head.count.max,
                  min:
                      typeof head.count === "number"
                          ? head.count
                          : head.count.min,
                  eligibleIds: head.eligibleIds,
                  // Categorized keep (Atraxa, #1364) — only set for a
                  // `revealAndCategorize` choice; the ordinary dig leaves it
                  // undefined and the picker behaves exactly as before.
                  categories: head.categories,
              }
            : undefined;

    const orderPicker = isOrderTopPick ? (
        <LibraryOrderPicker
            lookedAt={player.libraryPeek!.map((c) => ({
                instanceId: c.id,
                defId: c.card.id,
            }))}
            destination={head!.destination ?? "none"}
            prompt={
                head!.prompt ??
                (distribute
                    ? "Take cards to your hand, then order the rest on the bottom"
                    : "Order the top of your library")
            }
            submitting={orderSubmitting}
            distribute={distribute}
            onConfirm={handleOrderConfirm}
        />
    ) : null;

    if (pileActions.length === 0) {
        return (
            <div
                className="w-[var(--card-w-sm)] aspect-5/7"
                data-zone-drop="library"
                data-zone-owner={player.id}
            >
                <div className="relative">{pile}</div>
                {orderPicker}
            </div>
        );
    }

    return (
        <div
            className="w-[var(--card-w-sm)] aspect-5/7"
            data-zone-drop="library"
            data-zone-owner={player.id}
        >
            {orderPicker}
            <ContextMenu>
                <ContextMenuTrigger>
                    <div className="relative cursor-pointer">{pile}</div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                    {menuActions.map((action) => (
                        <ContextMenuItem
                            key={action.key}
                            inset
                            onClick={action.onSelect}
                        >
                            {action.label}
                        </ContextMenuItem>
                    ))}
                </ContextMenuContent>
            </ContextMenu>
        </div>
    );
}
