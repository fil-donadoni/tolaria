import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import CardImage from "../cards/card-image";

type BattlefieldProps = {
    player: Player;
};

function isLand(card: CardInstance): boolean {
    return card.card.types.includes("Land");
}

function isCreature(card: CardInstance): boolean {
    return card.card.types.includes("Creature");
}

/** Groups cards by name, preserving order of first appearance. */
function groupByName(cards: CardInstance[]): CardInstance[][] {
    const groups: Map<string, CardInstance[]> = new Map();
    for (const card of cards) {
        const name = card.card.name;
        const group = groups.get(name);
        if (group) {
            group.push(card);
        } else {
            groups.set(name, [card]);
        }
    }
    return [...groups.values()];
}

export default function PlayerBattlefield({ player }: BattlefieldProps) {
    const { gameId, playerId } = useGameContext();
    const isMe = player.id === playerId;
    const tapUntap = useMutation(api.game.tapUntap);

    const creatures = player.battlefield.filter(isCreature);
    const lands = player.battlefield.filter((c) => isLand(c) && !isCreature(c));
    const others = player.battlefield.filter(
        (c) => !isCreature(c) && !isLand(c)
    );

    function handleTap(cardInstance: CardInstance) {
        if (!isMe || !isLand(cardInstance)) return;
        tapUntap({ gameId, playerId, cardInstanceId: cardInstance.id });
    }

    function renderCard(cardInstance: CardInstance) {
        const tappable = isMe && isLand(cardInstance);
        return (
            <div
                key={cardInstance.id}
                className={`w-32 transition-transform duration-150 ${
                    cardInstance.isTapped ? "rotate-90" : ""
                } ${tappable ? "cursor-pointer" : ""}`}
                onClick={() => handleTap(cardInstance)}
            >
                <CardImage card={cardInstance.card} />
            </div>
        );
    }

    function renderGroup(group: CardInstance[]) {
        if (group.length === 1) {
            return (
                <div key={group[0].id} className="flex">
                    {renderCard(group[0])}
                </div>
            );
        }
        // Stack cards with 50% overlap
        const overlapWidth = `${0.5 * (group.length - 1) + 1}`;
        return (
            <div
                key={group[0].card.name}
                className="flex"
                style={{ width: `calc(8rem * ${overlapWidth})` }}
            >
                {group.map((card, i) => (
                    <div
                        key={card.id}
                        className={`transition-transform duration-150 ${
                            card.isTapped ? "rotate-90" : ""
                        } ${isMe && isLand(card) ? "cursor-pointer" : ""}`}
                        style={{
                            width: "8rem",
                            flexShrink: 0,
                            marginLeft: i > 0 ? "-4rem" : undefined,
                            zIndex: i,
                        }}
                        onClick={() => handleTap(card)}
                    >
                        <CardImage card={card.card} />
                    </div>
                ))}
            </div>
        );
    }

    function renderZone(cards: CardInstance[]) {
        return groupByName(cards).map(renderGroup);
    }

    return (
        <div
            className={`absolute w-full h-2/3 p-4 flex flex-col ${isMe ? "top-0" : "bottom-0"}`}
        >
            {isMe ? (
                <div className="flex flex-col gap-2">
                    <div className="flex-1 flex gap-2 justify-center items-center">
                        {renderZone(creatures)}
                    </div>
                    <div className="flex-1 flex">
                        <div className="flex-1 flex gap-2 justify-center items-center">
                            {renderZone(lands)}
                        </div>
                        <div className="flex-1 flex gap-2 justify-center items-center">
                            {renderZone(others)}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex-1 flex">
                        <div className="flex-1 flex gap-2 justify-center items-center">
                            {renderZone(lands)}
                        </div>
                        <div className="flex-1 flex gap-2 justify-center items-center">
                            {renderZone(others)}
                        </div>
                    </div>
                    <div className="flex-1 flex gap-2 justify-center items-center">
                        {renderZone(creatures)}
                    </div>
                </>
            )}
        </div>
    );
}
