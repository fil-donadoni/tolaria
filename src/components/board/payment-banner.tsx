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
        subtitle = "pay the casting costs";
    } else {
        const source = props.me?.battlefield.find(
            (c) => c.id === props.pendingActivation.cardInstanceId
        );
        cardName = source ? getCardById(source.card.id).name : "ability";
        subtitle = "pay the activation costs";
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
                className="relative bg-[#0c0d12]/90 border border-zinc-800/80 backdrop-blur-md rounded-sm px-5 py-3 shadow-[0_0_50px_rgba(0,0,0,0.8)] cursor-move select-none"
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-zinc-500/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-zinc-500/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-zinc-500/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-zinc-500/40" />

                <p className="font-[var(--font-beleren)] text-sm tracking-wide text-[#f1f1e8]">
                    {cardName}
                </p>
                <div className="h-[1px] w-full bg-gradient-to-r from-zinc-600 via-zinc-500/40 to-transparent my-1.5" />
                <p className="text-zinc-400 text-xs">{subtitle}</p>
            </div>
        </div>
    );
}
