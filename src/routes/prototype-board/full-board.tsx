/**
 * PROTOTYPE — faithful-ish hybrid board: two players, creatures/lands rows,
 * fanned hand, stack, life/phase chrome. DOM cards with CSS 3D tilt (CardTilt)
 * + a transparent Pixi FX overlay (hover glow + cast particle burst) keyed to
 * DOM rects. Throwaway — delete after decision.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Application, Container, Sprite, Texture, Ticker } from "pixi.js";
import CardTilt from "./card-tilt";
import { makeCards, type ProtoCard } from "./cards";
import { CARD_W, fanLayout, rowLayout, type Placed } from "./layout";

const CW = CARD_W; // 120
const CH = Math.round((CARD_W * 7) / 5);

type Item = ProtoCard & { scale: number; faceDown?: boolean };

function dotTexture(): Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(190,225,255,0.85)");
    grad.addColorStop(1, "rgba(120,180,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return Texture.from(c);
}

type Particle = { s: Sprite; vx: number; vy: number; life: number };

export default function FullBoard() {
    const wrapRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const elRef = useRef<Map<string, HTMLElement>>(new Map());
    const hoveredRef = useRef<string | null>(null);
    const [dims, setDims] = useState({ w: 1280, h: 760 });

    // Demo zone contents.
    const [oppCreatures] = useState<Item[]>(() =>
        makeCards(3, 2).map((c) => ({ ...c, scale: 1 }))
    );
    const [oppLands] = useState<Item[]>(() =>
        makeCards(4, 7).map((c) => ({ ...c, scale: 0.74 }))
    );
    const [oppHand] = useState<Item[]>(() =>
        makeCards(5, 11).map((c) => ({ ...c, scale: 0.8, faceDown: true }))
    );
    const [playerLands] = useState<Item[]>(() =>
        makeCards(4, 3).map((c) => ({ ...c, scale: 0.74 }))
    );
    const [stack] = useState<Item[]>(() =>
        makeCards(2, 9).map((c) => ({ ...c, scale: 0.78 }))
    );
    const [creatures, setCreatures] = useState<Item[]>(() =>
        makeCards(3, 0).map((c) => ({ ...c, scale: 1 }))
    );
    const [hand, setHand] = useState<Item[]>(() =>
        makeCards(5, 5).map((c) => ({ ...c, scale: 1 }))
    );

    // Pixi overlay
    const appRef = useRef<Application | null>(null);
    const fxRef = useRef<Container | null>(null);
    const glowRef = useRef<Sprite | null>(null);
    const particlesRef = useRef<Particle[]>([]);
    const dotRef = useRef<Texture | null>(null);

    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() =>
            setDims({ w: el.clientWidth, h: el.clientHeight })
        );
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

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

            const glow = new Sprite(dotRef.current);
            glow.anchor.set(0.5);
            glow.blendMode = "add";
            glow.tint = 0x6fa8d0;
            glow.alpha = 0.18;
            glow.visible = false;
            fx.addChild(glow);
            glowRef.current = glow;

            app.ticker.add((tick: Ticker) => {
                const id = hoveredRef.current;
                const el = id ? elRef.current.get(id) : null;
                if (el) {
                    const r = el.getBoundingClientRect();
                    glow.visible = true;
                    glow.position.set(
                        r.left + r.width / 2,
                        r.top + r.height / 2
                    );
                    glow.width = r.width * 1.35;
                    glow.height = r.height * 1.35;
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
    }, []);

    function burstAt(id: string) {
        const fx = fxRef.current;
        const dot = dotRef.current;
        const el = elRef.current.get(id);
        if (!fx || !dot || !el) return;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        for (let i = 0; i < 28; i++) {
            const s = new Sprite(dot);
            s.anchor.set(0.5);
            s.blendMode = "add";
            s.position.set(x, y);
            const ang = (Math.PI * 2 * i) / 28 + Math.random() * 0.4;
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

    function castOne() {
        if (hand.length === 0) return;
        const played = hand[0];
        setHand((h) => h.slice(1));
        setCreatures((c) => [...c, { ...played, scale: 1 }]);
        // Fire FX next frame, once the card sits in its battlefield slot.
        requestAnimationFrame(() =>
            requestAnimationFrame(() => burstAt(played.instanceId))
        );
    }

    function reset() {
        setHand(makeCards(5, 5).map((c) => ({ ...c, scale: 1 })));
        setCreatures(makeCards(3, 0).map((c) => ({ ...c, scale: 1 })));
    }

    // Band positions (fraction of height).
    const W = dims.w;
    const H = dims.h;
    const stage = W - 360; // leave room for the stack column on the right
    const place = new Map<string, Placed>();
    const add = (items: Item[], pos: Placed[]) =>
        items.forEach((it, i) => place.set(it.instanceId, pos[i]));

    add(
        oppHand,
        fanLayout(oppHand.length, stage, CW * 0.8, H * 0.075, CH * 0.8)
    );
    add(oppCreatures, rowLayout(oppCreatures.length, stage, CW, H * 0.23));
    add(oppLands, rowLayout(oppLands.length, stage, CW * 0.74, H * 0.36));
    add(playerLands, rowLayout(playerLands.length, stage, CW * 0.74, H * 0.62));
    add(creatures, rowLayout(creatures.length, stage, CW, H * 0.75));
    add(hand, fanLayout(hand.length, stage, CW, H * 0.93, CH));
    // Stack: vertical, right column.
    stack.forEach((it, i) =>
        place.set(it.instanceId, {
            x: W - 150,
            y: H * 0.4 + i * 34,
            rot: -4 + i * 2,
            scale: it.scale,
        })
    );

    const all = [
        ...oppHand,
        ...oppCreatures,
        ...oppLands,
        ...playerLands,
        ...creatures,
        ...hand,
        ...stack,
    ];

    return (
        <div
            ref={wrapRef}
            className="absolute inset-0 overflow-hidden"
            style={
                {
                    "--pt-cw": `${CW}px`,
                    "--pt-ch": `${CH}px`,
                } as React.CSSProperties
            }
        >
            {/* center divider */}
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/8" />

            {/* life totals */}
            <div className="absolute left-5 top-5 flex items-center gap-2">
                <div className="grid place-items-center w-11 h-11 rounded-full bg-red-950/70 border border-red-700/50 text-red-200 font-bold tabular-nums">
                    18
                </div>
                <span className="text-red-200/60 text-xs">Opponent</span>
            </div>
            <div className="absolute left-5 bottom-5 flex items-center gap-2">
                <div className="grid place-items-center w-11 h-11 rounded-full bg-emerald-950/70 border border-emerald-600/50 text-emerald-200 font-bold tabular-nums">
                    20
                </div>
                <span className="text-emerald-200/60 text-xs">You</span>
            </div>

            {/* phase pills */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1.5">
                {["Beginning", "Main 1", "Combat", "Main 2", "End"].map(
                    (p, i) => (
                        <div
                            key={p}
                            className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider border ${
                                i === 2
                                    ? "bg-amber-500/25 border-amber-400/50 text-amber-200"
                                    : "bg-white/5 border-white/10 text-white/40"
                            }`}
                        >
                            {p}
                        </div>
                    )
                )}
            </div>

            {/* stack label */}
            <div className="absolute right-6 top-[34%] text-[10px] uppercase tracking-widest text-white/30">
                Stack
            </div>

            {/* all cards */}
            {all.map((it) => {
                const p = place.get(it.instanceId)!;
                return (
                    <div
                        key={it.instanceId}
                        className="absolute top-0 left-0"
                        style={{
                            transform: `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`,
                            transition:
                                "transform 360ms cubic-bezier(0.22,1,0.36,1)",
                            zIndex: it.faceDown ? 1 : 2,
                        }}
                    >
                        <CardTilt
                            cardId={it.cardId}
                            name={it.name}
                            power={it.faceDown ? undefined : it.power}
                            toughness={it.faceDown ? undefined : it.toughness}
                            faceDown={it.faceDown}
                            scale={it.scale}
                            registerEl={(el) => {
                                if (el) elRef.current.set(it.instanceId, el);
                                else elRef.current.delete(it.instanceId);
                            }}
                            onPointerEnterCard={() =>
                                (hoveredRef.current = it.instanceId)
                            }
                            onPointerLeaveCard={() => {
                                if (hoveredRef.current === it.instanceId)
                                    hoveredRef.current = null;
                            }}
                        />
                    </div>
                );
            })}

            {/* FX overlay */}
            <div
                ref={hostRef}
                className="absolute inset-0 pointer-events-none"
            />

            {/* controls */}
            <div className="absolute bottom-4 right-4 z-[60] flex gap-2">
                <button
                    type="button"
                    onClick={castOne}
                    className="px-3 py-1.5 rounded bg-sky-600/80 hover:bg-sky-500 text-white text-xs cursor-pointer"
                >
                    Cast → BF
                </button>
                <button
                    type="button"
                    onClick={reset}
                    className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-xs cursor-pointer"
                >
                    Reset
                </button>
            </div>
        </div>
    );
}
