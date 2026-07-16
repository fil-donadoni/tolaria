// PROTOTYPE Variant A — "Extended Portent strip". One continuous horizontal row,
// exactly the existing LibraryOrderPicker shape but the LEFT zone is the HAND
// (fan of the whole hand) and the RIGHT zone is a fixed 2-slot TOP-of-library
// tray. Drag a hand card across the library into a top slot; the two top slots
// are the chosen order (slot 1 = topmost). This is the literal "extend that
// component" reading. Native HTML5 DnD — throwaway.
import { useState } from "react";
import OrderCard from "~/components/board/library-order/order-card";
import DeckMock from "~/components/board/library-order/deck-mock";
import { CARD_W, CARD_H, REVEAL } from "~/components/board/library-order/constants";
import { MOCK_HAND, PUT_BACK_COUNT, PROMPT, type MockCard } from "./mock-data";

const DT = "application/x-proto-card";

export default function VariantA() {
    // top[0] = topmost. Cards not in top stay in hand order.
    const [top, setTop] = useState<string[]>([]);
    const byId = new Map(MOCK_HAND.map((c) => [c.instanceId, c] as const));
    const handCards = MOCK_HAND.filter((c) => !top.includes(c.instanceId));

    const place = (id: string, slot: number) => {
        setTop((prev) => {
            const without = prev.filter((x) => x !== id);
            const next = [...without];
            next[slot] = id;
            // Compact: drop undefined holes, cap at PUT_BACK_COUNT.
            return next.filter(Boolean).slice(0, PUT_BACK_COUNT);
        });
    };
    const remove = (id: string) =>
        setTop((prev) => prev.filter((x) => x !== id));
    const swap = () => setTop((prev) => [...prev].reverse());

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
            <div className="flex max-w-full flex-col gap-6">
                <p className="text-center text-sm text-muted-foreground">
                    {PROMPT}
                </p>

                <div className="flex items-end justify-center gap-8 overflow-x-auto px-6 py-6">
                    {/* HAND fan (left) */}
                    <div>
                        <div className="mb-2 text-center font-beleren text-xs tracking-widest text-muted-foreground">
                            HAND
                        </div>
                        <div
                            className="relative"
                            style={{
                                width: (handCards.length - 1) * REVEAL + CARD_W,
                                height: CARD_H,
                            }}
                        >
                            {handCards.map((c, i) => (
                                <div
                                    key={c.instanceId}
                                    draggable
                                    onDragStart={(e) =>
                                        e.dataTransfer.setData(DT, c.instanceId)
                                    }
                                    className="absolute cursor-grab transition-transform hover:-translate-y-3 active:cursor-grabbing"
                                    style={{
                                        left: i * REVEAL,
                                        zIndex: i,
                                        width: CARD_W,
                                    }}
                                >
                                    <OrderCard defId={c.defId} />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* LIBRARY mock (middle) */}
                    <div className="pb-6">
                        <DeckMock />
                    </div>

                    {/* TOP zone (right): 2 ordered slots */}
                    <div>
                        <div className="mb-2 text-center font-beleren text-xs tracking-widest text-accent">
                            TOP OF LIBRARY
                        </div>
                        <div className="flex items-start gap-3">
                            {Array.from({ length: PUT_BACK_COUNT }).map(
                                (_, slot) => {
                                    const id = top[slot];
                                    const card = id ? byId.get(id) : undefined;
                                    return (
                                        <Slot
                                            key={slot}
                                            label={slot === 0 ? "① on top" : "②"}
                                            card={card}
                                            onDropCard={(cid) =>
                                                place(cid, slot)
                                            }
                                            onClear={
                                                id
                                                    ? () => remove(id)
                                                    : undefined
                                            }
                                        />
                                    );
                                }
                            )}
                        </div>
                        {top.length === PUT_BACK_COUNT && (
                            <button
                                type="button"
                                onClick={swap}
                                className="mt-3 w-full rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-white/5"
                            >
                                ⇅ swap order
                            </button>
                        )}
                    </div>
                </div>

                <DoneBar disabled={top.length !== PUT_BACK_COUNT} top={top} />
            </div>
        </div>
    );
}

function Slot({
    label,
    card,
    onDropCard,
    onClear,
}: {
    label: string;
    card: MockCard | undefined;
    onDropCard: (id: string) => void;
    onClear?: () => void;
}) {
    const [over, setOver] = useState(false);
    return (
        <div className="flex flex-col items-center gap-1">
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
                onClick={onClear}
                className={`flex items-center justify-center rounded-[7%] border-2 border-dashed ${
                    over ? "border-accent bg-accent/10" : "border-border"
                } ${card ? "cursor-pointer" : ""}`}
                style={{ width: CARD_W, height: CARD_H }}
                title={card ? "click to return to hand" : undefined}
            >
                {card ? <OrderCard defId={card.defId} /> : null}
            </div>
            <span className="font-beleren text-[11px] tracking-wide text-accent">
                {label}
            </span>
        </div>
    );
}

export function DoneBar({ disabled, top }: { disabled: boolean; top: string[] }) {
    return (
        <div className="flex flex-col items-center gap-2">
            <div className="text-center text-xs text-muted-foreground">
                {top.length}/{PUT_BACK_COUNT} placed
                {top.length === PUT_BACK_COUNT &&
                    ` — will submit [${top.join(", ")}] (topmost first)`}
            </div>
            <button
                type="button"
                disabled={disabled}
                className="rounded-full border border-accent bg-accent/10 px-10 py-2 font-beleren text-base tracking-wide text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
                Done
            </button>
        </div>
    );
}
