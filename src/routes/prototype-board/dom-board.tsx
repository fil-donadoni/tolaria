/**
 * PROTOTYPE — DOM high-perf board. position:absolute + transform, layout
 * springs via Motion, native drag. Throwaway — delete after decision.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { ProtoCard } from "./cards";
import { SCRYFALL_NORMAL } from "./cards";
import { CARD_H, CARD_W, fanLayout, rowLayout, type Placed } from "./layout";

export type ZonedCard = ProtoCard & { zone: "hand" | "battlefield" };

export default function DomBoard({ cards }: { cards: ZonedCard[] }) {
    const ref = useRef<HTMLDivElement>(null);
    const [dims, setDims] = useState({ w: 1200, h: 700 });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            setDims({ w: el.clientWidth, h: el.clientHeight });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const bf = cards.filter((c) => c.zone === "battlefield");
    const hand = cards.filter((c) => c.zone === "hand");
    const bfPos = rowLayout(bf.length, dims.w, CARD_W, dims.h * 0.34);
    const handPos = fanLayout(
        hand.length,
        dims.w,
        CARD_W,
        dims.h * 0.72,
        CARD_H
    );

    const place = new Map<string, Placed>();
    bf.forEach((c, i) => place.set(c.instanceId, bfPos[i]));
    hand.forEach((c, i) => place.set(c.instanceId, handPos[i]));

    return (
        <div ref={ref} className="absolute inset-0 overflow-hidden">
            {cards.map((c) => {
                const p = place.get(c.instanceId)!;
                return (
                    <motion.div
                        key={c.instanceId}
                        drag
                        dragMomentum={false}
                        whileHover={{ scale: 1.18, zIndex: 50 }}
                        whileDrag={{ scale: 1.1, zIndex: 60 }}
                        className="absolute top-0 left-0 cursor-grab active:cursor-grabbing"
                        style={{
                            width: CARD_W,
                            height: CARD_H,
                            marginLeft: -CARD_W / 2,
                            marginTop: -CARD_H / 2,
                        }}
                        animate={{
                            x: p.x,
                            y: p.y,
                            rotate: p.rot,
                            scale: p.scale,
                        }}
                        transition={{
                            type: "spring",
                            stiffness: 320,
                            damping: 30,
                        }}
                    >
                        <div className="relative w-full h-full rounded-[6px] overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,0.6)] ring-1 ring-black/40">
                            <img
                                src={SCRYFALL_NORMAL(c.cardId)}
                                alt={c.name}
                                draggable={false}
                                className="w-full h-full object-cover select-none"
                            />
                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-white text-[13px] font-bold leading-none tabular-nums">
                                {c.power}/{c.toughness}
                            </div>
                        </div>
                    </motion.div>
                );
            })}
        </div>
    );
}
