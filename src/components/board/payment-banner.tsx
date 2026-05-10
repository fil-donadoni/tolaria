import type { PendingActivation, PendingCast, Player } from "~/types/game";
import { getCardById } from "@convex/cards";
import { useDraggable } from "~/hooks/useDraggable";

type Props =
    | {
          kind: "cast";
          pendingCast: PendingCast;
          me: Player | undefined;
      }
    | {
          kind: "activation";
          pendingActivation: PendingActivation;
          me: Player | undefined;
      };

export default function PaymentBanner(props: Props) {
    const { offset, dragHandlers } = useDraggable();

    let cardName: string;
    let subtitle: string;

    if (props.kind === "cast") {
        const cardInHand = props.me?.hand.find(
            (c) => c !== null && c.id === props.pendingCast.cardInstanceId
        );
        cardName = cardInHand ? getCardById(cardInHand.card.id).name : "spell";
        subtitle = " — pay the casting costs";
    } else {
        const source = props.me?.battlefield.find(
            (c) => c.id === props.pendingActivation.cardInstanceId
        );
        cardName = source ? getCardById(source.card.id).name : "ability";
        subtitle = " — pay the activation costs";
    }

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
                    {subtitle}
                </div>
            </div>
        </div>
    );
}
