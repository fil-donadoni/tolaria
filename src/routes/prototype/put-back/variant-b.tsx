// PROTOTYPE Variant B — "Two-panel vertical". LEFT: the hand as a real
// bottom-anchored ARC fan (like the board's hand). RIGHT: a vertical library
// column — two TOP slots STACKED (slot 1 on top = literally the top of the
// library), the deck mock beneath them. Drag a hand card UP into a slot: the
// spatial "top = up" metaphor carries the ordering, no separate reorder control
// needed (drag between the two slots to reorder). Native DnD — throwaway.
import { useState } from "react";
import OrderCard from "~/components/board/library-order/order-card";
import DeckMock from "~/components/board/library-order/deck-mock";
import { CARD_W, CARD_H } from "~/components/board/library-order/constants";
import { MOCK_HAND, PUT_BACK_COUNT, PROMPT, type MockCard } from "./mock-data";
import { DoneBar } from "./variant-a";

const DT = "application/x-proto-card";
const FAN_STEP = 46; // px between fanned hand cards
const FAN_ROT = 4; // deg per card from center

export default function VariantB() {
    const [top, setTop] = useState<string[]>([]);
    const byId = new Map(MOCK_HAND.map((c) => [c.instanceId, c] as const));
    const handCards = MOCK_HAND.filter((c) => !top.includes(c.instanceId));

    const place = (id: string, slot: number) =>
        setTop((prev) => {
            const without = prev.filter((x) => x !== id);
            const next = [...without];
            next[slot] = id;
            return next.filter(Boolean).slice(0, PUT_BACK_COUNT);
        });
    const remove = (id: string) =>
        setTop((prev) => prev.filter((x) => x !== id));

    const mid = (handCards.length - 1) / 2;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
            <div className="flex max-w-full flex-col gap-6">
                <p className="text-center text-sm text-muted-foreground">
                    {PROMPT}
                </p>

                <div className="flex items-center justify-center gap-16 px-6 py-6">
                    {/* HAND arc fan (left) */}
                    <div
                        className="relative"
                        style={{
                            width: (handCards.length - 1) * FAN_STEP + CARD_W,
                            height: CARD_H + 40,
                        }}
                    >
                        {handCards.map((c, i) => {
                            const off = i - mid;
                            return (
                                <div
                                    key={c.instanceId}
                                    draggable
                                    onDragStart={(e) =>
                                        e.dataTransfer.setData(DT, c.instanceId)
                                    }
                                    className="absolute origin-bottom cursor-grab transition-transform hover:-translate-y-4 active:cursor-grabbing"
                                    style={{
                                        left: i * FAN_STEP,
                                        top: Math.abs(off) * 8,
                                        transform: `rotate(${off * FAN_ROT}deg)`,
                                        zIndex: i,
                                        width: CARD_W,
                                    }}
                                >
                                    <OrderCard defId={c.defId} />
                                </div>
                            );
                        })}
                    </div>

                    {/* LIBRARY column (right): TOP slots stacked above the deck */}
                    <div className="flex flex-col items-center gap-2">
                        <div className="font-beleren text-xs tracking-widest text-accent">
                            ↑ TOP OF LIBRARY
                        </div>
                        {Array.from({ length: PUT_BACK_COUNT }).map((_, slot) => {
                            const id = top[slot];
                            const card = id ? byId.get(id) : undefined;
                            return (
                                <VSlot
                                    key={slot}
                                    ordinal={slot + 1}
                                    card={card}
                                    onDropCard={(cid) => place(cid, slot)}
                                    onClear={id ? () => remove(id) : undefined}
                                />
                            );
                        })}
                        <div className="mt-1 opacity-90">
                            <DeckMock />
                        </div>
                        <div className="font-beleren text-[11px] tracking-widest text-muted-foreground">
                            rest of library
                        </div>
                    </div>
                </div>

                <DoneBar disabled={top.length !== PUT_BACK_COUNT} top={top} />
            </div>
        </div>
    );
}

function VSlot({
    ordinal,
    card,
    onDropCard,
    onClear,
}: {
    ordinal: number;
    card: MockCard | undefined;
    onDropCard: (id: string) => void;
    onClear?: () => void;
}) {
    const [over, setOver] = useState(false);
    return (
        <div className="flex items-center gap-2">
            <span className="w-4 text-right font-beleren text-sm text-accent">
                {ordinal}
            </span>
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    const id = e.dataTransfer.getData(DT);
                    if (id) onDropCard(id);
                }}
                // Placed cards are draggable too → drag between slots to reorder.
                draggable={!!card}
                onDragStart={(e) =>
                    card && e.dataTransfer.setData(DT, card.instanceId)
                }
                onClick={onClear}
                className={`flex items-center justify-center rounded-[7%] border-2 border-dashed ${
                    over ? "border-accent bg-accent/10" : "border-border"
                } ${card ? "cursor-pointer" : ""}`}
                style={{ width: CARD_W, height: CARD_H }}
                title={card ? "click to return · drag to reorder" : undefined}
            >
                {card ? <OrderCard defId={card.defId} /> : null}
            </div>
        </div>
    );
}
