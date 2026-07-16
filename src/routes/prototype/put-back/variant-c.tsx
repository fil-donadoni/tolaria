// PROTOTYPE Variant C — "Click-select + order tray". Different PRIMARY affordance:
// no dragging to pick. CLICK a hand card to select it (a numbered badge shows its
// pick order); click again to deselect. The two picks flow into a compact ordered
// TRAY sitting on top of the library mock, with a swap control. Picking is one tap;
// ordering is a separate, explicit, touch-friendly step. Throwaway.
import { useState } from "react";
import OrderCard from "~/components/board/library-order/order-card";
import DeckMock from "~/components/board/library-order/deck-mock";
import { CARD_W, CARD_H, REVEAL } from "~/components/board/library-order/constants";
import { MOCK_HAND, PUT_BACK_COUNT, PROMPT } from "./mock-data";
import { DoneBar } from "./variant-a";

export default function VariantC() {
    // Selection in pick order; [0] = topmost.
    const [picks, setPicks] = useState<string[]>([]);
    const byId = new Map(MOCK_HAND.map((c) => [c.instanceId, c] as const));

    const toggle = (id: string) =>
        setPicks((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            if (prev.length >= PUT_BACK_COUNT) return prev; // full
            return [...prev, id];
        });
    const swap = () => setPicks((prev) => [...prev].reverse());

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
            <div className="flex max-w-full flex-col gap-6">
                <p className="text-center text-sm text-muted-foreground">
                    {PROMPT}{" "}
                    <span className="text-accent">Tap cards to choose.</span>
                </p>

                {/* Order tray on top of the library (confirmation of what lands) */}
                <div className="flex flex-col items-center gap-2">
                    <div className="font-beleren text-xs tracking-widest text-accent">
                        GOING ON TOP
                    </div>
                    <div className="flex items-center gap-4">
                        {Array.from({ length: PUT_BACK_COUNT }).map((_, i) => {
                            const id = picks[i];
                            const card = id ? byId.get(id) : undefined;
                            return (
                                <div
                                    key={i}
                                    className="flex flex-col items-center gap-1"
                                >
                                    <div
                                        className="flex items-center justify-center rounded-[7%] border-2 border-dashed border-border"
                                        style={{
                                            width: CARD_W * 0.9,
                                            height: CARD_H * 0.9,
                                        }}
                                    >
                                        {card ? (
                                            <div className="scale-90">
                                                <OrderCard defId={card.defId} />
                                            </div>
                                        ) : (
                                            <span className="text-3xl text-border">
                                                {i + 1}
                                            </span>
                                        )}
                                    </div>
                                    <span className="font-beleren text-[11px] text-accent">
                                        {i === 0 ? "① topmost" : "②"}
                                    </span>
                                </div>
                            );
                        })}
                        <button
                            type="button"
                            disabled={picks.length !== PUT_BACK_COUNT}
                            onClick={swap}
                            className="rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-white/5 disabled:opacity-30"
                        >
                            ⇅
                        </button>
                    </div>
                    <div className="opacity-90">
                        <DeckMock />
                    </div>
                </div>

                {/* HAND row — click to select, numbered badge shows order */}
                <div className="flex justify-center">
                    <div
                        className="relative"
                        style={{
                            width: (MOCK_HAND.length - 1) * REVEAL + CARD_W,
                            height: CARD_H + 20,
                        }}
                    >
                        {MOCK_HAND.map((c, i) => {
                            const order = picks.indexOf(c.instanceId);
                            const selected = order !== -1;
                            return (
                                <button
                                    key={c.instanceId}
                                    type="button"
                                    onClick={() => toggle(c.instanceId)}
                                    className={`absolute cursor-pointer rounded-[7%] transition-transform ${
                                        selected
                                            ? "-translate-y-4 ring-2 ring-accent"
                                            : "hover:-translate-y-2"
                                    }`}
                                    style={{
                                        left: i * REVEAL,
                                        top: 10,
                                        zIndex: selected ? 100 + i : i,
                                        width: CARD_W,
                                    }}
                                >
                                    <OrderCard defId={c.defId} />
                                    {selected && (
                                        <span className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-accent font-beleren text-sm text-black">
                                            {order + 1}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <DoneBar
                    disabled={picks.length !== PUT_BACK_COUNT}
                    top={picks}
                />
            </div>
        </div>
    );
}
