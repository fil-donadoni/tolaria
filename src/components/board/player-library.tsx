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
import CardsPile from "./cards-pile";

export default function PlayerLibrary({ player }: { player: Player }) {
    const { gameId, playerId, debugAllActions } = useGameContext();
    const draw = useMutation(api.game.drawCard);
    const millCard = useMutation(api.game.mill);
    const exile = useMutation(api.game.exileFromLibrary);
    const isMe = player.id === playerId;
    const hasCards = player.library.length > 0;

    const handleDraw = () => draw({ gameId, playerId });
    const handleMill = () => millCard({ gameId, playerId });
    const handleExile = () => exile({ gameId, playerId });

    const pile = (
        <CardsPile
            cards={player.library}
            isFaceDown={true}
            emptyLabel="Library is empty"
            title="Library"
        />
    );

    if (!isMe || !hasCards || !debugAllActions) {
        return (
            <div className="w-24 aspect-5/7">
                <div className="relative">{pile}</div>
            </div>
        );
    }

    return (
        <div className="w-24 aspect-5/7">
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
