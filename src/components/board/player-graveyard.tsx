import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import GraveyardIcon from "../icons/graveyard-icon";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import { isGraveyardChoiceActive } from "~/lib/graveyard-choice";
import CardsPile from "./cards-pile";
import GraveyardFlashbackButton from "./graveyard-flashback-button";
import LibrarySearchConfirm from "./library-search-confirm";

export default function PlayerGraveyard({
    player,
    open,
    onOpenChange,
}: {
    player: Player;
    /** Controlled-open (portrait chip, #336). When set the collapsed stack is
     *  suppressed and the chip drives the reveal dialog. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const { gameId, playerId, pendingTarget, pendingChoices } =
        useGameContext();
    const selectTarget = useMutation(api.game.selectTarget);
    const bufferCtx = usePendingChoiceBuffer();
    const { isMinimized, minimize } = useMinimizedChoice();

    // CR 400.7 / 109.2: this graveyard accepts target clicks only when (a) a
    // target selection is in progress, (b) it's targeting the graveyard zone,
    // (c) the chooser is the local viewer, and (d) this pile's owner matches
    // the controller-relationship filter ("you" / "opponent" / any).
    const isGraveyardTarget =
        !!pendingTarget &&
        pendingTarget.zone === "graveyard" &&
        pendingTarget.playerId === playerId &&
        (() => {
            const ctrl = pendingTarget.controller ?? "any";
            if (ctrl === "you") return player.id === playerId;
            if (ctrl === "opponent") return player.id !== playerId;
            return true;
        })();

    // CR 608.2 — mid-resolution graveyard pick (Recall): the active choice
    // returns N cards from this (the chooser's own) graveyard to hand. The
    // pile switches from `selectTarget` routing to the buffered-choice path,
    // mirroring the library search picker (forceOpen grid + Done footer).
    const head = pendingChoices?.[0];
    const isGraveyardChoice = isGraveyardChoiceActive(head, player, playerId);

    const choiceCount = isGraveyardChoice ? head!.count : 1;
    const choiceMin =
        typeof choiceCount === "number" ? choiceCount : choiceCount.min;
    const choiceMax =
        typeof choiceCount === "number" ? choiceCount : choiceCount.max;
    const eligibleIds =
        isGraveyardChoice && head!.candidateIds
            ? new Set(head!.candidateIds)
            : undefined;

    const onCardClick = isGraveyardChoice
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
        : isGraveyardTarget
          ? (card: { id: string }) =>
                void selectTarget({
                    gameId,
                    playerId,
                    targetType: "graveyard-card",
                    targetId: card.id,
                    targetPlayerId: player.id,
                })
          : undefined;

    return (
        <div
            data-arrow-anchor-graveyard={player.id}
            className="w-(--card-w-sm) aspect-5/7"
        >
            <div className="relative">
                <CardsPile
                    cards={player.graveyard}
                    emptyLabel="Graveyard"
                    title={
                        isGraveyardChoice
                            ? "Return cards to your hand"
                            : "Graveyard"
                    }
                    zoneIcon={<GraveyardIcon className="w-8 h-8 opacity-60" />}
                    onCardClick={onCardClick}
                    // Issue #315 parity with the library picker: a blocking
                    // graveyard pick owns a forceOpen grid modal (collapsible to
                    // the board indicator) with per-card selection rings and a
                    // reachable Done button.
                    forceOpen={isGraveyardChoice && !isMinimized}
                    onMinimize={isGraveyardChoice ? minimize : undefined}
                    layout="grid"
                    selectedIds={
                        isGraveyardChoice ? bufferCtx.buffer : undefined
                    }
                    footer={
                        isGraveyardChoice ? (
                            <LibrarySearchConfirm
                                min={choiceMin}
                                max={choiceMax}
                            />
                        ) : undefined
                    }
                    // CR 702.34 — a card in the viewer's own graveyard with a
                    // Flashback cost (printed or granted, projected as
                    // `legalActions`) surfaces a Flashback cast button. Suppress
                    // it while a graveyard target/choice owns the pile so the two
                    // interactions never collide.
                    renderCardAction={
                        player.id === playerId &&
                        !isGraveyardChoice &&
                        !isGraveyardTarget
                            ? (card, onClose) =>
                                  card.legalActions !== undefined ? (
                                      <GraveyardFlashbackButton
                                          card={card}
                                          onCommitted={onClose}
                                      />
                                  ) : null
                            : undefined
                    }
                    // Portrait chip control only drives the normal browse — never
                    // while a blocking graveyard pick owns the modal.
                    open={isGraveyardChoice ? undefined : open}
                    onOpenChange={isGraveyardChoice ? undefined : onOpenChange}
                />
            </div>
        </div>
    );
}
