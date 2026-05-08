import type { PendingCast, Player } from "~/types/game";
import { getCardById } from "@convex/cards";
import { useDraggable } from "~/hooks/useDraggable";

export default function PaymentBanner({
    pendingCast,
    me,
}: {
    pendingCast: PendingCast;
    me: Player | undefined;
}) {
    const { offset, dragHandlers } = useDraggable();

    const cardInHand = me?.hand.find(
        (c) => c !== null && c.id === pendingCast.cardInstanceId
    );
    const cardName = cardInHand
        ? getCardById(cardInHand.card.id).name
        : "spell";

    return (
        <div
            className="absolute top-1/2 left-1/2 z-50"
            style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
        >
            <div
                {...dragHandlers}
                className="bg-amber-900/90 border border-amber-500/50 rounded-lg px-5 py-3 backdrop-blur-sm shadow-lg cursor-move select-none"
            >
                <div className="text-amber-200 text-sm font-medium">
                    <span className="text-white font-bold">{cardName}</span>
                    {" — pay the casting costs"}
                </div>
            </div>
        </div>
    );
}
