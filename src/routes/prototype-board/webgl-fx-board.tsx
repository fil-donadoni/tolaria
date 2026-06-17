/**
 * PROTOTYPE — WebGL board playing to canvas STRENGTHS (the fair pro-canvas
 * demo). Animated godray bg, pulsing glow on castable cards, holographic
 * foil on hover, shockwave + additive particle burst on cast. None of this
 * is reasonably doable in DOM. Throwaway — delete after decision.
 */

import { useEffect, useRef } from "react";
import {
    Application,
    Assets,
    Container,
    Graphics,
    Sprite,
    Text,
    Texture,
    Ticker,
    type FederatedPointerEvent,
} from "pixi.js";
import {
    GlowFilter,
    GodrayFilter,
    RGBSplitFilter,
    ShockwaveFilter,
} from "pixi-filters";
import { SCRYFALL_NORMAL } from "./cards";
import { CARD_H, CARD_W, fanLayout, rowLayout, type Placed } from "./layout";
import type { ZonedCard } from "./dom-board";

type Node = {
    container: Container;
    card: ZonedCard;
    target: Placed;
    cur: Placed;
    dragging: boolean;
    hover: boolean;
    glow: GlowFilter;
    rgb: RGBSplitFilter;
};

type Particle = { s: Sprite; vx: number; vy: number; life: number };

function gradientTexture(): Texture {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#1b2c3f");
    grad.addColorStop(0.5, "#0d1622");
    grad.addColorStop(1, "#05070b");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    return Texture.from(c);
}

function dotTexture(): Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(180,220,255,0.8)");
    grad.addColorStop(1, "rgba(120,180,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return Texture.from(c);
}

export default function WebglFxBoard({ cards }: { cards: ZonedCard[] }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<Application | null>(null);
    const nodesRef = useRef<Map<string, Node>>(new Map());
    const cardsRef = useRef<ZonedCard[]>(cards);
    const prevZonesRef = useRef<Map<string, string>>(new Map());
    const boardRef = useRef<Container | null>(null);
    const fxRef = useRef<Container | null>(null);
    const particlesRef = useRef<Particle[]>([]);
    const shockwavesRef = useRef<ShockwaveFilter[]>([]);
    const dotRef = useRef<Texture | null>(null);
    cardsRef.current = cards;

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

            // Animated godray background.
            const bg = new Sprite(gradientTexture());
            const god = new GodrayFilter({
                gain: 0.5,
                lacunarity: 2.6,
                alpha: 0.85,
                angle: 28,
            });
            bg.filters = [god];
            app.stage.addChild(bg);

            const board = new Container();
            const fx = new Container();
            app.stage.addChild(board, fx);
            boardRef.current = board;
            fxRef.current = fx;

            app.ticker.add((tick: Ticker) => {
                const r = app.renderer;
                const w = r.width / r.resolution;
                const h = r.height / r.resolution;
                bg.width = w;
                bg.height = h;
                god.time += tick.deltaMS / 1000;

                layout(nodesRef.current, cardsRef.current, w, h);
                const t = performance.now() / 1000;
                for (const node of nodesRef.current.values()) {
                    // Castable (hand) cards breathe a soft glow.
                    if (node.card.zone === "hand" && !node.hover) {
                        node.glow.outerStrength =
                            2 + Math.sin(t * 2.5 + node.cur.x * 0.01) * 1.2;
                    }
                    if (node.dragging) continue;
                    const c = node.cur;
                    const tg = node.target;
                    c.x += (tg.x - c.x) * 0.2;
                    c.y += (tg.y - c.y) * 0.2;
                    c.rot += (tg.rot - c.rot) * 0.2;
                    c.scale += (tg.scale - c.scale) * 0.2;
                    node.container.position.set(c.x, c.y);
                    node.container.rotation = (c.rot * Math.PI) / 180;
                    node.container.scale.set(c.scale);
                }

                // Particles.
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

                // Shockwaves.
                const sw = shockwavesRef.current;
                for (let i = sw.length - 1; i >= 0; i--) {
                    sw[i].time += tick.deltaMS / 1000;
                    if (sw[i].time > 1.1) {
                        board.filters = [];
                        sw.splice(i, 1);
                    }
                }
            });
            reconcile();
        })();
        return () => {
            disposed = true;
            appRef.current = null;
            if (inited) app.destroy(true, { children: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!appRef.current) return;
        // Detect hand→battlefield transitions → fire cast FX.
        for (const c of cards) {
            const prev = prevZonesRef.current.get(c.instanceId);
            if (prev === "hand" && c.zone === "battlefield") {
                castFx(c.instanceId);
            }
        }
        prevZonesRef.current = new Map(
            cards.map((c) => [c.instanceId, c.zone])
        );
        reconcile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cards]);

    function castFx(instanceId: string) {
        const app = appRef.current;
        const board = boardRef.current;
        const fx = fxRef.current;
        const dot = dotRef.current;
        const node = nodesRef.current.get(instanceId);
        if (!app || !board || !fx || !dot || !node) return;
        const { x, y } = node.cur;

        const shock = new ShockwaveFilter({
            center: { x, y },
            amplitude: 22,
            wavelength: 120,
            brightness: 1.1,
            radius: -1,
        });
        shock.time = 0;
        board.filters = [shock];
        shockwavesRef.current.push(shock);

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

    function reconcile() {
        const app = appRef.current;
        const board = boardRef.current;
        if (!app || !board) return;
        const nodes = nodesRef.current;
        const wanted = new Set(cards.map((c) => c.instanceId));
        for (const [id, node] of nodes) {
            if (!wanted.has(id)) {
                board.removeChild(node.container);
                node.container.destroy({ children: true });
                nodes.delete(id);
            }
        }
        for (const c of cards) {
            const existing = nodes.get(c.instanceId);
            if (existing) {
                existing.card = c;
                continue;
            }
            const node = makeNode(c);
            nodes.set(c.instanceId, node);
            board.addChild(node.container);
        }
    }

    function makeNode(card: ZonedCard): Node {
        const container = new Container();
        container.pivot.set(CARD_W / 2, CARD_H / 2);
        container.eventMode = "static";
        container.cursor = "grab";

        const bg = new Graphics()
            .roundRect(0, 0, CARD_W, CARD_H, 6)
            .fill(0x1a1a26);
        container.addChild(bg);

        const sprite = new Sprite();
        sprite.width = CARD_W;
        sprite.height = CARD_H;
        const mask = new Graphics()
            .roundRect(0, 0, CARD_W, CARD_H, 6)
            .fill(0xffffff);
        sprite.mask = mask;
        container.addChild(sprite, mask);
        Assets.load(SCRYFALL_NORMAL(card.cardId))
            .then((tex) => {
                if (!sprite.destroyed) sprite.texture = tex;
            })
            .catch(() => {});

        const ptBox = new Graphics()
            .roundRect(CARD_W - 38, CARD_H - 22, 32, 16, 3)
            .fill({ color: 0x000000, alpha: 0.82 });
        const pt = new Text({
            text: `${card.power}/${card.toughness}`,
            style: { fill: 0xffffff, fontSize: 12, fontWeight: "bold" },
        });
        pt.resolution = window.devicePixelRatio || 1;
        pt.position.set(CARD_W - 34, CARD_H - 20);
        container.addChild(ptBox, pt);

        const glow = new GlowFilter({
            color: 0x6fb6ff,
            outerStrength: 0,
            innerStrength: 0,
            distance: 14,
            quality: 0.3,
        });
        const rgb = new RGBSplitFilter({
            red: { x: 0, y: 0 },
            green: { x: 0, y: 0 },
            blue: { x: 0, y: 0 },
        });
        container.filters = [glow, rgb];

        const node: Node = {
            container,
            card,
            target: { x: 0, y: 0, rot: 0, scale: 1 },
            cur: { x: 0, y: -220, rot: 0, scale: 1 },
            dragging: false,
            hover: false,
            glow,
            rgb,
        };

        let off = { x: 0, y: 0 };
        const onMove = (e: FederatedPointerEvent) => {
            node.cur.x = e.global.x - off.x;
            node.cur.y = e.global.y - off.y;
            container.position.set(node.cur.x, node.cur.y);
        };
        container.on("pointerdown", (e: FederatedPointerEvent) => {
            node.dragging = true;
            container.zIndex = 1000;
            if (container.parent) container.parent.sortableChildren = true;
            off = { x: e.global.x - container.x, y: e.global.y - container.y };
            appRef.current?.stage.on("pointermove", onMove);
        });
        const endDrag = () => {
            if (!node.dragging) return;
            node.dragging = false;
            container.zIndex = 0;
            appRef.current?.stage.off("pointermove", onMove);
        };
        container.on("pointerup", endDrag);
        container.on("pointerupoutside", endDrag);

        // Hover → holographic foil: glow up + chromatic split shimmer.
        container.on("pointerover", () => {
            node.hover = true;
            node.target.scale = 1.16;
            node.glow.outerStrength = 6;
            node.glow.innerStrength = 1.4;
            node.rgb.red = { x: 3, y: 1 };
            node.rgb.blue = { x: -3, y: -1 };
        });
        container.on("pointerout", () => {
            node.hover = false;
            node.target.scale = 1;
            node.glow.innerStrength = 0;
            node.rgb.red = { x: 0, y: 0 };
            node.rgb.blue = { x: 0, y: 0 };
        });

        return node;
    }

    return <div ref={hostRef} className="absolute inset-0 overflow-hidden" />;
}

function layout(
    nodes: Map<string, Node>,
    cards: ZonedCard[],
    w: number,
    h: number
) {
    const bf = cards.filter((c) => c.zone === "battlefield");
    const hand = cards.filter((c) => c.zone === "hand");
    const bfPos = rowLayout(bf.length, w, CARD_W, h * 0.34);
    const handPos = fanLayout(hand.length, w, CARD_W, h * 0.72, CARD_H);
    bf.forEach((c, i) => {
        const n = nodes.get(c.instanceId);
        if (n && !n.dragging && !n.hover) n.target = bfPos[i];
    });
    hand.forEach((c, i) => {
        const n = nodes.get(c.instanceId);
        if (n && !n.dragging && !n.hover)
            n.target = { ...handPos[i], scale: 1 };
    });
}
