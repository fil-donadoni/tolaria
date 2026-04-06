import type { CardInstance, Player } from "~/types/game";
import type { Color } from "~/types/cards";
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

const LAND_SUBTYPE_MANA: Record<string, Color> = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
};

function getLandManaColor(card: CardInstance): Color | null {
    for (const subtype of card.card.subtypes ?? []) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) return color;
    }
    return null;
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
    const { gameId, playerId, pendingCast } = useGameContext();
    const isMe = player.id === playerId;
    const tapUntap = useMutation(api.game.tapUntap);
    const tapForPayment = useMutation(api.game.tapForPayment);
    const untapForPayment = useMutation(api.game.untapForPayment);
    const cancelCast = useMutation(api.game.cancelCast);

    const isPayingCast =
        isMe && !!pendingCast && pendingCast.playerId === playerId;

    const creatures = player.battlefield.filter(isCreature);
    const lands = player.battlefield.filter((c) => isLand(c) && !isCreature(c));
    const others = player.battlefield.filter(
        (c) => !isCreature(c) && !isLand(c)
    );

    function handleClick(cardInstance: CardInstance) {
        if (!canInteract(cardInstance)) return;

        if (isPayingCast) {
            if (cardInstance.isTapped) {
                untapForPayment({
                    gameId,
                    playerId,
                    cardInstanceId: cardInstance.id,
                });
            } else {
                tapForPayment({
                    gameId,
                    playerId,
                    cardInstanceId: cardInstance.id,
                });
            }
        } else {
            tapUntap({ gameId, playerId, cardInstanceId: cardInstance.id });
        }
    }

    function canInteract(cardInstance: CardInstance): boolean {
        if (!isMe || !isLand(cardInstance)) return false;
        if (isPayingCast) {
            if (cardInstance.isTapped) {
                return pendingCast!.tappedLandIds.includes(cardInstance.id);
            }
            return getLandManaColor(cardInstance) !== null;
        }
        // Outside payment: untapped lands can always be tapped.
        // Committed lands (mana spent on a cast) cannot be untapped.
        if (cardInstance.isTapped) {
            return !cardInstance.manaCommitted;
        }
        return true;
    }

    function renderCard(cardInstance: CardInstance) {
        const interactive = isMe && isLand(cardInstance);
        const enabled = canInteract(cardInstance);
        return (
            <div
                key={cardInstance.id}
                className={`w-32 transition-transform duration-150 ${
                    cardInstance.isTapped ? "rotate-90" : ""
                } ${interactive ? (enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60") : ""}`}
                onClick={() => handleClick(cardInstance)}
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
        const overlapWidth = `${0.5 * (group.length - 1) + 1}`;
        return (
            <div
                key={group[0].card.name}
                className="flex"
                style={{ width: `calc(8rem * ${overlapWidth})` }}
            >
                {group.map((card, i) => {
                    const interactive = isMe && isLand(card);
                    const enabled = canInteract(card);
                    return (
                        <div
                            key={card.id}
                            className={`transition-transform duration-150 ${
                                card.isTapped ? "rotate-90" : ""
                            } ${interactive ? (enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60") : ""}`}
                            style={{
                                width: "8rem",
                                flexShrink: 0,
                                marginLeft: i > 0 ? "-4rem" : undefined,
                                zIndex: i,
                            }}
                            onClick={() => handleClick(card)}
                        >
                            <CardImage card={card.card} />
                        </div>
                    );
                })}
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
            {isPayingCast && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40">
                    <button
                        onClick={() => cancelCast({ gameId, playerId })}
                        className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-1 rounded-lg text-sm transition-colors"
                    >
                        Cancel Cast
                    </button>
                </div>
            )}
        </div>
    );
}
