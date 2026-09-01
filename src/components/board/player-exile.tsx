import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePileActions, NO_PILE_ACTIONS } from "~/hooks/usePileActionsContext";
import { usePileBrowseMenu } from "~/hooks/usePileBrowseMenu";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import { isExileChoiceActive } from "~/lib/exile-choice";
import { orderLibrarySearchCards } from "~/lib/library-search-order";
import CardsPile from "./cards-pile";
import ExileIcon from "../icons/exile-icon";
import ExileCastButton from "./exile-cast-button";
import LibrarySearchConfirm from "./library-search-confirm";

export default function PlayerExile({
    player,
    open,
    onOpenChange,
}: {
    player: Player;
    /** Controlled-open (portrait chip, #336). */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const { playerId, pendingChoices } = useGameContext();
    const bufferCtx = usePendingChoiceBuffer();
    const { isMinimized, minimize } = useMinimizedChoice();
    // The exile tile carries NO built-in context menu on the GRE board — the
    // fallback is the empty set, so absent a `PileActionsProvider` the markup
    // below is byte-for-byte what it was (issue #2169).
    const pileActions = usePileActions(player, "exile", NO_PILE_ACTIONS);
    // Issue #2345 — the collapsed tile's own click must defer to this menu
    // (rather than opening the browse dialog itself) whenever the menu
    // exists; browsing becomes the menu's own first item.
    const {
        menuActions,
        open: pileBrowseOpen,
        onOpenChange: pileBrowseOnOpenChange,
        hasContextMenu,
    } = usePileBrowseMenu(pileActions, open, onOpenChange);

    // CR 608.2 — mid-resolution exile pick (Dauthi Voidwalker's sacrifice:
    // "choose an exiled card an opponent owns with a void counter on it").
    // The pile switches to the buffered-choice path, mirroring the graveyard
    // picker (forceOpen grid + per-card rings + Done footer). The selectable
    // pile is the zone OWNER's — usually the chooser's opponent.
    const head = pendingChoices?.[0];
    const isExileChoice = isExileChoiceActive(head, player, playerId);

    const choiceCount = isExileChoice ? head!.count : 1;
    const choiceMin =
        typeof choiceCount === "number" ? choiceCount : choiceCount.min;
    const choiceMax =
        typeof choiceCount === "number" ? choiceCount : choiceCount.max;
    const eligibleIds =
        isExileChoice && head!.candidateIds
            ? new Set(head!.candidateIds)
            : undefined;

    const onCardClick = isExileChoice
        ? (card: { id: string }) => {
              if (eligibleIds && !eligibleIds.has(card.id)) return;
              if (bufferCtx.buffer.includes(card.id)) {
                  bufferCtx.toggle(card.id);
                  return;
              }
              if (bufferCtx.buffer.length >= choiceMax) {
                  if (choiceMax === 1) {
                      bufferCtx.clear();
                      bufferCtx.toggle(card.id);
                  }
                  return;
              }
              bufferCtx.toggle(card.id);
          }
        : undefined;

    // Cards pinned to the permanent that exiled them (projected
    // `exiledByPermanentId`, set only while that permanent is on a battlefield)
    // render attached to it on the board (Arena treatment,
    // `board-battlefield-card.tsx`). De-duplicate them from the loose Exile pile
    // so each appears in exactly one place. Cards whose exiler has left (or
    // unlinked exile) keep their normal pile slot. While an exile CHOICE owns
    // the pile the de-dup is lifted: a pinned card stays a legal pick (the
    // choice's `candidateIds` decides eligibility, not the pin).
    const pileCards = isExileChoice
        ? // Filtered pick: eligible cards first (then type, then name), the
          // SAME ordering the filtered library search and the revealed-hand
          // pick use — the ring alone leaves the chooser hunting the legal
          // picks in a large pile. Exile is an unordered zone, so reordering
          // its display costs nothing.
          orderLibrarySearchCards(player.exile, eligibleIds)
        : player.exile.filter((c) => !c.exiledByPermanentId);

    const pile = (
        <CardsPile
            cards={pileCards}
            emptyLabel="Exile"
            title={
                isExileChoice
                    ? (head!.prompt ?? "Choose a card from the exile zone")
                    : "Exile"
            }
            zoneIcon={<ExileIcon className="w-8 h-8 opacity-60" />}
            onCardClick={onCardClick}
            forceOpen={isExileChoice && !isMinimized}
            onMinimize={isExileChoice ? minimize : undefined}
            layout="grid"
            selectedIds={isExileChoice ? bufferCtx.buffer : undefined}
            eligibleIds={isExileChoice ? eligibleIds : undefined}
            footer={
                isExileChoice ? (
                    <LibrarySearchConfirm min={choiceMin} max={choiceMax} />
                ) : undefined
            }
            // CR 601.3 — a card a player has exiled with cast-from-exile
            // permission (Ice Cauldron) is castable by that player from
            // the Exile zone. Surface a Cast button on those cards; the
            // backend cast mutation already validates the exile origin.
            // Suppressed while an exile choice owns the pile so the two
            // interactions never collide.
            renderCardAction={
                isExileChoice
                    ? undefined
                    : (card, onClose) =>
                          card.castableFromExileBy === playerId ? (
                              <ExileCastButton
                                  card={card}
                                  onCommitted={onClose}
                              />
                          ) : null
            }
            // Portrait chip control only drives the normal browse —
            // never while a blocking exile pick owns the modal. Issue #2345
            // — with pile actions present (and outside chip mode),
            // `usePileBrowseMenu` lifts this open state so the menu's
            // "Browse pile…" item can drive it, and `hasContextMenu` tells
            // `CardsPile` to defer its own click to that menu.
            open={isExileChoice ? undefined : pileBrowseOpen}
            onOpenChange={isExileChoice ? undefined : pileBrowseOnOpenChange}
            hasContextMenu={!isExileChoice && hasContextMenu}
        />
    );

    return (
        <div
            data-arrow-anchor-exile={player.id}
            // Inert hit-test handle for a pointer-driven zone drag (#2169) —
            // no listener, no styling, no behaviour on the GRE board.
            data-zone-drop="exile"
            data-zone-owner={player.id}
            className="w-(--card-w-sm) aspect-5/7"
        >
            {pileActions.length === 0 ? (
                <div className="relative">{pile}</div>
            ) : (
                <ContextMenu>
                    <ContextMenuTrigger>
                        <div className="relative cursor-pointer">{pile}</div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
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
            )}
        </div>
    );
}
