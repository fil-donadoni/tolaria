import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import GraveyardIcon from "../icons/graveyard-icon";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import CardsPile from "./cards-pile";

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
    const { gameId, playerId, pendingTarget } = useGameContext();
    const selectTarget = useMutation(api.game.selectTarget);

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

    const onCardClick = isGraveyardTarget
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
                    title="Graveyard"
                    zoneIcon={<GraveyardIcon className="w-8 h-8 opacity-60" />}
                    onCardClick={onCardClick}
                    open={open}
                    onOpenChange={onOpenChange}
                />
            </div>
        </div>
    );
}
