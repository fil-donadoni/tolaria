/**
 * PROTOTYPE — HYBRID: DOM board (cards, text, drag, a11y) + a transparent
 * Pixi overlay (pointer-events: none) that draws additive FX positioned by
 * reading DOM rects via getBoundingClientRect. Proves the DOM→canvas mapping.
 *
 * Demonstrates BOTH the power (particles/glow synced to DOM cards) and the
 * limit (the overlay can't distort DOM pixels — no shockwave on real cards;
 * that needs full WebGL). Throwaway — delete after decision.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Application, Container, Sprite, Texture, Ticker } from "pixi.js";
import { GlowFilter } from "pixi-filters";
import { SCRYFALL_NORMAL } from "./cards";
import { CARD_H, CARD_W, fanLayout, rowLayout, type Placed } from "./layout";
import type { ZonedCard } from "./dom-board";

function dotTexture(): Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(180,220,255,0.85)");
    grad.addColorStop(1, "rgba(120,180,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return Texture.from(c);
}

type Particle = { s: Sprite; vx: number; vy: number; life: number };

export default function HybridBoard({ cards }: { cards: ZonedCard[] }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const elRef = useRef<Map<string, HTMLElement>>(new Map());
    const hoveredRef = useRef<string | null>(null);
    const cardsRef = useRef<ZonedCard[]>(cards);
    const prevZonesRef = useRef<Map<string, string>>(new Map());
    const [dims, setDims] = useState({ w: 1200, h: 700 });

    // Pixi overlay refs
    const appRef = useRef<Application | null>(null);
    const fxRef = useRef<Container | null>(null);
    const glowRef = useRef<Sprite | null>(null);
    const particlesRef = useRef<Particle[]>([]);
    const dotRef = useRef<Texture | null>(null);
    cardsRef.current = cards;

    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() =>
            setDims({ w: el.clientWidth, h: el.clientHeight })
        );
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Layout (shared math — same as the pure-DOM variant).
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

    // Init Pixi overlay once.
    useEffect(() => {
        let disposed = false;
        let inited = false;
        const app = new Application();
        const host = hostRef.current!;
        (async () => {
            await app.init({
                resizeTo: host,
                backgroundAlpha: 0,
                antialias: true,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
            });
            inited = true;
            if (disposed) {
                app.destroy(true, { children: true });
                return;
            }
            host.appendChild(app.canvas);
            appRef.current = app;
            dotRef.current = dotTexture();

            const fx = new Container();
            app.stage.addChild(fx);
            fxRef.current = fx;

            // A single additive glow sprite that follows the hovered card —
            // a "rim light" rendered ON the canvas but POSITIONED from the
            // DOM card's rect.
            const glow = new Sprite(dotRef.current);
            glow.anchor.set(0.5);
            glow.blendMode = "add";
            glow.visible = false;
            glow.filters = [
                new GlowFilter({
                    color: 0x7fc0ff,
                    outerStrength: 4,
                    distance: 20,
                    quality: 0.3,
                }),
            ];
            fx.addChild(glow);
            glowRef.current = glow;

            app.ticker.add((tick: Ticker) => {
                // ── THE MAPPING ──────────────────────────────────────────
                // Read the hovered DOM card's viewport rect; the overlay is
                // fixed inset-0 so rect coords == canvas coords (CSS px).
                const id = hoveredRef.current;
                if (id) {
                    const el = elRef.current.get(id);
                    if (el) {
                        const r = el.getBoundingClientRect();
                        glow.visible = true;
                        glow.position.set(
                            r.left + r.width / 2,
                            r.top + r.height / 2
                        );
                        glow.width = r.width * 2.1;
                        glow.height = r.height * 2.1;
                    }
                } else {
                    glow.visible = false;
                }

                const ps = particlesRef.current;
                for (let i = ps.length - 1; i >= 0; i--) {
                    const p = ps[i];
                    p.life -= tick.deltaMS / 1000;
                    p.vy += 0.25;
                    p.s.x += p.vx;
                    p.s.y += p.vy;
                    p.s.alpha = Math.max(0, p.life);
                    p.s.scale.set(0.4 + p.life * 0.6);
                    if (p.life <= 0) {
                        p.s.destroy();
                        ps.splice(i, 1);
                    }
                }
            });
        })();
        return () => {
            disposed = true;
            appRef.current = null;
            if (inited) app.destroy(true, { children: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cast FX: read the card's rect once, burst particles there.
    useEffect(() => {
        for (const c of cards) {
            const prev = prevZonesRef.current.get(c.instanceId);
            if (prev === "hand" && c.zone === "battlefield")
                burst(c.instanceId);
        }
        prevZonesRef.current = new Map(
            cards.map((c) => [c.instanceId, c.zone])
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cards]);

    function burst(instanceId: string) {
        const fx = fxRef.current;
        const dot = dotRef.current;
        const el = elRef.current.get(instanceId);
        if (!fx || !dot || !el) return;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        for (let i = 0; i < 26; i++) {
            const s = new Sprite(dot);
            s.anchor.set(0.5);
            s.blendMode = "add";
            s.position.set(x, y);
            const ang = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
            const spd = 3 + Math.random() * 5;
            fx.addChild(s);
            particlesRef.current.push({
                s,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd - 3,
                life: 0.7 + Math.random() * 0.5,
            });
        }
    }

    return (
        <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
            {/* DOM cards — identical to the pure-DOM variant */}
            {cards.map((c) => {
                const p = place.get(c.instanceId)!;
                return (
                    <motion.div
                        key={c.instanceId}
                        ref={(n) => {
                            if (n) elRef.current.set(c.instanceId, n);
                            else elRef.current.delete(c.instanceId);
                        }}
                        drag
                        dragMomentum={false}
                        onPointerEnter={() =>
                            (hoveredRef.current = c.instanceId)
                        }
                        onPointerLeave={() => {
                            if (hoveredRef.current === c.instanceId)
                                hoveredRef.current = null;
                        }}
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

            {/* Transparent Pixi FX overlay — above the cards, no pointer events */}
            <div
                ref={hostRef}
                className="absolute inset-0 pointer-events-none"
            />
        </div>
    );
}
